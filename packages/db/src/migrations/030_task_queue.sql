-- Add retry/backoff/priority columns to worker_jobs
ALTER TABLE worker_jobs ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE worker_jobs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE worker_jobs ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_jobs ADD COLUMN next_retry_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN backoff_ms INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE worker_jobs ADD COLUMN dead_letter_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN enqueued_by TEXT;
ALTER TABLE worker_jobs ADD COLUMN enqueued_at TEXT NOT NULL DEFAULT (datetime('now'));

-- Index for queue polling: find next job to process
CREATE INDEX IF NOT EXISTS idx_worker_jobs_queue
  ON worker_jobs(status, priority, next_retry_at)
  WHERE status IN ('pending', 'retryable');

-- Recover crashed jobs from previous run
UPDATE worker_jobs
SET status = 'retryable',
    retries = retries + 1,
    next_retry_at = datetime('now')
WHERE status = 'running';
