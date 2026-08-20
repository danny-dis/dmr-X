import { jobStore } from '@dmr-x/agent-runtime';
import { logger } from '@dmr-x/utils';

import { createTaskExecutor, driveJob } from './job-runner.js';

// ---------------------------------------------------------------------------
// Job queue
//
// Jobs run for minutes. Driving one inside a request handler means the client
// holds a connection for the whole run, and a client that gives up leaves the
// work orphaned mid-task. So POST /jobs/:id/run enqueues and returns
// immediately; callers poll GET /jobs/:id.
//
// In-process and unpersisted by design: the queue is a schedule, not a record.
// The record is the job's own status in SQLite, which is why an interrupted
// run can be recovered on startup by re-queueing jobs still marked running
// (see recoverInterruptedJobs). Moving to multiple gateway processes would
// need a real broker, or two of them would drive the same job at once.
// ---------------------------------------------------------------------------

/**
 * Jobs driven at once. sql.js is synchronous WebAssembly on the single JS
 * thread, so concurrent jobs interleave rather than parallelise, and a high
 * number mostly starves inbound HTTP.
 */
const DEFAULT_CONCURRENCY = 2;

interface QueueEntry {
  tenantId: string;
  jobId: string;
  enqueuedAt: number;
}

export interface EnqueueResult {
  /** False when the job was already queued or already running. */
  accepted: boolean;
  position: number;
  reason?: string;
}

export interface JobQueueStats {
  queued: number;
  active: number;
  concurrency: number;
  activeJobIds: string[];
}

class JobQueue {
  private readonly pending: QueueEntry[] = [];
  private readonly active = new Set<string>();
  private concurrency = DEFAULT_CONCURRENCY;
  private draining = false;
  private stopped = false;

  configure(opts: { concurrency?: number }): void {
    if (opts.concurrency && opts.concurrency > 0) {
      this.concurrency = Math.floor(opts.concurrency);
    }
  }

  /**
   * Schedule a job. Enqueuing the same job twice is rejected rather than
   * ignored: two passes over one job would run the same ready task twice and
   * charge for it twice.
   */
  enqueue(tenantId: string, jobId: string): EnqueueResult {
    if (this.stopped) {
      return { accepted: false, position: -1, reason: 'queue is shutting down' };
    }
    if (this.active.has(jobId)) {
      return { accepted: false, position: 0, reason: 'job is already running' };
    }
    const existing = this.pending.findIndex((e) => e.jobId === jobId);
    if (existing !== -1) {
      return { accepted: false, position: existing + 1, reason: 'job is already queued' };
    }

    this.pending.push({ tenantId, jobId, enqueuedAt: Date.now() });
    // Read the position before draining: drain's synchronous prologue may pull
    // this very entry off the queue, which would report a waiting job as 0.
    const position = this.pending.length;

    // Kick the drain loop without blocking the caller's response.
    void this.drain();
    return { accepted: true, position };
  }

  /** Remove a job that has not started yet. Returns true if it was waiting. */
  dequeue(jobId: string): boolean {
    const index = this.pending.findIndex((e) => e.jobId === jobId);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    return true;
  }

  isQueued(jobId: string): boolean {
    return this.active.has(jobId) || this.pending.some((e) => e.jobId === jobId);
  }

  stats(): JobQueueStats {
    return {
      queued: this.pending.length,
      active: this.active.size,
      concurrency: this.concurrency,
      activeJobIds: [...this.active],
    };
  }

  /**
   * Re-queue jobs left mid-flight by a crash or restart. A job marked running
   * with no queue entry behind it would otherwise sit untouched forever.
   * runJobPass reclaims any task stranded in 'running', so a re-queued job
   * resumes rather than double-running the interrupted task.
   *
   * `blocked` jobs are recovered too, but only when a pending task still has
   * retry attempts left. A transient provider outage parks tasks with a future
   * `retryAfter` and flips the job to 'blocked'; without this, that job stayed
   * blocked forever even once the provider recovered. A job blocked by a real
   * deadlock (cycle, dangling dependency) has no retryable task and is left
   * alone, so it does not churn the queue on every restart.
   */
  recoverInterrupted(tenantIds: string[]): number {
    let recovered = 0;
    for (const tenantId of tenantIds) {
      let jobs: ReturnType<typeof jobStore.listJobs>;
      try {
        jobs = [
          ...jobStore.listJobs(tenantId, { status: 'running' }),
          ...jobStore.listJobs(tenantId, { status: 'blocked' }).filter((job) =>
            this.hasRetryableTask(tenantId, job.id),
          ),
        ];
      } catch (error) {
        logger.error({ err: error, tenantId }, 'job-queue: failed to list recoverable jobs');
        continue;
      }
      for (const job of jobs) {
        if (this.isQueued(job.id)) continue;
        this.enqueue(tenantId, job.id);
        recovered++;
      }
    }
    if (recovered > 0) {
      logger.info({ recovered }, 'job-queue: re-queued jobs interrupted by a restart');
    }
    return recovered;
  }

  /**
   * True when a job has at least one pending task that has not exhausted its
   * retry budget — i.e. driving the job again could still make progress.
   */
  private hasRetryableTask(tenantId: string, jobId: string): boolean {
    try {
      return jobStore
        .listTasks(tenantId, jobId)
        .some((t) => t.status === 'pending' && (t.attempt ?? 0) <= (t.maxRetries ?? 3));
    } catch (error) {
      logger.warn({ err: error, jobId }, 'job-queue: failed to inspect tasks for recovery');
      return false;
    }
  }

  /** Stop accepting work and wait for in-flight jobs, up to a timeout. */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.stopped = true;
    this.pending.length = 0;
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (this.active.size > 0) {
      logger.warn(
        { active: this.active.size },
        'job-queue: shutting down with jobs still running; they resume on next start',
      );
    }
  }

  /**
   * Start jobs until concurrency is reached. Re-entrant by design — the guard
   * means many enqueue calls collapse into one loop rather than each spawning
   * their own.
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (!this.stopped && this.pending.length > 0 && this.active.size < this.concurrency) {
        const entry = this.pending.shift()!;
        this.active.add(entry.jobId);

        // Deliberately not awaited: the loop must keep filling slots while
        // this job runs. Errors are handled inside runOne, which never throws.
        void this.runOne(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Drive one job to completion. Never throws. */
  private async runOne(entry: QueueEntry): Promise<void> {
    const startedAt = Date.now();
    const waitedMs = startedAt - entry.enqueuedAt;

    try {
      logger.info({ jobId: entry.jobId, waitedMs }, 'job-queue: starting job');
      const result = await driveJob(entry.tenantId, entry.jobId, createTaskExecutor());
      logger.info(
        {
          jobId: entry.jobId,
          state: result.state,
          reason: result.reason,
          durationMs: Date.now() - startedAt,
        },
        'job-queue: job finished',
      );
    } catch (error) {
      // driveJob is documented not to throw, but a job silently vanishing from
      // the queue would be worse than a noisy log, so this stays.
      logger.error({ err: error, jobId: entry.jobId }, 'job-queue: job threw unexpectedly');
    } finally {
      this.active.delete(entry.jobId);
      // A finished job frees a slot; pull the next one in.
      void this.drain();
    }
  }
}

export const jobQueue = new JobQueue();
