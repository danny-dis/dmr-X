/**
 * AsyncJob — shared abstraction for long-running generation jobs.
 *
 * Video (and some audio/image) providers are inherently asynchronous:
 * submitting a job returns a job ID, and the result arrives seconds or
 * minutes later. This class provides a common submit → poll → complete
 * pattern that all async adapters (Replicate, Runway, ComfyUI, etc.)
 * can reuse.
 *
 * Usage:
 *   const runner = new AsyncJobRunner({
 *     pollIntervalMs: 2000,
 *     timeoutMs: 300_000,
 *   });
 *   const result = await runner.run(async () => {
 *     // submit job, return { jobId, status }
 *     return { jobId: 'abc123', status: 'processing' };
 *   }, async (jobId) => {
 *     // poll: return { status: 'succeeded'|'failed'|'processing', output?: T }
 *     return { status: 'succeeded', output: { url: '...' } };
 *   });
 */

import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsyncJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  error?: string;
}

export interface AsyncJobPollResult<T = unknown> {
  status: 'succeeded' | 'failed' | 'processing';
  output?: T;
  error?: string;
}

export interface AsyncJobResult<T = unknown> {
  jobId: string;
  success: boolean;
  output?: T;
  error?: string;
  totalPollTimeMs: number;
  pollsAttempted: number;
}

export interface AsyncJobRunnerConfig {
  /** Interval between polls in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Maximum total time to wait in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
  /** Whether to log each poll attempt (default: false) */
  verbose?: boolean;
}

export type SubmitFn<T = unknown> = () => Promise<AsyncJobStatus>;
export type PollFn<T = unknown> = (jobId: string) => Promise<AsyncJobPollResult<T>>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pollIntervalMs: 2000,
  timeoutMs: 300_000,
  verbose: false,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AsyncJobError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly pollsAttempted: number,
    public readonly totalPollTimeMs: number,
  ) {
    super(message);
    this.name = 'AsyncJobError';
  }
}

export class AsyncJobTimeoutError extends AsyncJobError {
  constructor(jobId: string, timeoutMs: number, pollsAttempted: number, totalPollTimeMs: number) {
    super(`Job ${jobId} timed out after ${timeoutMs}ms (${pollsAttempted} polls)`, jobId, pollsAttempted, totalPollTimeMs);
    this.name = 'AsyncJobTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class AsyncJobRunner {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly verbose: boolean;

  constructor(config: AsyncJobRunnerConfig = {}) {
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    this.verbose = config.verbose ?? DEFAULTS.verbose;
  }

  /**
   * Run an async job: submit, then poll until completion or timeout.
   *
   * @param submitFn - Function that submits the job and returns initial status
   * @param pollFn - Function that polls for job status by jobId
   * @param options - Optional override for poll interval and timeout
   * @returns AsyncJobResult with the final output or error
   */
  async run<T = unknown>(
    submitFn: SubmitFn<T>,
    pollFn: PollFn<T>,
    options?: { pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<AsyncJobResult<T>> {
    const pollInterval = options?.pollIntervalMs ?? this.pollIntervalMs;
    const timeout = options?.timeoutMs ?? this.timeoutMs;

    const startTime = Date.now();
    let pollsAttempted = 0;

    // Phase 1: Submit
    let jobStatus: AsyncJobStatus;
    try {
      jobStatus = await submitFn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Submission failed';
      return {
        jobId: 'unknown',
        success: false,
        error: message,
        totalPollTimeMs: Date.now() - startTime,
        pollsAttempted: 0,
      };
    }

    const { jobId } = jobStatus;
    if (jobStatus.status === 'failed') {
      return {
        jobId,
        success: false,
        error: jobStatus.error || 'Job failed on submission',
        totalPollTimeMs: Date.now() - startTime,
        pollsAttempted: 0,
      };
    }

    if (jobStatus.status === 'succeeded') {
      return {
        jobId,
        success: true,
        totalPollTimeMs: Date.now() - startTime,
        pollsAttempted: 0,
      };
    }

    // Phase 2: Poll
    while (Date.now() - startTime < timeout) {
      pollsAttempted++;

      try {
        await this.delay(pollInterval);

        const pollResult = await pollFn(jobId);

        if (pollResult.status === 'succeeded') {
          const totalPollTimeMs = Date.now() - startTime;
          if (this.verbose) {
            logger.info({ jobId, pollsAttempted, totalPollTimeMs }, 'Async job completed');
          }
          return {
            jobId,
            success: true,
            output: pollResult.output,
            totalPollTimeMs,
            pollsAttempted,
          };
        }

        if (pollResult.status === 'failed') {
          const totalPollTimeMs = Date.now() - startTime;
          return {
            jobId,
            success: false,
            error: pollResult.error || 'Job failed',
            totalPollTimeMs,
            pollsAttempted,
          };
        }

        // Still processing — continue polling
        if (this.verbose && pollsAttempted % 10 === 0) {
          logger.info({ jobId, pollsAttempted, elapsedMs: Date.now() - startTime }, 'Async job still processing');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Poll error';
        const totalPollTimeMs = Date.now() - startTime;
        return {
          jobId,
          success: false,
          error: message,
          totalPollTimeMs,
          pollsAttempted,
        };
      }
    }

    // Timeout
    const totalPollTimeMs = Date.now() - startTime;
    throw new AsyncJobTimeoutError(jobId, timeout, pollsAttempted, totalPollTimeMs);
  }

  /**
   * Create a poll function that wraps an async check with a terminal-state detector.
   * Useful when the adapter needs custom logic per poll (e.g., different API calls
   * for status vs. retrieving the output).
   */
  static createPollFn<T = unknown>(
    checkFn: (jobId: string) => Promise<{
      isComplete: boolean;
      isFailed?: boolean;
      output?: T;
      error?: string;
    }>,
  ): PollFn<T> {
    return async (jobId: string) => {
      const result = await checkFn(jobId);
      if (result.isFailed) {
        return { status: 'failed', error: result.error || 'Unknown error' };
      }
      if (result.isComplete) {
        return { status: 'succeeded', output: result.output };
      }
      return { status: 'processing' };
    };
  }

  /**
   * Static convenience: run a job without instantiating a runner.
   */
  static async run<T = unknown>(
    submitFn: SubmitFn<T>,
    pollFn: PollFn<T>,
    config?: AsyncJobRunnerConfig,
  ): Promise<AsyncJobResult<T>> {
    const runner = new AsyncJobRunner(config);
    return runner.run(submitFn, pollFn);
  }

  /** Get current config values (useful for display/logging) */
  getConfig(): { pollIntervalMs: number; timeoutMs: number; verbose: boolean } {
    return {
      pollIntervalMs: this.pollIntervalMs,
      timeoutMs: this.timeoutMs,
      verbose: this.verbose,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
