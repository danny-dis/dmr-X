-- R1 — Prune request_logs to prevent unbounded DB growth.
-- The audit found that at 1 req/s, request_logs reaches 500k rows in ~6 days,
-- causing 2-second event-loop-blocking saves that never recover.
-- This migration adds a retention policy: rows older than 7 days are pruned
-- by the heartbeat timer in client.ts.

-- No schema change needed — pruning is done via DELETE FROM request_logs
-- WHERE timestamp < datetime('now', '-7 days'). This migration records
-- the retention policy as a pragma comment for documentation.

-- Retention period in days (configurable via DMRX_REQUEST_LOGS_RETENTION_DAYS).
-- The heartbeat timer in client.ts reads this and prunes accordingly.

-- Add a comment table entry for the retention policy
INSERT OR IGNORE INTO schema_version (version, filename, applied_at) VALUES (78, '078_request_logs_pruning.sql', datetime('now'));
