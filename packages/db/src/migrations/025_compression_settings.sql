-- Compression settings migration

-- Add compression columns to tenants table
ALTER TABLE tenants ADD COLUMN compression_enabled INTEGER;
ALTER TABLE tenants ADD COLUMN compression_algorithm TEXT;
ALTER TABLE tenants ADD COLUMN compression_reversible INTEGER;

-- Add compression columns to api_keys table
ALTER TABLE api_keys ADD COLUMN compression_enabled INTEGER;
ALTER TABLE api_keys ADD COLUMN compression_algorithm TEXT;
ALTER TABLE api_keys ADD COLUMN compression_reversible INTEGER;

-- Add compression columns to request_logs table
ALTER TABLE request_logs ADD COLUMN compression_tokens_saved INTEGER;
ALTER TABLE request_logs ADD COLUMN compression_algorithm TEXT;

-- Create compression cache table for reversible compression
CREATE TABLE IF NOT EXISTS compression_cache (
  id TEXT PRIMARY KEY,
  original_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compression_cache_expires ON compression_cache(expires_at);