-- DMR-X Free-Tier Schema Extension
-- Adds rate-limit tracking and free-tier metadata to model_profiles

-- Rate limit columns for per-model tracking
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS rate_limit_rpm INTEGER;
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS rate_limit_rpd INTEGER;
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS rate_limit_tpm INTEGER;
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS rate_limit_tpd INTEGER;

-- Free-tier metadata
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS monthly_token_budget BIGINT;
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS intelligence_rank SMALLINT;
ALTER TABLE model_profiles ADD COLUMN IF NOT EXISTS speed_rank SMALLINT;

-- Index for rate limit lookups (used by RateLimitService)
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider_model
  ON model_profiles(provider_id, model_id)
  WHERE is_active = true;
