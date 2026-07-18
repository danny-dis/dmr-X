// Auto-generated from packages/db/src/migrations/*.sql
// DO NOT EDIT MANUALLY — run: bun run packages/db/scripts/generate-migrations-data.ts

export const MIGRATIONS: Record<number, { filename: string; sql: string }> = {
  1: {
    filename: '001_initial_schema.sql',
    sql: `-- DMR-X Initial Schema (SQLite)

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = 1;

-- Providers
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  adapter_type TEXT NOT NULL,
  base_url TEXT,
  api_key_ref TEXT,
  is_healthy INTEGER NOT NULL DEFAULT 1,
  last_health_check TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Model Profiles
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  modality TEXT NOT NULL,
  intelligence_layer TEXT NOT NULL DEFAULT 'executor',

  -- Capability flags
  supports_streaming INTEGER NOT NULL DEFAULT 0,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_tool_use INTEGER NOT NULL DEFAULT 0,
  supports_json_mode INTEGER NOT NULL DEFAULT 0,
  supports_function_call INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,

  -- LLM-specific
  context_window INTEGER,
  max_output_tokens INTEGER,

  -- Diffusion-specific
  max_resolution TEXT,
  supported_formats TEXT,
  supports_inpainting INTEGER NOT NULL DEFAULT 0,
  supports_img2img INTEGER NOT NULL DEFAULT 0,

  -- Embedding-specific
  embedding_dimensions INTEGER,
  max_input_tokens INTEGER,

  -- Pricing
  input_cost_per_1k REAL NOT NULL DEFAULT 0,
  output_cost_per_1k REAL NOT NULL DEFAULT 0,
  cost_per_image REAL NOT NULL DEFAULT 0,
  cost_per_1k_chars REAL NOT NULL DEFAULT 0,

  -- Quality
  quality_score REAL NOT NULL DEFAULT 0.5,
  avg_latency_ms INTEGER,

  -- Free-tier / rate limit metadata
  rate_limit_rpm INTEGER,
  rate_limit_rpd INTEGER,
  rate_limit_tpm INTEGER,
  rate_limit_tpd INTEGER,
  monthly_token_budget INTEGER,
  intelligence_rank INTEGER,
  speed_rank INTEGER,

  -- Status
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_profiles_modality ON model_profiles(modality) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider ON model_profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider_model
  ON model_profiles(provider_id, model_id)
  WHERE is_active = 1;

-- Policies
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quota Allocations
CREATE TABLE IF NOT EXISTS quota_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id TEXT REFERENCES providers(id),
  max_requests INTEGER,
  max_tokens INTEGER,
  max_cost REAL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Request Logs (single table, no partitioning)
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  tenant_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),

  -- Routing decision
  task_profile TEXT,
  routing_plan TEXT,
  selected_provider TEXT,
  selected_model TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  fallback_reason TEXT,

  -- Performance
  latency_ms INTEGER,
  time_to_first_token_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,

  -- Cost
  estimated_cost REAL,

  -- Quality
  quality_score REAL,
  quality_signals TEXT,

  -- Error
  error_code TEXT,
  error_message TEXT,

  PRIMARY KEY (id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_request_logs_tenant ON request_logs(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(selected_provider, timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);

-- Benchmark Results
CREATE TABLE IF NOT EXISTS benchmark_results (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
  benchmark_type TEXT NOT NULL,
  score REAL NOT NULL,
  details TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_model ON benchmark_results(model_id, run_at DESC);

-- Health Checks
CREATE TABLE IF NOT EXISTS health_checks (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  is_healthy INTEGER NOT NULL,
  latency_ms INTEGER,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_checks_provider ON health_checks(provider_id, checked_at DESC);

-- Billing Records
CREATE TABLE IF NOT EXISTS billing_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_records_tenant ON billing_records(tenant_id, created_at DESC);

-- Usage Records
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_records_tenant ON usage_records(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_provider_model ON usage_records(provider_id, model_id, created_at DESC);

-- Settings (key-value config store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  2: {
    filename: '002_migration_versioning.sql',
    sql: `-- Migration versioning table
-- Tracks which migrations have been applied to prevent re-execution

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  3: {
    filename: '003_memory_items.sql',
    sql: `-- Memory Items table for RAG/memory storage
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
`,
  },
  4: {
    filename: '004_oauth_tokens.sql',
    sql: `-- OAuth token storage for providers
-- Tokens are stored encrypted using the same AES-256-GCM scheme as API keys

ALTER TABLE providers ADD COLUMN oauth_access_token TEXT;
ALTER TABLE providers ADD COLUMN oauth_refresh_token TEXT;
ALTER TABLE providers ADD COLUMN oauth_token_expires_at TEXT;
ALTER TABLE providers ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'api_key';
`,
  },
  5: {
    filename: '005_memory_embeddings.sql',
    sql: `-- Memory embeddings for semantic search
ALTER TABLE memory_items ADD COLUMN embedding BLOB;
ALTER TABLE memory_items ADD COLUMN embedding_dim INTEGER;
`,
  },
  6: {
    filename: '006_workers.sql',
    sql: `-- Worker registry for background job processing
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'background',
  status TEXT NOT NULL DEFAULT 'active',
  hostname TEXT,
  pid INTEGER,
  load REAL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- Worker job queue
CREATE TABLE IF NOT EXISTS worker_jobs (
  id TEXT PRIMARY KEY,
  worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_status ON worker_jobs(status);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_worker ON worker_jobs(worker_id);
`,
  },
  7: {
    filename: '007_sandbox_jobs.sql',
    sql: `-- Sandbox jobs for ephemeral code execution
CREATE TABLE IF NOT EXISTS sandbox_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  language TEXT NOT NULL DEFAULT 'python',
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  isolation_level TEXT NOT NULL DEFAULT 'process',
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  max_retries INTEGER NOT NULL DEFAULT 2,
  retries INTEGER NOT NULL DEFAULT 0,
  output TEXT,
  error TEXT,
  resource_cpu REAL,
  resource_memory INTEGER,
  resource_io INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sandbox_jobs_status ON sandbox_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sandbox_jobs_tenant ON sandbox_jobs(tenant_id);
`,
  },
  8: {
    filename: '008_federation_nodes.sql',
    sql: `-- Federation peer nodes for cross-cluster routing
CREATE TABLE IF NOT EXISTS federation_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  api_key_ref TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'anonymized',
  latency_ms REAL,
  last_sync_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_federation_nodes_status ON federation_nodes(status);
`,
  },
  9: {
    filename: '009_add_missing_indexes.sql',
    sql: `-- Missing indexes for foreign key columns and frequently-queried lookups
-- These prevent full table scans during routing, auth, and quota checks

-- Providers: name is queried by adapter ID in auto-register, health checker, and admin routes
CREATE INDEX IF NOT EXISTS idx_providers_name ON providers(name);

-- Policies: tenant_id is used in policy filtering during every routing request
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id);

-- Quota allocations: tenant_id is used in quota filtering during every routing request
CREATE INDEX IF NOT EXISTS idx_quota_allocations_tenant ON quota_allocations(tenant_id);
`,
  },
  10: {
    filename: '010_add_capability_tier.sql',
    sql: `-- Add capability_tier column to model_profiles
-- This separates source classification (intelligence_layer) from actual capability (capability_tier)
ALTER TABLE model_profiles ADD COLUMN capability_tier TEXT NOT NULL DEFAULT 'executor';

-- Index for routing queries that filter by capability tier
CREATE INDEX IF NOT EXISTS idx_model_profiles_capability_tier
ON model_profiles(capability_tier)
WHERE is_active = 1;
`,
  },
  11: {
    filename: '011_elo_and_playground_feedback.sql',
    sql: `-- Phase 1: Add Elo Rating to Model Profiles
ALTER TABLE model_profiles ADD COLUMN elo_rating REAL NOT NULL DEFAULT 1200;

-- Phase 5: Playground Feedback table
CREATE TABLE IF NOT EXISTS playground_feedback (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
  user_id TEXT, -- Optional, for tracking specific users
  
  -- Explicit feedback
  rating INTEGER, -- 1 for thumbs up, -1 for thumbs down
  feedback_text TEXT,
  
  -- Implicit feedback (JSON flags)
  implicit_signals TEXT DEFAULT '{}', -- e.g. {"copied": true, "regenerated": true}
  
  -- Battle outcome (if comparison was used)
  is_winner INTEGER, -- 1 if this model won the comparison
  competitor_model_id TEXT REFERENCES model_profiles(id),
  
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_playground_feedback_model ON playground_feedback(model_id);
CREATE INDEX IF NOT EXISTS idx_playground_feedback_request ON playground_feedback(request_id);
`,
  },
  12: {
    filename: '012_conversations.sql',
    sql: `-- Conversations table (persistent history)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  title TEXT,
  mode TEXT DEFAULT 'chat',          -- chat, image, embed, tts, rerank, moderate
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
END;`,
  },
  13: {
    filename: '013_message_events.sql',
    sql: `-- Persist SSE event traces (agentic, tool-loop, etc.) on each message.
-- JSON-encoded array of { name, data } events. NULL means no events
-- were captured (regular chat messages).
ALTER TABLE messages ADD COLUMN events TEXT;
`,
  },
  14: {
    filename: '014_api_key_scopes.sql',
    sql: `-- Persist per-key OAuth-style scopes. Stored as a JSON-encoded array
-- of strings; NULL means "no scopes configured" (treated as full access
-- for backwards compatibility with keys created before this column existed).
ALTER TABLE api_keys ADD COLUMN scopes TEXT;
`,
  },
  15: {
    filename: '015_provider_keys_and_tier.sql',
    sql: `-- Multi-key providers + tier field
--
-- The providers table used to carry a single API key in \`config.apiKey\`
-- (encrypted) and a single \`api_key_ref\` (an env-var name). That made it
-- impossible to attach a second key to the same provider, so operators
-- who wanted to mix free and paid keys for the same upstream (e.g.
-- Google's free tier + a paid Workspace key) had to create a second
-- provider row — but \`name\` is UNIQUE, so the activate flow silently
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
-- The \`<provider_id>-default\` ID convention matches the gateway's lookup
-- in admin.routes.ts (\`label = 'Default'\` for the primary key).
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
  -- The legacy key is stored encrypted in \`config.apiKey\` (see
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
`,
  },
  16: {
    filename: '016_messages_tenant_id.sql',
    sql: `-- Persist tenant_id on the messages table so row-level tenant filtering
-- is possible without an extra JOIN to conversations. This is the
-- companion to conversations.tenant_id (added in 012) and closes the
-- cross-tenant data leak in apps/gateway/src/routes/conversation.routes.ts.
--
-- The column is added with no FK reference to tenants(id) on purpose:
-- messages are CASCADE-deleted with their parent conversation, and a
-- second FK on the same parent would create ambiguity. We do not backfill
-- existing rows — pre-migration messages retain NULL tenant_id and are
-- treated as "unowned" by the new tenant-scoped queries (a NULL
-- \`tenant_id = ?\` comparison never matches, so they're invisible to
-- any tenant after the route is patched, which is the safe direction).

ALTER TABLE messages ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
`,
  },
  17: {
    filename: '017_schema_version_checksum.sql',
    sql: `-- Add a checksum column to schema_version.
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
`,
  },
  18: {
    filename: '018_subscription_only_models.sql',
    sql: `-- Add subscription_only column to model_profiles
-- This flag indicates a model is only available via OAuth subscription auth (not API key)
-- Used for Codex (ChatGPT subscription), Claude (Anthropic subscription), and GitHub Copilot models

ALTER TABLE model_profiles ADD COLUMN subscription_only INTEGER NOT NULL DEFAULT 0;

-- Index for filtering subscription-only models
CREATE INDEX IF NOT EXISTS idx_model_profiles_subscription_only
ON model_profiles(subscription_only)
WHERE is_active = 1 AND subscription_only = 1;
`,
  },
  19: {
    filename: '019_api_key_allowed_tools.sql',
    sql: `-- Per-API-key tool restrictions. Stored as a JSON-encoded array
-- of tool patterns (e.g. ["dmrx_chat", "dmrx_embed", "dmrx_*"]). NULL means
-- "no restrictions" (all tools allowed). This enables fine-grained control
-- over which MCP tools a key can invoke.
ALTER TABLE api_keys ADD COLUMN allowed_tools TEXT;`,
  },
  20: {
    filename: '020_request_logs_mode_tracking.sql',
    sql: `-- Add quality_target and free_tier_strategy columns to request_logs
-- Enables per-mode performance analysis (frontier/balanced/economy + free tier strategies)

ALTER TABLE request_logs ADD COLUMN quality_target TEXT;
ALTER TABLE request_logs ADD COLUMN free_tier_strategy TEXT;

-- Indexes for filtering by mode
CREATE INDEX IF NOT EXISTS idx_request_logs_quality_target ON request_logs(quality_target, timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_free_tier_strategy ON request_logs(free_tier_strategy, timestamp);
`,
  },
  21: {
    filename: '021_conversation_contexts.sql',
    sql: `-- Conversation contexts table (persistent MCP context storage)
-- Stores conversation context for dmrx_context_save/load tools
CREATE TABLE IF NOT EXISTS conversation_contexts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  messages TEXT NOT NULL DEFAULT '[]',  -- JSON array of ChatMessage objects
  metadata TEXT DEFAULT '{}',           -- JSON object for additional data
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,                      -- NULL = never expires (permanent)
  is_permanent INTEGER DEFAULT 0        -- 1 = ignore TTL, never auto-delete
);

CREATE INDEX IF NOT EXISTS idx_conv_ctx_user ON conversation_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_ctx_created ON conversation_contexts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_ctx_expires ON conversation_contexts(expires_at);

-- Conversation context tags for search/organization
CREATE TABLE IF NOT EXISTS conversation_context_tags (
  context_id TEXT REFERENCES conversation_contexts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (context_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_conv_ctx_tags_tag ON conversation_context_tags(tag);
`,
  },
  22: {
    filename: '022_api_key_salted_hash.sql',
    sql: `-- Re-hash existing API keys with salt for improved security
-- This migration adds a salt column and re-hashes all existing key_hash values
-- to use the new salted format (salt:hash) instead of plain SHA-256.

-- Add salt column to api_keys table
ALTER TABLE api_keys ADD COLUMN key_salt TEXT;

-- Note: The actual re-hashing of existing keys will be done by the application
-- on startup (in migrateApiKeysToSaltedHash function in client.ts).
-- This is because we need access to the original plaintext keys to re-hash them,
-- and those are not stored in the database.
`,
  },
  23: {
    filename: '023_api_key_expiry.sql',
    sql: `-- Add expires_at column to api_keys for key expiration
-- Keys with expires_at in the past will be automatically rejected
-- NULL expires_at means the key never expires (backward compatible)

ALTER TABLE api_keys ADD COLUMN expires_at TEXT;

-- Index for efficient expiry checks
CREATE INDEX IF NOT EXISTS idx_api_keys_expires
ON api_keys(expires_at)
WHERE is_active = 1 AND expires_at IS NOT NULL;
`,
  },
  24: {
    filename: '024_admin_audit_log.sql',
    sql: `-- Admin audit log for SOC2/ISO27001 compliance
-- Records all administrative actions for security auditing

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  admin_key_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT
);

-- Index for querying by timestamp (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp
ON admin_audit_log(timestamp DESC);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
ON admin_audit_log(action, timestamp DESC);

-- Index for querying by resource
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource
ON admin_audit_log(resource_type, resource_id);
`,
  },
  25: {
    filename: '025_compression_settings.sql',
    sql: `-- Compression settings migration

-- Add compression columns to tenants table
ALTER TABLE tenants ADD COLUMN compression_enabled INTEGER;
ALTER TABLE tenants ADD COLUMN compression_algorithm TEXT;
ALTER TABLE tenants ADD COLUMN compression_reversible INTEGER;

-- Add compression columns to api_keys table
ALTER TABLE api_keys ADD COLUMN compression_enabled INTEGER;
ALTER TABLE api_keys ADD COLUMN compression_algorithm TEXT;
ALTER TABLE api_keys ADD COLUMN compression_reversible INTEGER;

-- Add compression columns to request_logs table
ALTER TABLE request_logs ADD COLUMN compression_tokens_saved INTEGER;
ALTER TABLE request_logs ADD COLUMN compression_algorithm TEXT;

-- Create compression cache table for reversible compression
CREATE TABLE IF NOT EXISTS compression_cache (
  id TEXT PRIMARY KEY,
  original_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compression_cache_expires ON compression_cache(expires_at);`,
  },
  26: {
    filename: '026_semantic_cache.sql',
    sql: `-- Semantic Response Cache
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
`,
  },
  27: {
    filename: '027_tool_invocation_policies.sql',
    sql: `-- Tool invocation policies for controlling which tools can be called
-- Supports per-tenant, per-tool policies with approval workflows

CREATE TABLE IF NOT EXISTS tool_invocation_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  -- Policy action: 'allow', 'deny', 'require_approval'
  action TEXT NOT NULL DEFAULT 'allow',
  -- Optional conditions (JSON): tool input patterns, user roles, etc.
  conditions TEXT,
  -- Priority for rule ordering (higher = evaluated first)
  priority INTEGER NOT NULL DEFAULT 0,
  -- Description for audit logging
  description TEXT,
  -- Who created this policy
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one policy per tool per tenant
  UNIQUE(tenant_id, tool_name)
);

-- Index for querying by tenant (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_tool_invocation_policies_tenant
ON tool_invocation_policies(tenant_id, is_active);

-- Index for querying by tool name
CREATE INDEX IF NOT EXISTS idx_tool_invocation_policies_tool
ON tool_invocation_policies(tool_name, is_active);

-- Global policies (tenant_id = '*' applies to all tenants)
-- These are evaluated after tenant-specific policies

-- Policy evaluation cache for performance
CREATE TABLE IF NOT EXISTS tool_policy_evaluation_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT NOT NULL,
  -- Cached evaluation result: 'allow', 'deny', 'require_approval'
  result TEXT NOT NULL,
  -- Cache expiry (ISO timestamp)
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_tool_policy_cache_lookup
ON tool_policy_evaluation_cache(tenant_id, tool_name, tool_input_hash, expires_at);

-- Policy audit log for tracking all policy evaluations
CREATE TABLE IF NOT EXISTS tool_policy_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT,
  -- Evaluation result
  result TEXT NOT NULL,
  -- Policy ID that matched (if any)
  policy_id TEXT,
  -- Reason for denial/approval requirement
  reason TEXT,
  -- Request context
  request_id TEXT,
  user_id TEXT,
  ip_address TEXT
);

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_timestamp
ON tool_policy_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_tenant
ON tool_policy_audit_log(tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_tool
ON tool_policy_audit_log(tool_name, timestamp DESC);
`,
  },
  28: {
    filename: '028_tool_templates.sql',
    sql: `-- Tool Templates: Pre-configured tool call patterns
-- Users can save and reuse common tool call sequences

CREATE TABLE IF NOT EXISTS tool_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- JSON array of template steps
  steps TEXT NOT NULL,
  -- Tags for discovery
  tags TEXT,
  -- Version (semantic versioning)
  version TEXT NOT NULL DEFAULT '1.0.0',
  -- Who created this
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one template name per tenant
  UNIQUE(tenant_id, name)
);

-- Index for querying by tenant
CREATE INDEX IF NOT EXISTS idx_tool_templates_tenant
ON tool_templates(tenant_id, is_active);

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_tool_templates_name
ON tool_templates(name, is_active);

-- Tool Presets: Default parameters per tenant/tool
CREATE TABLE IF NOT EXISTS tool_presets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  -- Default parameter values (JSON)
  defaults TEXT NOT NULL,
  -- Forced parameter values that cannot be overridden (JSON)
  overrides TEXT,
  -- Priority for rule ordering (higher = evaluated first)
  priority INTEGER NOT NULL DEFAULT 0,
  -- Description for audit
  description TEXT,
  -- Who created this
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one preset per tool per tenant
  UNIQUE(tenant_id, tool_name)
);

-- Index for querying presets by tenant
CREATE INDEX IF NOT EXISTS idx_tool_presets_tenant
ON tool_presets(tenant_id, is_active);

-- Index for querying presets by tool
CREATE INDEX IF NOT EXISTS idx_tool_presets_tool
ON tool_presets(tool_name, is_active);

-- Template execution log for tracking usage
CREATE TABLE IF NOT EXISTS tool_template_executions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  template_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  -- Execution details
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER NOT NULL DEFAULT 0,
  -- Results
  output TEXT,
  error TEXT,
  -- Metrics
  duration_ms INTEGER,
  cost_usd REAL,
  -- Request context
  request_id TEXT,
  user_id TEXT,
  FOREIGN KEY (template_id) REFERENCES tool_templates(id)
);

-- Index for querying executions by template
CREATE INDEX IF NOT EXISTS idx_template_executions_template
ON tool_template_executions(template_id, timestamp DESC);

-- Index for querying executions by tenant
CREATE INDEX IF NOT EXISTS idx_template_executions_tenant
ON tool_template_executions(tenant_id, timestamp DESC);
`,
  },
  29: {
    filename: '029_secret_versions.sql',
    sql: `-- Secret Versions: Encrypted secret storage with versioning and rotation
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
`,
  },
  30: {
    filename: '030_dynamic_rate_limits.sql',
    sql: `-- Dynamic Rate Limit Detection
-- Tracks real-time rate limit state per API key from provider responses

-- Per-key rate limit state (populated from X-RateLimit-* headers)
CREATE TABLE IF NOT EXISTS provider_key_rate_limits (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  -- Request limits
  requests_limit INTEGER,
  requests_remaining INTEGER,
  requests_reset_at TEXT,  -- ISO timestamp when window resets
  -- Token limits
  tokens_limit INTEGER,
  tokens_remaining INTEGER,
  tokens_reset_at TEXT,
  -- Metadata
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  last_request_at TEXT,
  -- Daily aggregates
  requests_today INTEGER DEFAULT 0,
  tokens_today INTEGER DEFAULT 0,
  -- Learned limits (from error messages or header analysis)
  learned_rpm INTEGER,
  learned_tpm INTEGER,
  learned_rpd INTEGER,
  learned_tpd INTEGER,
  UNIQUE(key_id, model_id)
);

-- Index for quick lookup by key
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_key
ON provider_key_rate_limits(key_id, model_id);

-- Index for provider-level queries
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_provider
ON provider_key_rate_limits(provider_id, last_updated);

-- Index for finding keys with remaining quota
CREATE INDEX IF NOT EXISTS idx_key_rate_limits_remaining
ON provider_key_rate_limits(requests_remaining, tokens_remaining);

-- Rate limit discovery log (tracks when limits were discovered/updated)
CREATE TABLE IF NOT EXISTS rate_limit_discovery_log (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  discovery_method TEXT NOT NULL,  -- 'header', 'error_message', 'test_request'
  old_limit INTEGER,
  new_limit INTEGER,
  limit_type TEXT NOT NULL,  -- 'rpm', 'tpm', 'rpd', 'tpd'
  discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for discovery log queries
CREATE INDEX IF NOT EXISTS idx_discovery_log_key
ON rate_limit_discovery_log(key_id, discovered_at DESC);

-- Provider-level rate limit defaults (fallback when no per-key data)
CREATE TABLE IF NOT EXISTS provider_rate_limits (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  -- Defaults from catalog
  default_rpm INTEGER,
  default_tpm INTEGER,
  default_rpd INTEGER,
  default_tpd INTEGER,
  -- Learned overrides
  learned_rpm INTEGER,
  learned_tpm INTEGER,
  learned_rpd INTEGER,
  learned_tpd INTEGER,
  last_learned_at TEXT,
  PRIMARY KEY (provider_id, model_id)
);
`,
  },
  31: {
    filename: '031_rate_limit_state_persistence.sql',
    sql: `-- Persist rate-limit cooldowns, penalties, and hit tracking across restarts
-- Previously this state was in-memory only and lost on gateway restart

CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  cooldown_expiry INTEGER NOT NULL,       -- epoch ms when cooldown expires
  penalty_points INTEGER NOT NULL DEFAULT 0,
  last_penalty_at INTEGER,                -- epoch ms of last penalty
  hit_timestamps TEXT DEFAULT '[]',       -- JSON array of epoch ms (24h window)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_rl_cooldowns_active
ON rate_limit_cooldowns(cooldown_expiry)
WHERE cooldown_expiry > 0;

-- Provider-wide daily request caps (persisted across restarts)
CREATE TABLE IF NOT EXISTS rate_limit_daily_caps (
  provider_id TEXT NOT NULL PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL           -- epoch ms of current 24h window
);
`,
  },
  32: {
    filename: '032_credit_balance_system.sql',
    sql: `-- Credit/Balance system for prepaid spending limits
-- Enables top-ups, balance tracking, and hard spending limits

CREATE TABLE IF NOT EXISTS credits (
  tenant_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_topup_cents INTEGER NOT NULL DEFAULT 0,
  total_used_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'topup', 'usage', 'refund', 'adjustment'
  amount_cents INTEGER NOT NULL, -- positive for topup/refund, negative for usage
  balance_after_cents INTEGER NOT NULL,
  description TEXT,
  request_id TEXT,               -- links to usage_records for usage transactions
  admin_key_hash TEXT,           -- who performed the action
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant
ON credit_transactions(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_tx_type
ON credit_transactions(tenant_id, type, created_at DESC);
`,
  },
  33: {
    filename: '033_model_classifications.sql',
    sql: `-- Unified Model Classification
-- Tracks pricing tier, free/paid status, and verification state for all models

CREATE TABLE IF NOT EXISTS model_classifications (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  pricingTier TEXT NOT NULL DEFAULT 'unknown',  -- 'free' | 'free_with_limits' | 'paid' | 'subscription_only' | 'unknown'
  input_cost_per_1m REAL NOT NULL DEFAULT 0,
  output_cost_per_1m REAL NOT NULL DEFAULT 0,
  has_free_tier INTEGER NOT NULL DEFAULT 0,
  rate_limit_rpm INTEGER,
  rate_limit_rpd INTEGER,
  rate_limit_tpm INTEGER,
  rate_limit_tpd INTEGER,
  monthly_budget INTEGER NOT NULL DEFAULT 0,
  verified_free INTEGER NOT NULL DEFAULT 0,     -- 1 = runtime-verified free
  last_verification TEXT,                        -- ISO timestamp of last probe
  source TEXT NOT NULL DEFAULT 'catalog',        -- 'catalog' | 'runtime' | 'verified'
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_class_pricing
ON model_classifications(pricingTier);

CREATE INDEX IF NOT EXISTS idx_model_class_free
ON model_classifications(verified_free, pricingTier)
WHERE pricingTier IN ('free', 'free_with_limits');

CREATE INDEX IF NOT EXISTS idx_model_class_cost
ON model_classifications(input_cost_per_1m, output_cost_per_1m);
`,
  },
  34: {
    filename: '034_task_queue.sql',
    sql: `-- Add retry/backoff/priority columns to worker_jobs
ALTER TABLE worker_jobs ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE worker_jobs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE worker_jobs ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_jobs ADD COLUMN next_retry_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN backoff_ms INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE worker_jobs ADD COLUMN dead_letter_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN enqueued_by TEXT;
ALTER TABLE worker_jobs ADD COLUMN enqueued_at TEXT NOT NULL DEFAULT (datetime('now'));

-- Index for queue polling: find next job to process
CREATE INDEX IF NOT EXISTS idx_worker_jobs_queue
  ON worker_jobs(status, priority, next_retry_at)
  WHERE status IN ('pending', 'retryable');

-- Recover crashed jobs from previous run
UPDATE worker_jobs
SET status = 'retryable',
    retries = retries + 1,
    next_retry_at = datetime('now')
WHERE status = 'running';
`,
  },
  35: {
    filename: '035_fusion_panel.sql',
    sql: `-- Fusion Panel persistence
-- Stores multi-model parallel execution configurations

CREATE TABLE IF NOT EXISTS fusion_panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fusion_panel_slots (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES fusion_panels(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slot_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fusion_panel_slots_panel
ON fusion_panel_slots(panel_id, slot_order);

CREATE INDEX IF NOT EXISTS idx_fusion_panels_active
ON fusion_panels(is_active)
WHERE is_active = 1;
`,
  },
  36: {
    filename: '036_agent_platform.sql',
    sql: `-- Agent Platform
-- Agent definitions, instances, executions, and marketplace listings

-- Agent definitions: the blueprint for an agent
CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  system_prompt TEXT,
  personality TEXT,
  preferred_model TEXT,
  model_tier TEXT NOT NULL DEFAULT 'auto',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  custom_tools TEXT NOT NULL DEFAULT '[]',
  workflow TEXT,
  triggers TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private',
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  icon TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_tenant
ON agent_definitions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_visibility
ON agent_definitions(visibility)
WHERE visibility IN ('team', 'public');

CREATE INDEX IF NOT EXISTS idx_agent_definitions_category
ON agent_definitions(category)
WHERE category IS NOT NULL;

-- Agent instances: a deployed agent (definition + tenant-specific config)
CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  config_override TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_tenant
ON agent_instances(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_instances_definition
ON agent_instances(agent_definition_id);

CREATE INDEX IF NOT EXISTS idx_agent_instances_status
ON agent_instances(tenant_id, status)
WHERE status = 'active';

-- Agent execution logs
CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  input TEXT,
  output TEXT,
  tools_used TEXT NOT NULL DEFAULT '[]',
  model_used TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_instance
ON agent_executions(agent_instance_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_executions_tenant
ON agent_executions(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_executions_status
ON agent_executions(tenant_id, status);

-- Agent marketplace listings
CREATE TABLE IF NOT EXISTS agent_listings (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  publisher_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  long_description TEXT,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  icon TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  rating REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  install_count INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_listings_status
ON agent_listings(status)
WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_agent_listings_category
ON agent_listings(category, status)
WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_agent_listings_publisher
ON agent_listings(publisher_tenant_id);

-- Agent marketplace installs (track which tenants installed which agents)
CREATE TABLE IF NOT EXISTS agent_installs (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES agent_listings(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_installs_tenant
ON agent_installs(tenant_id);

-- Agent marketplace ratings
CREATE TABLE IF NOT EXISTS agent_ratings (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES agent_listings(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_ratings_listing
ON agent_ratings(listing_id);
`,
  },
  37: {
    filename: '037_agent_scheduled_jobs.sql',
    sql: `-- Agent Scheduled Jobs
-- Persists cron/event trigger jobs across gateway restarts

CREATE TABLE IF NOT EXISTS agent_scheduled_jobs (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_next_run
ON agent_scheduled_jobs(next_run_at, enabled)
WHERE enabled = 1;

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_tenant
ON agent_scheduled_jobs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_definition
ON agent_scheduled_jobs(agent_definition_id);
`,
  },
  38: {
    filename: '038_quota_share.sql',
    sql: `-- Quota-Share: distribute provider quota across team keys

CREATE TABLE IF NOT EXISTS quota_share_pools (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  window_seconds INTEGER NOT NULL DEFAULT 18000, -- 5 hours
  policy TEXT NOT NULL DEFAULT 'soft' CHECK (policy IN ('hard', 'soft', 'burst')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quota_share_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_name TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  cap_requests INTEGER, -- NULL = unlimited within share
  cap_tokens INTEGER,   -- NULL = unlimited within share
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pool_id) REFERENCES quota_share_pools(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quota_share_pool_provider ON quota_share_pools(provider_id);
CREATE INDEX IF NOT EXISTS idx_quota_share_alloc_pool ON quota_share_allocations(pool_id);
CREATE INDEX IF NOT EXISTS idx_quota_share_alloc_key ON quota_share_allocations(key_id);
`,
  },
  39: {
    filename: '039_judge_reliability.sql',
    sql: `-- Judge Reliability Tracking
-- Tracks inter-rater agreement between multiple AI judges evaluating the same battle.

CREATE TABLE IF NOT EXISTS judge_reliability (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  judge_model_a TEXT NOT NULL,          -- e.g. 'gpt-4o'
  judge_model_b TEXT NOT NULL,          -- e.g. 'claude-sonnet-4'
  kappa REAL,                           -- Cohen's kappa coefficient (-1 to 1)
  agreement_percent REAL,               -- Simple percent agreement (0-100)
  total_comparisons INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_judge_reliability_battle ON judge_reliability(battle_id);
CREATE INDEX IF NOT EXISTS idx_judge_reliability_judges ON judge_reliability(judge_model_a, judge_model_b);
`,
  },
  40: {
    filename: '040_benchmark_validations.sql',
    sql: `-- Benchmark Human Validation
-- Tracks human spot-checks of AI judge decisions to measure judge accuracy.

CREATE TABLE IF NOT EXISTS benchmark_validations (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  judge_winner TEXT NOT NULL,           -- What the AI judge decided ('A', 'B', 'Tie')
  human_winner TEXT NOT NULL,           -- What the human decided ('A', 'B', 'Tie')
  agreed INTEGER NOT NULL,              -- 1 if same, 0 if different
  reviewer_id TEXT,                     -- Optional reviewer identifier
  notes TEXT,                           -- Optional human notes
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_validations_battle ON benchmark_validations(battle_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_validations_agreed ON benchmark_validations(agreed);
`,
  },
  41: {
    filename: '041_nine_dimension_taxonomy.sql',
    sql: `-- Add 9-dimension taxonomy columns to model_profiles
-- This replaces the single-dimension CapabilityTier with a multi-dimensional classification system

-- Dimension 3: Task categories (JSON array of task types the model is good at)
ALTER TABLE model_profiles ADD COLUMN task_categories TEXT DEFAULT '["general"]';

-- Dimension 5: Context window tier
ALTER TABLE model_profiles ADD COLUMN context_tier TEXT DEFAULT 'medium';

-- Dimension 6: Deployment model (where the model runs)
ALTER TABLE model_profiles ADD COLUMN deployment TEXT DEFAULT 'cloud';

-- Dimension 7: Reasoning mode (how the model handles thinking)
ALTER TABLE model_profiles ADD COLUMN reasoning_mode TEXT DEFAULT 'fixed';

-- Dimension 8: Safety tier (whether model has deliberate capability limits)
ALTER TABLE model_profiles ADD COLUMN safety_tier TEXT DEFAULT 'standard';

-- Dimension 9: Agentic level (how much autonomy the model has)
ALTER TABLE model_profiles ADD COLUMN agentic_level TEXT DEFAULT 'chat';

-- Technical: Model architecture type
ALTER TABLE model_profiles ADD COLUMN architecture TEXT;

-- Technical: Total parameter count (null if unknown)
ALTER TABLE model_profiles ADD COLUMN parameter_count INTEGER;

-- Technical: Active parameters per token (for MoE models)
ALTER TABLE model_profiles ADD COLUMN active_parameters INTEGER;

-- Legal: License type
ALTER TABLE model_profiles ADD COLUMN license TEXT;

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_model_profiles_task_categories ON model_profiles(task_categories);
CREATE INDEX IF NOT EXISTS idx_model_profiles_context_tier ON model_profiles(context_tier);
CREATE INDEX IF NOT EXISTS idx_model_profiles_deployment ON model_profiles(deployment);
CREATE INDEX IF NOT EXISTS idx_model_profiles_reasoning_mode ON model_profiles(reasoning_mode);
CREATE INDEX IF NOT EXISTS idx_model_profiles_safety_tier ON model_profiles(safety_tier);
CREATE INDEX IF NOT EXISTS idx_model_profiles_agentic_level ON model_profiles(agentic_level);
`,
  },
  42: {
    filename: '042_backfill_taxonomy_from_legacy.sql',
    sql: `-- Backfill 9-dimension taxonomy columns from legacy intelligence_layer and capability_tier
-- This migration populates the new columns for existing models

-- Backfill context_tier from context_window
UPDATE model_profiles SET context_tier = 'short' WHERE context_tier = 'medium' AND context_window < 32000;
UPDATE model_profiles SET context_tier = 'medium' WHERE context_tier = 'medium' AND context_window >= 32000 AND context_window < 128000;
UPDATE model_profiles SET context_tier = 'long' WHERE context_tier = 'medium' AND context_window >= 128000 AND context_window < 1000000;
UPDATE model_profiles SET context_tier = 'ultra' WHERE context_tier = 'medium' AND context_window >= 1000000 AND context_window < 10000000;
UPDATE model_profiles SET context_tier = 'massive' WHERE context_tier = 'medium' AND context_window >= 10000000;

-- Backfill deployment from provider name
UPDATE model_profiles SET deployment = 'self_hosted' WHERE deployment = 'cloud' AND provider_id IN (
  SELECT id FROM providers WHERE name IN ('ollama', 'vllm', 'llamacpp', 'localai', 'lmstudio')
);

-- Backfill task_categories from specializations (basic mapping)
UPDATE model_profiles SET task_categories = '["reasoning"]' WHERE task_categories = '["general"]' AND supports_reasoning = 1;
UPDATE model_profiles SET task_categories = '["code"]' WHERE task_categories = '["general"]' AND model_id LIKE '%codestral%' OR model_id LIKE '%coder%';
UPDATE model_profiles SET task_categories = '["embedding"]' WHERE task_categories = '["general"]' AND modality = 'embedding';
UPDATE model_profiles SET task_categories = '["tts"]' WHERE task_categories = '["general"]' AND modality = 'audio_tts';
UPDATE model_profiles SET task_categories = '["stt"]' WHERE task_categories = '["general"]' AND modality = 'audio_stt';
UPDATE model_profiles SET task_categories = '["image_generation"]' WHERE task_categories = '["general"]' AND modality = 'diffusion';
UPDATE model_profiles SET task_categories = '["moderation"]' WHERE task_categories = '["general"]' AND modality = 'moderation';

-- Backfill reasoning_mode from capabilities
UPDATE model_profiles SET reasoning_mode = 'hybrid' WHERE reasoning_mode = 'fixed' AND supports_reasoning = 1 AND model_id LIKE '%deepseek%';
UPDATE model_profiles SET reasoning_mode = 'adaptive' WHERE reasoning_mode = 'fixed' AND model_id LIKE '%gpt-5%';

-- Backfill agentic_level from capabilities
UPDATE model_profiles SET agentic_level = 'tool_use' WHERE agentic_level = 'chat' AND supports_tool_use = 1;

-- Log completion
SELECT 'Backfill complete: ' || changes || ' rows updated' FROM (SELECT COUNT(*) as changes FROM model_profiles WHERE context_tier != 'medium');
`,
  },
  43: {
    filename: '043_add_architecture_dimension.sql',
    sql: `-- Formalize ModelArchitecture as Dimension 2 of the 9-dimension taxonomy.
-- The 'architecture' column was added in migration 041 but not typed as a taxonomy dimension.
-- Rename to 'architecture_tier' for consistency with other taxonomy column names.

-- Rename column (SQLite doesn't support ALTER COLUMN, so we need to recreate the table)
-- Since we can't rename columns in SQLite, we'll just add an index for the existing column
-- and update the application code to use it as Dimension 2.

CREATE INDEX IF NOT EXISTS idx_model_profiles_architecture ON model_profiles(architecture);
`,
  },
  44: {
    filename: '044_backfill_new_taxonomy.sql',
    sql: `-- Backfill taxonomy data for existing models
-- This migration populates architecture and other taxonomy fields for models
-- that were registered before the taxonomy system was fully adopted.

-- Backfill architecture tier from model_id patterns
UPDATE model_profiles SET architecture = 'moe'
WHERE architecture IS NULL AND (
  model_id LIKE '%mixtral%' OR
  model_id LIKE '%grok%' OR
  model_id LIKE '%mistral-large%' OR
  model_id LIKE '%deepseek-v3%' OR
  model_id LIKE '%deepseek-v4%' OR
  model_id LIKE '%qwen%235b%' OR
  model_id LIKE '%phi-4-moe%'
);

UPDATE model_profiles SET architecture = 'ssm'
WHERE architecture IS NULL AND (
  model_id LIKE '%mamba%' OR
  model_id LIKE '%jamba%'
);

UPDATE model_profiles SET architecture = 'hybrid'
WHERE architecture IS NULL AND (
  model_id LIKE '%zamba%' OR
  model_id LIKE '%jamba-hybrid%'
);

UPDATE model_profiles SET architecture = 'dense'
WHERE architecture IS NULL AND (
  model_id LIKE '%gpt%' OR
  model_id LIKE '%claude%' OR
  model_id LIKE '%gemini%' OR
  model_id LIKE '%llama%' OR
  model_id LIKE '%phi%' OR
  model_id LIKE '%qwen%' OR
  model_id LIKE '%mistral%' OR
  model_id LIKE '%yi%' OR
  model_id LIKE '%command%' OR
  model_id LIKE '%embed%' OR
  model_id LIKE '%whisper%' OR
  model_id LIKE '%dall%' OR
  model_id LIKE '%stable%' OR
  model_id LIKE '%flux%'
);

-- Default remaining to unknown
UPDATE model_profiles SET architecture = 'unknown' WHERE architecture IS NULL;

-- Backfill context_tier from context_window (for models that still have default 'medium')
UPDATE model_profiles SET context_tier = 'short' WHERE context_tier = 'medium' AND context_window < 32000;
UPDATE model_profiles SET context_tier = 'medium' WHERE context_tier = 'medium' AND context_window >= 32000 AND context_window < 128000;
UPDATE model_profiles SET context_tier = 'long' WHERE context_tier = 'medium' AND context_window >= 128000 AND context_window < 1000000;
UPDATE model_profiles SET context_tier = 'ultra' WHERE context_tier = 'medium' AND context_window >= 1000000 AND context_window < 10000000;
UPDATE model_profiles SET context_tier = 'massive' WHERE context_tier = 'medium' AND context_window >= 10000000;

-- Backfill deployment from provider name (for models that still have default 'cloud')
UPDATE model_profiles SET deployment = 'self_hosted' WHERE deployment = 'cloud' AND provider_id IN (
  SELECT id FROM providers WHERE name IN ('ollama', 'vllm', 'llamacpp', 'localai', 'lmstudio')
);

-- Backfill agentic_level from capabilities (for models that still have default 'chat')
UPDATE model_profiles SET agentic_level = 'tool_use' WHERE agentic_level = 'chat' AND supports_tool_use = 1;
UPDATE model_profiles SET agentic_level = 'autonomous' WHERE agentic_level = 'chat' AND (
  model_id LIKE '%gpt-5%' OR
  model_id LIKE '%gemini%pro%' OR
  model_id LIKE '%grok%4%'
);
`,
  },
  45: {
    filename: '045_skills.sql',
    sql: `-- Skills subsystem
-- A skill is a reusable markdown document an agent can possess
-- (similar to a hermes-agent SKILL.md).

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'builtin',
  external_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_skills_tenant ON skills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_skills_tenant_name ON skills(tenant_id, name);
`,
  },
  46: {
    filename: '046_agent_skills.sql',
    sql: `-- Persist the list of skill ids an agent possesses on the agent definition.
-- Stored as a JSON array (TEXT) to keep the schema simple and avoid a
-- separate join table / migration of the row shape.

ALTER TABLE agent_definitions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
`,
  },
  47: {
    filename: '047_agent_humanname.sql',
    sql: `-- Store an optional human-friendly display name for an agent definition.
-- "humanName" lets a built agent be addressed by a friendly name rather
-- than only its machine \`name\` (slug).
-- personality column was added in 036_agent_platform.sql; this migration
-- only introduces the optional human_name column.

ALTER TABLE agent_definitions ADD COLUMN human_name TEXT;
`,
  },
  48: {
    filename: '048_skill_pinned.sql',
    sql: `-- Skill pinning flag
-- Pinned skills are curated/safe and CANNOT be auto-patched by the
-- autonomous agent path (patchSkillContent / createSkillFromAgent).
-- 0 = false (mutable), 1 = true (pinned, mutation forbidden).

ALTER TABLE skills ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
`,
  },
  49: {
    filename: '049_agent_skill_nudge.sql',
    sql: `-- Store the optional opt-in interval (in turns) at which an agent is
-- nudged to capture or refine a reusable skill. 0 disables the nudge.
-- Default 8 turns. Used only at prompt-construction time (instructional).

ALTER TABLE agent_definitions ADD COLUMN skill_nudge_interval INTEGER NOT NULL DEFAULT 8;
`,
  },
  50: {
    filename: '050_scheduled_job_prompt.sql',
    sql: `-- Scheduled job prompt + max steps
-- Lets each scheduled job carry its own prompt and step limit instead of a
-- hard-coded default.

ALTER TABLE agent_scheduled_jobs ADD COLUMN prompt TEXT;
ALTER TABLE agent_scheduled_jobs ADD COLUMN max_steps INTEGER NOT NULL DEFAULT 5;
`,
  },
  51: {
    filename: '051_agent_memory.sql',
    sql: `-- Agent memory (Hermes-style session vs long-term memory)
-- Stores agent memories scoped to tenant + agent, optionally to a session.
-- session_id IS NULL => long-term / cross-session memory.

CREATE TABLE agent_memories (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  session_id TEXT,
  kind       TEXT NOT NULL DEFAULT 'long_term',
  content    TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_agent_memories_tenant_agent_kind
  ON agent_memories (tenant_id, agent_id, kind);

CREATE INDEX idx_agent_memories_tenant_agent_session
  ON agent_memories (tenant_id, agent_id, session_id);
`,
  },
  52: {
    filename: '052_agent_verify_on_stop.sql',
    sql: `-- Verify-on-stop safety flag for agent definitions
-- When enabled, the runtime nudges the agent to self-check its final answer.

ALTER TABLE agent_definitions ADD COLUMN verify_on_stop INTEGER NOT NULL DEFAULT 0;
`,
  },
  53: {
    filename: '053_server_instances.sql',
    sql: `-- G0DM0D3 auto-install server instances
-- Tracks locally managed G0DM0D3 servers (cloned + launched by DMR-X).

CREATE TABLE IF NOT EXISTS server_instances (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'g0dm0d3',
  url TEXT,
  api_key TEXT,
  openrouter_key_ref TEXT,
  runtime TEXT,
  status TEXT NOT NULL DEFAULT 'stopped',
  pid INTEGER,
  container_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  54: {
    filename: '054_agent_sessions.sql',
    sql: `-- Agent Sessions (durable, resumable agent conversations)
-- Persists a ConversationState so a running agent can pause (e.g. for an
-- approval gate or a human answer) and be resumed after the event arrives,
-- surviving process restarts. Mirrors the in-memory ConversationState shape.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  -- Full ConversationState serialized as JSON
  state TEXT NOT NULL,
  -- Optional owning definition (for subagent sessions)
  agent_definition_id TEXT,
  -- Arbitrary metadata (last response, loaded skills, token counts)
  metadata TEXT,
  -- Machine status, indexed for "what is paused / ready to resume"
  status TEXT NOT NULL DEFAULT 'in_progress',
  -- Free-text reason for an interrupted/awaiting state (e.g. "approval: bash")
  status_reason TEXT,
  -- Which agent turn was last executed (for skill-nudge accounting)
  last_turn INTEGER NOT NULL DEFAULT 0,
  -- Skills loaded into context this session (progressive disclosure)
  loaded_skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Optional hard expiry; NULL = live until completed/cancelled
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant
ON agent_sessions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_instance
ON agent_sessions(agent_instance_id);

-- "What is paused / awaiting input?" — the resume queue
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
ON agent_sessions(tenant_id, status)
WHERE status IN ('awaiting_approval', 'interrupted', 'in_progress');

-- Parent link for declared subagents (isolation boundary: a subagent
-- belongs to a parent agent definition but inherits nothing else).
ALTER TABLE agent_definitions ADD COLUMN subagent_of TEXT REFERENCES agent_definitions(id) ON DELETE CASCADE;
ALTER TABLE agent_definitions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_definitions_subagent_of
ON agent_definitions(subagent_of)
WHERE subagent_of IS NOT NULL;
`,
  },
  55: {
    filename: '055_session_steps.sql',
    sql: `-- Per-run agent session step telemetry
-- Stores each turn in an agent chat run for auditing/debugging.

CREATE TABLE IF NOT EXISTS session_steps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  budget_status TEXT NOT NULL DEFAULT 'within',
  allowed_tool_call_names TEXT NOT NULL DEFAULT '[]',
  blocked_tool_call_names TEXT NOT NULL DEFAULT '[]',
  tool_results TEXT NOT NULL DEFAULT '[]',
  token_delta INTEGER NOT NULL DEFAULT 0,
  cost_delta REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_steps_conversation
  ON session_steps(tenant_id, conversation_id, turn);
`,
  },
  56: {
    filename: '056_agent_evaluations.sql',
    sql: `-- Lightweight built-in agent evaluation records
-- Stores evaluation outcomes produced by the agent runtime after chat runs.

CREATE TABLE IF NOT EXISTS agent_evaluations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  tool_success_rate REAL NOT NULL DEFAULT 0,
  budget_adherence REAL NOT NULL DEFAULT 0,
  turn_efficiency REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  breakdown TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_evaluations_instance
  ON agent_evaluations(tenant_id, agent_instance_id, created_at);
`,
  },
  57: {
    filename: '057_agent_plan_mode.sql',
    sql: `-- Opt-in plan-then-execute mode for agent definitions.
-- When enabled, before the first ReAct turn the runtime asks the model to emit
-- a structured plan (steps + tool intent) so weak models get an explicit roadmap.
-- Off by default -> existing agents keep the baseline ReAct behavior.

ALTER TABLE agent_definitions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
`,
  },
  58: {
    filename: '058_agent_compaction.sql',
    sql: `-- Opt-in conversation-history compaction for long agent runs.
-- When enabled, the runtime summarizes the early tool-activity turns into a
-- single rolling context block once the transcript passes the configured
-- threshold, preventing context-window blowup on weak local models.
-- Stored as a boolean flag (1/0); the compaction threshold itself lives in the
-- loop engine. Off by default -> existing agents keep unbounded history.

ALTER TABLE agent_definitions ADD COLUMN history_compaction INTEGER NOT NULL DEFAULT 0;
`,
  },
};
