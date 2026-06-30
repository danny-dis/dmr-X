-- Secret Versions: Encrypted secret storage with versioning and rotation
-- Supports secure storage of API keys, tokens, and other sensitive values
-- with automatic version management and rotation tracking.

CREATE TABLE IF NOT EXISTS secret_versions (
  id TEXT PRIMARY KEY,
  secret_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  encrypted_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rotated_at TEXT,
  revoked_at TEXT,
  UNIQUE(secret_id, version)
);

-- Index for efficient secret lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_secret_versions_lookup
  ON secret_versions(secret_id, status, version DESC);
