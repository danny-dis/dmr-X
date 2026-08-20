-- Add time-based budget to jobs (budgetDurationMs).
-- A job with budgetDurationMs set will be blocked once
-- Date.now() - createdAt >= budgetDurationMs.

ALTER TABLE jobs ADD COLUMN budget_duration_ms INTEGER;
