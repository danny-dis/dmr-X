-- Agent Sessions (durable, resumable agent conversations)
-- Persists a ConversationState so a running agent can pause (e.g. for an
-- approval gate or a human answer) and be resumed after the event arrives,
-- surviving process restarts. Mirrors the in-memory ConversationState shape.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  -- Full ConversationState serialized as JSON
  state TEXT NOT NULL,
  -- Optional owning definition (for subagent sessions)
  agent_definition_id TEXT,
  -- Arbitrary metadata (last response, loaded skills, token counts)
  metadata TEXT,
  -- Machine status, indexed for "what is paused / ready to resume"
  status TEXT NOT NULL DEFAULT 'in_progress',
  -- Free-text reason for an interrupted/awaiting state (e.g. "approval: bash")
  status_reason TEXT,
  -- Which agent turn was last executed (for skill-nudge accounting)
  last_turn INTEGER NOT NULL DEFAULT 0,
  -- Skills loaded into context this session (progressive disclosure)
  loaded_skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Optional hard expiry; NULL = live until completed/cancelled
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant
ON agent_sessions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_instance
ON agent_sessions(agent_instance_id);

-- "What is paused / awaiting input?" — the resume queue
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
ON agent_sessions(tenant_id, status)
WHERE status IN ('awaiting_approval', 'interrupted', 'in_progress');

-- Parent link for declared subagents (isolation boundary: a subagent
-- belongs to a parent agent definition but inherits nothing else).
ALTER TABLE agent_definitions ADD COLUMN subagent_of TEXT REFERENCES agent_definitions(id) ON DELETE CASCADE;
ALTER TABLE agent_definitions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_definitions_subagent_of
ON agent_definitions(subagent_of)
WHERE subagent_of IS NOT NULL;
