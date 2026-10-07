-- Scope reversible compression originals to their authenticated owner.
ALTER TABLE compression_cache ADD COLUMN tenant_id TEXT;
ALTER TABLE compression_cache ADD COLUMN api_key_id TEXT;
CREATE INDEX IF NOT EXISTS idx_compression_cache_owner
  ON compression_cache(tenant_id, api_key_id, expires_at);
