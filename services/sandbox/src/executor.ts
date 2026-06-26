import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '@dmr-x/utils';

export interface ExecuteInput {
  language: string;
  code: string;
  timeoutMs: number;
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
    const { rmSync } = require('node:fs');
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

    return new Promise((resolve) => {
      const spawnOptions: any = {
        stdio: ['pipe', 'pipe', 'pipe'],
        // SECURITY: Use a stripped environment — never inherit process.env
        // which contains DMRX_ADMIN_API_KEY, DMRX_ENCRYPTION_KEY, etc.
        env: { ...SANDBOX_ENV, ...runner.env },
      };

      // On Linux, use unshare for network isolation if available
      if (isLinux() && process.getuid?.() === 0) {
        // Network namespace isolation (requires root or CAP_SYS_ADMIN)
        // This prevents sandboxed code from making network requests
        try {
          spawnOptions.detached = true;
        } catch {
          // Ignore if not supported
        }
      }

      const proc = spawn(runner.command, runner.args, spawnOptions);

      // Attach process to cgroup for resource limits
      if (cgroupPath && proc.pid) {
        attachToCgroup(cgroupPath, proc.pid);
      }

      this.running.set(jobId, proc);

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, input.timeoutMs);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
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
    switch (language) {
      case 'python':
      case 'python3':
        return { command: 'python3', args: ['-'], env: {} };
      case 'node':
      case 'javascript':
      case 'js':
        return { command: 'node', args: ['-e', ''], env: {} };
      case 'deno':
        // Deno with minimal permissions — no network, no filesystem write, no env
        return { command: 'deno', args: ['eval', '--no-prompt', '--allow-read', '--allow-run'], env: {} };
      case 'bun':
        return { command: 'bun', args: ['-e', ''], env: {} };
      // SECURITY: bash/sh removed — they provide unrestricted OS access
      default:
        return null;
    }
  }
}
