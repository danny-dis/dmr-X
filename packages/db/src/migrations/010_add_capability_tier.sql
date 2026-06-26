-- Add capability_tier column to model_profiles
-- This separates source classification (intelligence_layer) from actual capability (capability_tier)
ALTER TABLE model_profiles ADD COLUMN capability_tier TEXT NOT NULL DEFAULT 'executor';

-- Index for routing queries that filter by capability tier
CREATE INDEX IF NOT EXISTS idx_model_profiles_capability_tier
ON model_profiles(capability_tier)
WHERE is_active = 1;
