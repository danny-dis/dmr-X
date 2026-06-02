-- Migration versioning table
-- Tracks which migrations have been applied to prevent re-execution

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
