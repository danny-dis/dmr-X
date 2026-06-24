-- Conversation contexts table (persistent MCP context storage)
-- Stores conversation context for dmrx_context_save/load tools
CREATE TABLE IF NOT EXISTS conversation_contexts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  messages TEXT NOT NULL DEFAULT '[]',  -- JSON array of ChatMessage objects
  metadata TEXT DEFAULT '{}',           -- JSON object for additional data
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,                      -- NULL = never expires (permanent)
  is_permanent INTEGER DEFAULT 0        -- 1 = ignore TTL, never auto-delete
);

CREATE INDEX IF NOT EXISTS idx_conv_ctx_user ON conversation_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_ctx_created ON conversation_contexts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_ctx_expires ON conversation_contexts(expires_at);

-- Conversation context tags for search/organization
CREATE TABLE IF NOT EXISTS conversation_context_tags (
  context_id TEXT REFERENCES conversation_contexts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (context_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_conv_ctx_tags_tag ON conversation_context_tags(tag);
