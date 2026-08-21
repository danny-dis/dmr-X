-- 081: Unpriced != free — make cost columns nullable
-- Context: model_profiles.{input,output}_cost_per_1k were REAL NOT NULL DEFAULT 0.
-- A model whose provider publishes no pricing was stored as 0, indistinguishable
-- from a genuinely free one. Most /v1/models endpoints publish nothing, so the
-- catalog marked thousands of paid models as free and the free-only aliases
-- elected them.
-- After this migration NULL means "unpriced / unknown" and 0 means "verified
-- free". The router's isFree() and the registry's verifyModelFree() treat NULL
-- as NOT free.
-- legacy_alter_table disables FK enforcement during the table rebuild so the
-- RENAME/CREATE/DROP dance doesn't trip "foreign key constraint failed" from
-- tables that reference model_profiles (e.g. playground_feedback).
PRAGMA legacy_alter_table=ON;
PRAGMA defer_foreign_keys=ON;
BEGIN TRANSACTION;

ALTER TABLE model_profiles RENAME TO model_profiles_backup;

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  modality TEXT NOT NULL,
  intelligence_layer TEXT NOT NULL DEFAULT 'executor',
  supports_streaming INTEGER NOT NULL DEFAULT 0,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_tool_use INTEGER NOT NULL DEFAULT 0,
  supports_json_mode INTEGER NOT NULL DEFAULT 0,
  supports_function_call INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  max_output_tokens INTEGER,
  max_resolution TEXT,
  supported_formats TEXT,
  supports_inpainting INTEGER NOT NULL DEFAULT 0,
  supports_img2img INTEGER NOT NULL DEFAULT 0,
  embedding_dimensions INTEGER,
  max_input_tokens INTEGER,
  input_cost_per_1k REAL DEFAULT NULL,
  output_cost_per_1k REAL DEFAULT NULL,
  cost_per_image REAL DEFAULT NULL,
  cost_per_1k_chars REAL DEFAULT NULL,
  quality_score REAL NOT NULL DEFAULT 0.5,
  avg_latency_ms INTEGER,
  rate_limit_rpm INTEGER,
  rate_limit_rpd INTEGER,
  rate_limit_tpm INTEGER,
  rate_limit_tpd INTEGER,
  monthly_token_budget INTEGER,
  intelligence_rank INTEGER,
  speed_rank INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  capability_tier TEXT NOT NULL DEFAULT 'executor',
  elo_rating REAL NOT NULL DEFAULT 1200,
  subscription_only INTEGER NOT NULL DEFAULT 0,
  task_categories TEXT DEFAULT '["general"]',
  context_tier TEXT DEFAULT 'medium',
  deployment TEXT DEFAULT 'cloud',
  reasoning_mode TEXT DEFAULT 'fixed',
  safety_tier TEXT DEFAULT 'standard',
  agentic_level TEXT DEFAULT 'chat',
  architecture TEXT,
  parameter_count INTEGER,
  active_parameters INTEGER,
  license TEXT,
  operator_disabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_id, model_id)
);

INSERT INTO model_profiles (
  id, provider_id, model_id, display_name, modality, intelligence_layer,
  supports_streaming, supports_vision, supports_tool_use, supports_json_mode,
  supports_function_call, supports_reasoning,
  context_window, max_output_tokens, max_resolution, supported_formats,
  supports_inpainting, supports_img2img,
  embedding_dimensions, max_input_tokens,
  input_cost_per_1k, output_cost_per_1k, cost_per_image, cost_per_1k_chars,
  quality_score, avg_latency_ms,
  rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
  monthly_token_budget, intelligence_rank, speed_rank,
  is_active, created_at, updated_at, capability_tier, elo_rating,
  subscription_only, task_categories, context_tier, deployment,
  reasoning_mode, safety_tier, agentic_level, architecture,
  parameter_count, active_parameters, license, operator_disabled
)
SELECT
  id, provider_id, model_id, display_name, modality, intelligence_layer,
  supports_streaming, supports_vision, supports_tool_use, supports_json_mode,
  supports_function_call, supports_reasoning,
  context_window, max_output_tokens, max_resolution, supported_formats,
  supports_inpainting, supports_img2img,
  embedding_dimensions, max_input_tokens,
  input_cost_per_1k, output_cost_per_1k, cost_per_image, cost_per_1k_chars,
  quality_score, avg_latency_ms,
  rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
  monthly_token_budget, intelligence_rank, speed_rank,
  is_active, created_at, updated_at, capability_tier, elo_rating,
  subscription_only, task_categories, context_tier, deployment,
  reasoning_mode, safety_tier, agentic_level, architecture,
  parameter_count, active_parameters, license, operator_disabled
FROM model_profiles_backup;

DROP TABLE model_profiles_backup;

-- Recreate indexes that were on model_profiles
CREATE INDEX IF NOT EXISTS idx_model_profiles_modality ON model_profiles(modality) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider ON model_profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider_model ON model_profiles(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_model_profiles_capability_tier ON model_profiles(capability_tier) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_model_profiles_subscription_only ON model_profiles(subscription_only) WHERE is_active = 1 AND subscription_only = 1;
CREATE INDEX IF NOT EXISTS idx_model_profiles_task_categories ON model_profiles(task_categories);
CREATE INDEX IF NOT EXISTS idx_model_profiles_context_tier ON model_profiles(context_tier);
CREATE INDEX IF NOT EXISTS idx_model_profiles_deployment ON model_profiles(deployment);
CREATE INDEX IF NOT EXISTS idx_model_profiles_reasoning_mode ON model_profiles(reasoning_mode);
CREATE INDEX IF NOT EXISTS idx_model_profiles_safety_tier ON model_profiles(safety_tier);
CREATE INDEX IF NOT EXISTS idx_model_profiles_agentic_level ON model_profiles(agentic_level);
CREATE INDEX IF NOT EXISTS idx_model_profiles_architecture ON model_profiles(architecture);

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA defer_foreign_keys=OFF;
