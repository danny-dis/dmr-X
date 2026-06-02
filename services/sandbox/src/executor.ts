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

export class Executor {
  private running = new Map<string, ChildProcess>();

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
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
        env: { ...process.env, ...runner.env },
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

  private getRunner(language: string): { command: string; args: string[]; env: Record<string, string> } | null {
    switch (language) {
      case 'python':
      case 'python3':
        return { command: 'python3', args: ['-'], env: {} };
      case 'node':
      case 'javascript':
      case 'js':
        return { command: 'node', args: ['-e', ''], env: {} };
      case 'bash':
      case 'sh':
        return { command: 'bash', args: ['-c', ''], env: {} };
      case 'deno':
        return { command: 'deno', args: ['eval', ''], env: {} };
      case 'bun':
        return { command: 'bun', args: ['-e', ''], env: {} };
      default:
        return null;
    }
  }
}
