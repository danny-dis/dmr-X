-- Add expires_at column to api_keys for key expiration
-- Keys with expires_at in the past will be automatically rejected
-- NULL expires_at means the key never expires (backward compatible)

ALTER TABLE api_keys ADD COLUMN expires_at TEXT;

-- Index for efficient expiry checks
CREATE INDEX IF NOT EXISTS idx_api_keys_expires
ON api_keys(expires_at)
WHERE is_active = 1 AND expires_at IS NOT NULL;
