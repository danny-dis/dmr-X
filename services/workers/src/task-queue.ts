import crypto from 'node:crypto';
import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type {
  QueuedJob,
  EnqueueInput,
  QueueConfig,
  QueueStats,
} from './task-queue.types.js';

const cache = createNamespacedCache('task-queue');
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class TaskQueue {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private maxConcurrentJobs: number;
  private processing = false;

  constructor(config?: QueueConfig) {
    this.pollIntervalMs = config?.pollIntervalMs ?? 1000;
    this.maxConcurrentJobs = config?.maxConcurrentJobs ?? 20;
  }

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      if (this.processing) return;
      this.processing = true;
      this.poll().finally(() => { this.processing = false; });
    }, this.pollIntervalMs);
    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Task queue started');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info('Task queue stopped');
  }

  enqueue(input: EnqueueInput): QueuedJob {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO worker_jobs (id, job_type, payload, status, priority, max_retries, retries, backoff_ms, enqueued_by, enqueued_at)
      VALUES (?, ?, ?, 'pending', ?, ?, 0, 1000, ?, ?)
    `).run(
      id,
      input.jobType,
      input.payload,
      input.priority ?? 'normal',
      input.maxRetries ?? 3,
      input.enqueuedBy ?? null,
      now
    );

    cache.delete('stats');
    logger.debug({ jobId: id, jobType: input.jobType, priority: input.priority }, 'Job enqueued');

    return {
      id,
      jobType: input.jobType,
      payload: input.payload,
      priority: input.priority ?? 'normal',
      maxRetries: input.maxRetries ?? 3,
      retries: 0,
      nextRetryAt: null,
      backoffMs: 1000,
      deadLetterAt: null,
      enqueuedBy: input.enqueuedBy ?? null,
      enqueuedAt: now,
      status: 'pending',
      workerId: null,
      startedAt: null,
      completedAt: null,
      error: null,
    };
  }

  async poll(): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS).toISOString();

    try {
      // Recover stuck jobs (running for too long)
      const stuckResult = db.prepare(`
        UPDATE worker_jobs SET status = 'retryable', retries = retries + 1,
          next_retry_at = ?, backoff_ms = backoff_ms * 2
        WHERE status = 'running' AND started_at < ? AND dead_letter_at IS NULL
      `).run(now, cutoff);

      if (stuckResult.changes > 0) {
        logger.warn({ count: stuckResult.changes }, 'Recovered stuck jobs');
        cache.delete('stats');
      }

      // Count running jobs
      const runningCount = db.prepare(
        `SELECT COUNT(*) as count FROM worker_jobs WHERE status = 'running'`
      ).get() as { count: number };

      const availableSlots = this.maxConcurrentJobs - runningCount.count;
      if (availableSlots <= 0) return;

      // Get next jobs ordered by priority then enqueue time
      const jobs = db.prepare(`
        SELECT * FROM worker_jobs
        WHERE (status = 'pending' OR (status = 'retryable' AND (next_retry_at IS NULL OR next_retry_at <= ?)))
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END,
          enqueued_at ASC
        LIMIT ?
      `).all(now, availableSlots) as any[];

      if (jobs.length === 0) return;

      // Batch query available workers once
      const workers = db.prepare(`
        SELECT id FROM workers WHERE status = 'active'
        ORDER BY load ASC, jobs_processed ASC LIMIT ?
      `).all(jobs.length) as { id: string }[];

      if (workers.length === 0) return;

      // Assign jobs to workers in a transaction
      db.prepare('BEGIN TRANSACTION').run();
      try {
        let workerIdx = 0;
        for (const job of jobs) {
          if (workerIdx >= workers.length) break;
          const worker = workers[workerIdx];

          // Atomic assignment: only assign if still pending/retryable
          const result = db.prepare(`
            UPDATE worker_jobs
            SET status = 'running', worker_id = ?, started_at = ?
            WHERE id = ? AND status IN ('pending', 'retryable')
          `).run(worker.id, now, job.id);

          if (result.changes > 0) {
            db.prepare(`
              UPDATE workers SET jobs_processed = jobs_processed + 1 WHERE id = ?
            `).run(worker.id);
            workerIdx++;
            logger.debug({ jobId: job.id, workerId: worker.id }, 'Job assigned to worker');
          }
        }
        db.prepare('COMMIT').run();
      } catch (err) {
        db.prepare('ROLLBACK').run();
        throw err;
      }

      // Handle failed jobs: move to retryable or dead_letter
      const failedCount = db.prepare(
        `SELECT COUNT(*) as count FROM worker_jobs WHERE status = 'failed' AND dead_letter_at IS NULL`
      ).get() as { count: number };

      if (failedCount.count > 0) {
        const failedJobs = db.prepare(`
          SELECT * FROM worker_jobs WHERE status = 'failed' AND dead_letter_at IS NULL
        `).all() as any[];

        for (const job of failedJobs) {
          if (job.retries >= job.max_retries) {
            db.prepare(`
              UPDATE worker_jobs SET status = 'dead_letter', dead_letter_at = ? WHERE id = ?
            `).run(now, job.id);
            logger.warn({ jobId: job.id, retries: job.retries }, 'Job moved to dead letter');
          } else {
            const backoff = this.calculateBackoff(job.backoff_ms, job.retries);
            const nextRetryAt = new Date(Date.now() + backoff).toISOString();
            db.prepare(`
              UPDATE worker_jobs SET status = 'retryable', retries = retries + 1, next_retry_at = ?, backoff_ms = ? WHERE id = ?
            `).run(nextRetryAt, backoff, job.id);
            logger.debug({ jobId: job.id, retries: job.retries + 1, backoff }, 'Job scheduled for retry');
          }
        }
      }

      cache.delete('stats');
    } catch (err) {
      logger.error({ err }, 'Task queue poll error');
    }
  }

  private calculateBackoff(baseMs: number, retries: number): number {
    const exponential = baseMs * Math.pow(2, retries);
    const jitter = exponential * (1 + Math.random() * 0.25);
    return Math.min(Math.round(jitter), 60000);
  }

  getStats(): QueueStats {
    const cached = cache.get('stats');
    if (cached) return JSON.parse(cached);

    const db = getDb();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count FROM worker_jobs
      WHERE status IN ('pending', 'retryable', 'running', 'completed', 'failed', 'dead_letter')
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const stats: QueueStats = {
      pending: 0,
      retryable: 0,
      running: 0,
      completed: 0,
      failed: 0,
      deadLetter: 0,
    };

    for (const row of rows) {
      if (row.status === 'dead_letter') stats.deadLetter = row.count;
      else if (row.status in stats) {
        (stats as any)[row.status] = row.count;
      }
    }

    cache.set('stats', JSON.stringify(stats), 5);
    return stats;
  }

  listDeadLetter(limit = 50): QueuedJob[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM worker_jobs WHERE status = 'dead_letter'
      ORDER BY dead_letter_at DESC LIMIT ?
    `).all(limit) as any[];
    return rows.map(r => this.mapRow(r));
  }

  cleanupDeadLetter(keepDays: number = 7): number {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM worker_jobs WHERE status = 'dead_letter'
      AND dead_letter_at < datetime('now', '-' || ? || ' days')
    `).run(keepDays);
    cache.delete('stats');
    return result.changes;
  }

  private mapRow(row: any): QueuedJob {
    return {
      id: row.id,
      jobType: row.job_type,
      payload: row.payload,
      priority: row.priority,
      maxRetries: row.max_retries,
      retries: row.retries,
      nextRetryAt: row.next_retry_at,
      backoffMs: row.backoff_ms,
      deadLetterAt: row.dead_letter_at,
      enqueuedBy: row.enqueued_by,
      enqueuedAt: row.enqueued_at,
      status: row.status,
      workerId: row.worker_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
    };
  }
}

export const taskQueue = new TaskQueue();
