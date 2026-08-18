-- Migration 064: Add key_lookup_hash column + index for O(1) API key lookup.
--
-- The current auth middleware performs a full table scan or relies on
-- key_hash (which is salted and cannot be looked up directly). Adding a
-- plain SHA-256 hash of the raw key enables O(1) indexed lookups without
-- storing the raw key itself.
--
-- Backfill: legacy rows with unsalted key_hash (no colon) get key_lookup_hash
-- = key_hash. Salted rows (colon present) cannot be backfilled — the plaintext
-- key is not available — and remain NULL, reachable only via the bounded
-- fallback scan (key_lookup_hash IS NULL).

ALTER TABLE api_keys ADD COLUMN key_lookup_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_lookup_hash
  ON api_keys(key_lookup_hash)
  WHERE key_lookup_hash IS NULL;

-- Backfill legacy unsalted rows
UPDATE api_keys
   SET key_lookup_hash = key_hash
 WHERE key_lookup_hash IS NULL
   AND instr(key_hash, ':') = 0;
