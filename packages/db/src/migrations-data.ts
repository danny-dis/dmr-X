// Auto-generated from packages/db/src/migrations/*.sql
// Used when running as a compiled binary (bun build --compile) where
// the .sql files are not available on the filesystem.

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
END;
`,
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
-- The providers table used to carry a single API key in config.apiKey
-- (encrypted) and a single api_key_ref (an env-var name). That made it
-- impossible to attach a second key to the same provider, so operators
-- who wanted to mix free and paid keys for the same upstream (e.g.
-- Google's free tier + a paid Workspace key) had to create a second
-- provider row -- but name is UNIQUE, so the activate flow silently
-- clobbered the first one.
--
-- This migration adds:
--   * providers.tier       -- denormalised cache; recomputed by the admin
--                             routes on every key mutation.
--   * provider_keys        -- one row per credential. The highest-priority
--                             active row is the one the adapter uses; the
--                             rest are available for future round-robin
--                             / per-model overrides.
--
-- The backfill at the bottom preserves existing credentials (the
-- ciphertext is moved unchanged -- no re-encrypt pass needed) and uses a
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
-- 'free'. Otherwise 'paid'.
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
-- existing rows -- pre-migration messages retain NULL tenant_id and are
-- treated as "unowned" by the new tenant-scoped queries (a NULL
-- tenant_id = ? comparison never matches, so they're invisible to
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
-- a migration file after it was applied -- the schema is no longer
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
};

