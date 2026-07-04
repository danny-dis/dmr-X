-- Quota-Share: distribute provider quota across team keys

CREATE TABLE IF NOT EXISTS quota_share_pools (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  window_seconds INTEGER NOT NULL DEFAULT 18000, -- 5 hours
  policy TEXT NOT NULL DEFAULT 'soft' CHECK (policy IN ('hard', 'soft', 'burst')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quota_share_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_name TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  cap_requests INTEGER, -- NULL = unlimited within share
  cap_tokens INTEGER,   -- NULL = unlimited within share
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pool_id) REFERENCES quota_share_pools(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quota_share_pool_provider ON quota_share_pools(provider_id);
CREATE INDEX IF NOT EXISTS idx_quota_share_alloc_pool ON quota_share_allocations(pool_id);
CREATE INDEX IF NOT EXISTS idx_quota_share_alloc_key ON quota_share_allocations(key_id);
