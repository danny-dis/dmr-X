-- Migration 065: Agentic session store (durable /agentic/chat state).
--
-- Persists conversation state so /agentic/chat can be PAUSED (e.g. awaiting
-- tool approval) and RESUMED across gateway restarts. Scoped to the
-- instance-less agentic endpoint: agent_sessions requires agent_instance_id.

CREATE TABLE IF NOT EXISTS agentic_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  status_reason TEXT,
  last_turn INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agentic_sessions_tenant
  ON agentic_sessions(tenant_id, updated_at DESC);
