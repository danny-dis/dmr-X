-- Agent Jobs: durable, resumable multi-step jobs.
-- A job captures a raw request (brief) from the api / ui / mcp entry
-- points and tracks it through the intake -> planning -> running ->
-- blocked -> verifying -> delivered / failed / cancelled lifecycle.
-- The plan, result, and decision log are stored as JSON text; spend
-- and budget are tracked so a job can be gated on cost like an agent run.

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submitted_by TEXT,
  source TEXT NOT NULL,             -- 'api' | 'ui' | 'mcp'
  brief TEXT NOT NULL,
  acceptance_criteria TEXT,         -- JSON
  status TEXT NOT NULL DEFAULT 'intake',
    -- intake | planning | running | blocked | verifying | delivered | failed | cancelled
  budget_usd REAL,
  budget_tokens INTEGER,
  deadline_at TEXT,
  max_depth INTEGER NOT NULL DEFAULT 3,
  spent_usd REAL NOT NULL DEFAULT 0,
  spent_tokens INTEGER NOT NULL DEFAULT 0,
  plan TEXT,                        -- JSON
  result TEXT,                      -- JSON
  decision_log TEXT,                -- JSON
  pin_agents INTEGER NOT NULL DEFAULT 0,  -- 1 = keep agents pinned across turns
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant
ON jobs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_jobs_status
ON jobs(status);

-- Job tasks: ordered steps within a job, optionally nested via
-- parent_task_id for subtask trees. Execution order within a level is
-- by seq; depends_on holds a JSON array of task ids that must finish
-- first. assigned_model is the concrete model resolved at dispatch.
CREATE TABLE IF NOT EXISTS job_tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES job_tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  deliverable TEXT,
  acceptance TEXT,
  assigned_agent_def_id TEXT,
  assigned_agent_version TEXT,
  assigned_instance_id TEXT,
  session_id TEXT,
  assigned_model TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  depends_on TEXT,                  -- JSON array of task ids
  attempt INTEGER NOT NULL DEFAULT 0,
  output TEXT,                      -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_tasks_job
ON job_tasks(job_id);

CREATE INDEX IF NOT EXISTS idx_job_tasks_status
ON job_tasks(status);
