-- Federation peer nodes for cross-cluster routing
CREATE TABLE IF NOT EXISTS federation_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  api_key_ref TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'anonymized',
  latency_ms REAL,
  last_sync_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_federation_nodes_status ON federation_nodes(status);
