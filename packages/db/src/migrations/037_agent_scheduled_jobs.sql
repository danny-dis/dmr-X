-- Agent Scheduled Jobs
-- Persists cron/event trigger jobs across gateway restarts

CREATE TABLE IF NOT EXISTS agent_scheduled_jobs (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_next_run
ON agent_scheduled_jobs(next_run_at, enabled)
WHERE enabled = 1;

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_tenant
ON agent_scheduled_jobs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_definition
ON agent_scheduled_jobs(agent_definition_id);
