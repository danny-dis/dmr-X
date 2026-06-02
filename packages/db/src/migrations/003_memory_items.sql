-- Memory Items table for RAG/memory storage
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'manual',
  embedding_model TEXT,
  redaction_status TEXT NOT NULL DEFAULT 'clean',
  retention_days INTEGER NOT NULL DEFAULT 90,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  retrieved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_items_tenant ON memory_items(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_namespace ON memory_items(namespace);
