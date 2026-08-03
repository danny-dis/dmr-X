import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '@dmr-x/utils';

import { SUPPORTED_LANGUAGES } from './languages.js';

export interface ExecuteInput {
  language: string;
  code: string;
  timeoutMs: number;
  /**
   * Working directory for the spawned interpreter. When provided, the
   * directory is created if missing and the process is spawned with `cwd`
   * set to it, so code executed here sees the SAME files the read_file /
   * write_file coding tools operate on (they resolve into this same
   * per-conversation workspace — see apps/gateway/src/routes/tools.routes.ts
   * `resolveSandboxDir`). When omitted, the process inherits the host
   * process's cwd (legacy behavior — kept for callers with no workspace,
   * e.g. sandbox jobs submitted outside an agent conversation).
   */
  workspaceDir?: string;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  error: string | null;
  exitCode: number | null;
  cancelled: boolean;
}

/** Maximum code size in characters to prevent DoS via large payloads. */
const MAX_CODE_SIZE = 100_000;

/**
 * Cgroup resource limits for sandboxed processes.
 * Prevents fork bombs, memory exhaustion, and CPU starvation.
 */
interface CgroupLimits {
  /** Max memory in bytes (default: 512MB) */
  memoryBytes: number;
  /** Max CPU shares (1024 = 1 core, default: 512 = 50% of 1 core) */
  cpuShares: number;
  /** Max number of processes/threads (default: 50) */
  pidsMax: number;
}

const DEFAULT_CGROUP_LIMITS: CgroupLimits = {
  memoryBytes: 512 * 1024 * 1024, // 512MB
  cpuShares: 512,                  // 50% CPU
  pidsMax: 50,                     // Prevent fork bombs
};

/**
 * Safe environment for sandboxed child processes.
 * Only passes through non-sensitive system variables.
 * Explicitly strips DMRX_* secrets, API keys, and tokens.
 */
const SANDBOX_ENV: Record<string, string | undefined> = {
  HOME: '/tmp',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  LANG: process.env.LANG || 'en_US.UTF-8',
  TMPDIR: '/tmp',
  USER: 'dmrx-sandbox',
};

/**
 * Detect if we're running on Linux (where cgroups are available).
 */
function isLinux(): boolean {
  return os.platform() === 'linux';
}

/**
 * Create and configure a cgroup v2 hierarchy for process isolation.
 * Returns the cgroup path if successful, null otherwise.
 *
 * This provides:
 * - Memory limits (prevents OOM kills of host)
 * - CPU throttling (prevents CPU starvation)
 * - PID limits (prevents fork bombs)
 * - Network isolation via unshare (optional)
 */
function createCgroup(jobId: string, limits: CgroupLimits): string | null {
  if (!isLinux()) return null;

  const cgroupBase = '/sys/fs/cgroup';
  const cgroupPath = join(cgroupBase, `dmrx-sandbox-${jobId}`);

  try {
    // Create cgroup directory
    mkdirSync(cgroupPath, { recursive: true });

    // Set memory limit
    writeFileSync(join(cgroupPath, 'memory.max'), String(limits.memoryBytes));

    // Set CPU shares (weighted CPU allocation)
    writeFileSync(join(cgroupPath, 'cpu.weight'), String(Math.min(100, Math.round((limits.cpuShares / 1024) * 100))));

    // Set PID limit
    writeFileSync(join(cgroupPath, 'pids.max'), String(limits.pidsMax));

    // Enable memory swap limit (set to same as memory to prevent swap bypass)
    writeFileSync(join(cgroupPath, 'memory.swap.max'), String(limits.memoryBytes));

    logger.debug({ jobId, cgroupPath, limits }, 'Created cgroup for sandbox job');
    return cgroupPath;
  } catch (err) {
    // Cgroup creation may fail on some systems (containers, macOS, etc.)
    // Fall back to running without cgroup isolation
    logger.warn({ err, jobId }, 'Failed to create cgroup, running without resource limits');
    return null;
  }
}

/**
 * Attach a process to a cgroup by writing its PID to the cgroup.procs file.
 */
function attachToCgroup(cgroupPath: string, pid: number): void {
  try {
    writeFileSync(join(cgroupPath, 'cgroup.procs'), String(pid));
  } catch (err) {
    logger.warn({ err, cgroupPath, pid }, 'Failed to attach process to cgroup');
  }
}

/**
 * Clean up a cgroup after process exits.
 */
function cleanupCgroup(cgroupPath: string): void {
  try {
    rmSync(cgroupPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

export class Executor {
  private running = new Map<string, ChildProcess>();
  private cgroups = new Map<string, string>(); // jobId -> cgroupPath

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    // Validate code size
    if (input.code.length > MAX_CODE_SIZE) {
      return {
        stdout: '',
        stderr: '',
        error: `Code exceeds maximum size (${MAX_CODE_SIZE} characters)`,
        exitCode: 1,
        cancelled: false,
      };
    }

    const runner = this.getRunner(input.language);
    if (!runner) {
      return {
        stdout: '',
        stderr: '',
        error: `Unsupported language: ${input.language}`,
        exitCode: 1,
        cancelled: false,
      };
    }

    const jobId = crypto.randomUUID();

    // Create cgroup for resource isolation (Linux only, graceful fallback)
    const cgroupPath = createCgroup(jobId, DEFAULT_CGROUP_LIMITS);
    if (cgroupPath) {
      this.cgroups.set(jobId, cgroupPath);
    }

    // Ensure the workspace directory exists before spawning into it as cwd.
    if (input.workspaceDir) {
      try {
        mkdirSync(input.workspaceDir, { recursive: true });
      } catch (err) {
        logger.warn({ err, workspaceDir: input.workspaceDir }, 'Failed to create sandbox workspace dir');
      }
    }

    return new Promise((resolve) => {
      const spawnOptions: any = {
        stdio: ['pipe', 'pipe', 'pipe'],
        // SECURITY: Use a stripped environment — never inherit process.env
        // which contains DMRX_ADMIN_API_KEY, DMRX_ENCRYPTION_KEY, etc.
        env: { ...SANDBOX_ENV, ...runner.env },
        // Run inside the same per-conversation workspace the file tools use
        // (falls back to the host process's own cwd when absent, matching
        // the previous behavior for callers with no workspace).
        ...(input.workspaceDir ? { cwd: input.workspaceDir } : {}),
      };

      // NOTE: Network isolation requires running as root with unshare:
      //   unshare --net -- node -e "..."
      // The cgroup resource limits + stripped SANDBOX_ENV are the primary isolation.

      const proc = spawn(runner.command, runner.args, spawnOptions);

      // Attach process to cgroup for resource limits
      if (cgroupPath && proc.pid) {
        attachToCgroup(cgroupPath, proc.pid);
      }

      this.running.set(jobId, proc);

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Enforce bounded buffers to prevent OOM from runaway output
      const MAX_STDOUT_BYTES = 100_000;  // 100KB
      const MAX_STDERR_BYTES = 10_000;   // 10KB
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, input.timeoutMs);

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes <= MAX_STDOUT_BYTES) {
          stdout += data.toString();
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes <= MAX_STDERR_BYTES) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.running.delete(jobId);
        this.cleanupJob(jobId);
        resolve({
          stdout: stdout.slice(0, 100_000),
          stderr: stderr.slice(0, 10_000),
          error: killed ? 'Execution timed out' : null,
          exitCode: code,
          cancelled: false,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.running.delete(jobId);
        this.cleanupJob(jobId);
        resolve({
          stdout,
          stderr,
          error: String(err),
          exitCode: null,
          cancelled: false,
        });
      });

      proc.stdin?.write(input.code);
      proc.stdin?.end();
    });
  }

  /**
   * Clean up cgroup resources for a completed job.
   */
  private cleanupJob(jobId: string): void {
    const cgroupPath = this.cgroups.get(jobId);
    if (cgroupPath) {
      cleanupCgroup(cgroupPath);
      this.cgroups.delete(jobId);
    }
  }

  cancel(jobId: string): boolean {
    const proc = this.running.get(jobId);
    if (!proc) return false;
    proc.kill('SIGKILL');
    this.running.delete(jobId);
    return true;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  private getRunner(language: string): { command: string; args: string[]; env: Record<string, string> } | null {
    const lang = SUPPORTED_LANGUAGES[language];
    if (!lang) return null;

    // Language-specific args (stdin is used for code delivery)
    const argsByLang: Record<string, string[]> = {
      python: ['-'],
      python3: ['-'],
      node: [],
      javascript: [],
      js: [],
      deno: ['eval', '--no-prompt'],
      bun: ['-e', ''],
    };

    return {
      command: lang.command,
      args: argsByLang[language] || [],
      env: {},
    };
  }
}
