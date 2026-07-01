-- Persist rate-limit cooldowns, penalties, and hit tracking across restarts
-- Previously this state was in-memory only and lost on gateway restart

CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  cooldown_expiry INTEGER NOT NULL,       -- epoch ms when cooldown expires
  penalty_points INTEGER NOT NULL DEFAULT 0,
  last_penalty_at INTEGER,                -- epoch ms of last penalty
  hit_timestamps TEXT DEFAULT '[]',       -- JSON array of epoch ms (24h window)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_rl_cooldowns_active
ON rate_limit_cooldowns(cooldown_expiry)
WHERE cooldown_expiry > 0;

-- Provider-wide daily request caps (persisted across restarts)
CREATE TABLE IF NOT EXISTS rate_limit_daily_caps (
  provider_id TEXT NOT NULL PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL           -- epoch ms of current 24h window
);
