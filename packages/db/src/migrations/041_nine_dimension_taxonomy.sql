-- Add 9-dimension taxonomy columns to model_profiles
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
