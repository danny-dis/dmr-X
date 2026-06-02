-- Worker registry for background job processing
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'background',
  status TEXT NOT NULL DEFAULT 'active',
  hostname TEXT,
  pid INTEGER,
  load REAL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- Worker job queue
CREATE TABLE IF NOT EXISTS worker_jobs (
  id TEXT PRIMARY KEY,
  worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_status ON worker_jobs(status);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_worker ON worker_jobs(worker_id);
