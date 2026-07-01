-- Dynamic Rate Limit Detection
-- Tracks real-time rate limit state per API key from provider responses

-- Per-key rate limit state (populated from X-RateLimit-* headers)
CREATE TABLE IF NOT EXISTS provider_key_rate_limits (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  -- Request limits
  requests_limit INTEGER,
  requests_remaining INTEGER,
  requests_reset_at TEXT,  -- ISO timestamp when window resets
  -- Token limits
  tokens_limit INTEGER,
  tokens_remaining INTEGER,
  tokens_reset_at TEXT,
  -- Metadata
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  last_request_at TEXT,
  -- Daily aggregates
  requests_today INTEGER DEFAULT 0,
  tokens_today INTEGER DEFAULT 0,
  -- Learned limits (from error messages or header analysis)
  learned_rpm INTEGER,
  learned_tpm INTEGER,
  learned_rpd INTEGER,
  learned_tpd INTEGER,
  UNIQUE(key_id, model_id)
);

-- Index for quick lookup by key
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_key
ON provider_key_rate_limits(key_id, model_id);

-- Index for provider-level queries
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_provider
ON provider_key_rate_limits(provider_id, last_updated);

-- Index for finding keys with remaining quota
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_remaining
ON provider_key_rate_limits(requests_remaining, tokens_remaining);

-- Rate limit discovery log (tracks when limits were discovered/updated)
CREATE TABLE IF NOT EXISTS rate_limit_discovery_log (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  discovery_method TEXT NOT NULL,  -- 'header', 'error_message', 'test_request'
  old_limit INTEGER,
  new_limit INTEGER,
  limit_type TEXT NOT NULL,  -- 'rpm', 'tpm', 'rpd', 'tpd'
  discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for discovery log queries
CREATE INDEX IF NOT EXISTS idx_discovery_log_key
ON rate_limit_discovery_log(key_id, discovered_at DESC);

-- Provider-level rate limit defaults (fallback when no per-key data)
CREATE TABLE IF NOT EXISTS provider_rate_limits (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  -- Defaults from catalog
  default_rpm INTEGER,
  default_tpm INTEGER,
  default_rpd INTEGER,
  default_tpd INTEGER,
  -- Learned overrides
  learned_rpm INTEGER,
  learned_tpm INTEGER,
  learned_rpd INTEGER,
  learned_tpd INTEGER,
  last_learned_at TEXT,
  PRIMARY KEY (provider_id, model_id)
);
