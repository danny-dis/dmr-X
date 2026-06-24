-- Add quality_target and free_tier_strategy columns to request_logs
-- Enables per-mode performance analysis (frontier/balanced/economy + free tier strategies)

ALTER TABLE request_logs ADD COLUMN quality_target TEXT;
ALTER TABLE request_logs ADD COLUMN free_tier_strategy TEXT;

-- Indexes for filtering by mode
CREATE INDEX IF NOT EXISTS idx_request_logs_quality_target ON request_logs(quality_target, timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_free_tier_strategy ON request_logs(free_tier_strategy, timestamp);
