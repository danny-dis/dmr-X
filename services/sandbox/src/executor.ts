import { spawn, type ChildProcess } from 'node:child_process';
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

export class Executor {
  private running = new Map<string, ChildProcess>();

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

    return new Promise((resolve) => {
      const proc = spawn(runner.command, runner.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: input.timeoutMs,
        // SECURITY: Use a stripped environment — never inherit process.env
        // which contains DMRX_ADMIN_API_KEY, DMRX_ENCRYPTION_KEY, etc.
        env: { ...SANDBOX_ENV, ...runner.env },
      });

      const jobId = crypto.randomUUID();
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
