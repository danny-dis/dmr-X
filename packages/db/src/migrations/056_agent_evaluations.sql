-- Lightweight built-in agent evaluation records
-- Stores evaluation outcomes produced by the agent runtime after chat runs.

CREATE TABLE IF NOT EXISTS agent_evaluations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  tool_success_rate REAL NOT NULL DEFAULT 0,
  budget_adherence REAL NOT NULL DEFAULT 0,
  turn_efficiency REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  breakdown TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_evaluations_instance
  ON agent_evaluations(tenant_id, agent_instance_id, created_at);
