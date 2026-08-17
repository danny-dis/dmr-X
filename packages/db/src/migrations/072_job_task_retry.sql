-- Add retry tracking to job_tasks for task-level retry with exponential backoff.
-- When a task fails with a transient error, it is reset to 'pending' with
-- retry_after set to a future timestamp; the scheduler's readyTasks skips it
-- until backoff elapses.

ALTER TABLE job_tasks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE job_tasks ADD COLUMN retry_after TEXT;
