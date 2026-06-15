-- Multi-key providers + tier field
--
-- The providers table used to carry a single API key in `config.apiKey`
-- (encrypted) and a single `api_key_ref` (an env-var name). That made it
-- impossible to attach a second key to the same provider, so operators
-- who wanted to mix free and paid keys for the same upstream (e.g.
-- Google's free tier + a paid Workspace key) had to create a second
-- provider row — but `name` is UNIQUE, so the activate flow silently
-- clobbered the first one.
--
-- This migration adds:
--   * providers.tier       — denormalised cache; recomputed by the admin
--                             routes on every key mutation.
--   * provider_keys        — one row per credential. The highest-priority
--                             active row is the one the adapter uses; the
--                             rest are available for future round-robin
--                             / per-model overrides.
--
-- The backfill at the bottom preserves existing credentials (the
-- ciphertext is moved unchanged — no re-encrypt pass needed) and uses a
-- simple model-level heuristic to seed the tier column for legacy rows.

ALTER TABLE providers ADD COLUMN tier TEXT NOT NULL DEFAULT 'paid';

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label TEXT,
  tier TEXT NOT NULL DEFAULT 'paid',
  api_key_encrypted TEXT,
  oauth_access_token_encrypted TEXT,
  oauth_refresh_token_encrypted TEXT,
  oauth_token_expires_at TEXT,
  auth_method TEXT NOT NULL DEFAULT 'api_key',
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active
  ON provider_keys(provider_id, is_active, priority DESC);

-- One-time backfill: for every provider that already has credentials
-- stored, create a default provider_keys row. The tier is derived from
-- the seeded model_profiles: if any model has a free-tier marker
-- (rate_limit_rpm set, or a monthly budget), we label the connection
-- "free". Otherwise "paid".
--
-- The `<provider_id>-default` ID convention matches the gateway's lookup
-- in admin.routes.ts (`label = 'Default'` for the primary key).
INSERT OR IGNORE INTO provider_keys (
  id, provider_id, label, tier,
  api_key_encrypted, oauth_access_token_encrypted,
  oauth_refresh_token_encrypted, oauth_token_expires_at, auth_method,
  priority, is_active
)
SELECT
  p.id || '-default' AS id,
  p.id AS provider_id,
  'Default' AS label,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM model_profiles mp
      WHERE mp.provider_id = p.id
        AND (mp.rate_limit_rpm IS NOT NULL
             OR mp.rate_limit_rpd IS NOT NULL
             OR mp.monthly_token_budget IS NOT NULL)
    ) THEN 'free'
    ELSE 'paid'
  END AS tier,
  -- The legacy key is stored encrypted in `config.apiKey` (see
  -- encryptConfigApiKey in packages/utils/src/crypto.ts). Move it
  -- unchanged so the gateway's decrypt path keeps working.
  CASE WHEN json_type(p.config, '$.apiKey') = 'text'
       THEN json_extract(p.config, '$.apiKey')
       ELSE NULL END AS api_key_encrypted,
  p.oauth_access_token,
  p.oauth_refresh_token,
  p.oauth_token_expires_at,
  COALESCE(p.auth_method, 'api_key') AS auth_method,
  0 AS priority,
  1 AS is_active
FROM providers p
WHERE (json_type(p.config, '$.apiKey') = 'text' AND length(json_extract(p.config, '$.apiKey')) > 0)
   OR p.oauth_access_token IS NOT NULL;

-- Recompute the denormalised tier for every provider based on the keys
-- it now has. The expression is small enough to inline: if there are no
-- active keys, mark inactive; otherwise the set of distinct tiers among
-- the active keys collapses to free / paid / mixed.
UPDATE providers
SET tier = CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM provider_keys pk
    WHERE pk.provider_id = providers.id AND pk.is_active = 1
  ) THEN 'inactive'
  WHEN (
    SELECT COUNT(DISTINCT pk.tier) FROM provider_keys pk
    WHERE pk.provider_id = providers.id AND pk.is_active = 1
  ) > 1 THEN 'mixed'
  WHEN (
    SELECT pk.tier FROM provider_keys pk
    WHERE pk.provider_id = providers.id AND pk.is_active = 1
    ORDER BY pk.priority DESC, pk.created_at ASC LIMIT 1
  ) = 'free' THEN 'free'
  ELSE 'paid'
END;
