-- Add `running` column to agent_scheduled_jobs for at-most-once delivery.
-- When a scheduler instance claims a job via atomic CAS, it sets running = 1.
-- If the instance crashes, running stays 1; on restart, the scheduler detects
-- stuck jobs (running = 1 but no active process) and resets them.

ALTER TABLE agent_scheduled_jobs ADD COLUMN running INTEGER NOT NULL DEFAULT 0;
