-- Persist per-key OAuth-style scopes. Stored as a JSON-encoded array
-- of strings; NULL means "no scopes configured" (treated as full access
-- for backwards compatibility with keys created before this column existed).
ALTER TABLE api_keys ADD COLUMN scopes TEXT;
