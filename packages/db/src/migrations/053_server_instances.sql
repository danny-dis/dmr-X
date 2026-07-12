-- G0DM0D3 auto-install server instances
-- Tracks locally managed G0DM0D3 servers (cloned + launched by DMR-X).

CREATE TABLE IF NOT EXISTS server_instances (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'g0dm0d3',
  url TEXT,
  api_key TEXT,
  openrouter_key_ref TEXT,
  runtime TEXT,
  status TEXT NOT NULL DEFAULT 'stopped',
  pid INTEGER,
  container_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
