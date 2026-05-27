-- DMR-X Initial Schema
-- Run with: psql $DATABASE_URL -f 001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Modality enum
CREATE TYPE modality_type AS ENUM (
  'llm', 'diffusion', 'embedding', 'audio_speech', 'audio_transcription', 'video', 'music'
);

-- Intelligence layer enum
CREATE TYPE intelligence_layer_type AS ENUM (
  'brain', 'thinker', 'executor', 'worker', 'temp_worker'
);

-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = true;

-- Providers
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  adapter_type VARCHAR(100) NOT NULL,
  base_url VARCHAR(512),
  api_key_ref VARCHAR(255),
  is_healthy BOOLEAN NOT NULL DEFAULT true,
  last_health_check TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Model Profiles
CREATE TABLE model_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  modality modality_type NOT NULL,
  intelligence_layer intelligence_layer_type NOT NULL DEFAULT 'executor',

  -- Capability flags
  supports_streaming BOOLEAN NOT NULL DEFAULT false,
  supports_vision BOOLEAN NOT NULL DEFAULT false,
  supports_tool_use BOOLEAN NOT NULL DEFAULT false,
  supports_json_mode BOOLEAN NOT NULL DEFAULT false,
  supports_function_call BOOLEAN NOT NULL DEFAULT false,

  -- LLM-specific
  context_window INTEGER,
  max_output_tokens INTEGER,

  -- Diffusion-specific
  max_resolution VARCHAR(20),
  supported_formats TEXT[],
  supports_inpainting BOOLEAN NOT NULL DEFAULT false,
  supports_img2img BOOLEAN NOT NULL DEFAULT false,

  -- Embedding-specific
  embedding_dimensions INTEGER,
  max_input_tokens INTEGER,

  -- Pricing
  input_cost_per_1k DECIMAL(10, 6) NOT NULL DEFAULT 0,
  output_cost_per_1k DECIMAL(10, 6) NOT NULL DEFAULT 0,
  cost_per_image DECIMAL(10, 6) NOT NULL DEFAULT 0,
  cost_per_1k_chars DECIMAL(10, 6) NOT NULL DEFAULT 0,

  -- Quality
  quality_score DECIMAL(5, 4) NOT NULL DEFAULT 0.5,
  avg_latency_ms INTEGER,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(provider_id, model_id)
);

CREATE INDEX idx_model_profiles_modality ON model_profiles(modality) WHERE is_active = true;
CREATE INDEX idx_model_profiles_provider ON model_profiles(provider_id);

-- Policies
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quota Allocations
CREATE TABLE quota_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id),
  max_requests INTEGER,
  max_tokens INTEGER,
  max_cost DECIMAL(10, 2),
  period VARCHAR(20) NOT NULL DEFAULT 'monthly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Request Logs (partitioned by month)
CREATE TABLE request_logs (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL,
  tenant_id UUID,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Routing decision
  task_profile JSONB,
  routing_plan JSONB,
  selected_provider UUID,
  selected_model VARCHAR(255),
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  fallback_reason VARCHAR(255),

  -- Performance
  latency_ms INTEGER,
  time_to_first_token_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,

  -- Cost
  estimated_cost DECIMAL(10, 6),

  -- Quality
  quality_score DECIMAL(5, 4),
  quality_signals JSONB,

  -- Error
  error_code VARCHAR(100),
  error_message TEXT,

  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create partitions for current and next month
CREATE TABLE request_logs_2026_05 PARTITION OF request_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE request_logs_2026_06 PARTITION OF request_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_request_logs_tenant ON request_logs(tenant_id, timestamp);
CREATE INDEX idx_request_logs_provider ON request_logs(selected_provider, timestamp);

-- Benchmark Results
CREATE TABLE benchmark_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id UUID NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
  benchmark_type VARCHAR(100) NOT NULL,
  score DECIMAL(5, 4) NOT NULL,
  details JSONB,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_benchmark_results_model ON benchmark_results(model_id, run_at DESC);

-- Health Checks
CREATE TABLE health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  is_healthy BOOLEAN NOT NULL,
  latency_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_checks_provider ON health_checks(provider_id, checked_at DESC);

-- Billing Records
CREATE TABLE billing_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  request_id UUID,
  amount DECIMAL(10, 6) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_records_tenant ON billing_records(tenant_id, created_at DESC);
