-- Semantic Response Cache
-- Inspired by workweave/router's semantic cache that uses cosine similarity
-- on prompt embeddings to find near-duplicate requests and short-circuit
-- before hitting upstream providers.
--
-- This table stores cached responses keyed by prompt embeddings.
-- The embedding is stored as a BLOB (Float32Array buffer) for fast
-- cosine similarity computation at lookup time.

CREATE TABLE IF NOT EXISTS semantic_cache_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  response TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Index for tenant-scoped lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_semantic_cache_tenant
ON semantic_cache_entries(tenant_id, request_type, expires_at)
WHERE expires_at > datetime('now');

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires
ON semantic_cache_entries(expires_at);

-- Index for eviction (lowest hit_count first)
CREATE INDEX IF NOT EXISTS idx_semantic_cache_eviction
ON semantic_cache_entries(hit_count ASC, created_at ASC);
