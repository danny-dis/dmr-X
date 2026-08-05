-- Conversations table (persistent history)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  title TEXT,
  mode TEXT DEFAULT 'chat',          -- chat, image, embed, tts, rerank, moderate, agentic, tool-loop, godmode, agent
  model TEXT,
  is_temporary INTEGER DEFAULT 0,    -- 1 = don't persist to DB
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- Messages table (conversation turns)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- 'user', 'assistant', 'system'
  content TEXT,
  audio_url TEXT,                    -- For TTS responses
  image_url TEXT,                    -- For image responses
  embedding_data TEXT,               -- For embed responses (JSON)
  model TEXT,
  provider TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  routing_decision TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- Full-text search for conversations
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  title,
  content='conversations',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, title) VALUES('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE OF title ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, title) VALUES('delete', old.rowid, old.title);
  INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title);
END;