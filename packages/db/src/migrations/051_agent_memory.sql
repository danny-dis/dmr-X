-- Agent memory (Hermes-style session vs long-term memory)
-- Stores agent memories scoped to tenant + agent, optionally to a session.
-- session_id IS NULL => long-term / cross-session memory.

CREATE TABLE agent_memories (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  session_id TEXT,
  kind       TEXT NOT NULL DEFAULT 'long_term',
  content    TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_agent_memories_tenant_agent_kind
  ON agent_memories (tenant_id, agent_id, kind);

CREATE INDEX idx_agent_memories_tenant_agent_session
  ON agent_memories (tenant_id, agent_id, session_id);
