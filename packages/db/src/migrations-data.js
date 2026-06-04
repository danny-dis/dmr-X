// Auto-generated from packages/db/src/migrations/*.sql
// Used when running as a compiled binary (bun build --compile) where
// the .sql files are not available on the filesystem.
export const MIGRATIONS = {
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
};
//# sourceMappingURL=migrations-data.js.map