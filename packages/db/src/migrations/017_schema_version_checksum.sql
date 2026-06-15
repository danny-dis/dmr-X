-- Add a checksum column to schema_version.
--
-- The migration runner computes a SHA-256 of each migration's SQL
-- content and stores it here. On startup, the runner re-hashes the
-- migration source (whether it came from disk or the embedded
-- MIGRATIONS constant) and compares. A mismatch means someone edited
-- a migration file after it was applied — the schema is no longer
-- what the runner thinks it is, so we refuse to start (in production)
-- or warn loudly (in development).
--
-- The column is nullable so existing rows survive this ALTER. On the
-- first run after this migration is applied, the runner backfills the
-- checksum for any pre-existing row in one pass and from then on
-- enforces the invariant on every startup.

ALTER TABLE schema_version ADD COLUMN checksum TEXT;
