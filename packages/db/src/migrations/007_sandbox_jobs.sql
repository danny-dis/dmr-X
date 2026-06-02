-- Sandbox jobs for ephemeral code execution
CREATE TABLE IF NOT EXISTS sandbox_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  language TEXT NOT NULL DEFAULT 'python',
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  isolation_level TEXT NOT NULL DEFAULT 'process',
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  max_retries INTEGER NOT NULL DEFAULT 2,
  retries INTEGER NOT NULL DEFAULT 0,
  output TEXT,
  error TEXT,
  resource_cpu REAL,
  resource_memory INTEGER,
  resource_io INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sandbox_jobs_status ON sandbox_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sandbox_jobs_tenant ON sandbox_jobs(tenant_id);
