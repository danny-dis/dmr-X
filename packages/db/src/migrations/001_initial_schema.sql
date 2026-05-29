-- DMR-X Initial Schema (SQLite)

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
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
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
