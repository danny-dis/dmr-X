-- Per-run agent session step telemetry
-- Stores each turn in an agent chat run for auditing/debugging.

CREATE TABLE IF NOT EXISTS session_steps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  budget_status TEXT NOT NULL DEFAULT 'within',
  allowed_tool_call_names TEXT NOT NULL DEFAULT '[]',
  blocked_tool_call_names TEXT NOT NULL DEFAULT '[]',
  tool_results TEXT NOT NULL DEFAULT '[]',
  token_delta INTEGER NOT NULL DEFAULT 0,
  cost_delta REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_steps_conversation
  ON session_steps(tenant_id, conversation_id, turn);
