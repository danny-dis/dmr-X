-- Explicit workspace-to-workspace grants. Sharing does not transfer instance,
-- session, memory, credentials, usage, edit or administration ownership.
CREATE TABLE IF NOT EXISTS agent_definition_shares (
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  recipient_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'run')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_definition_id, recipient_tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_definition_shares_recipient
  ON agent_definition_shares(recipient_tenant_id);
