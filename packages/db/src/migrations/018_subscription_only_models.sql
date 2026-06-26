-- Add subscription_only column to model_profiles
-- This flag indicates a model is only available via OAuth subscription auth (not API key)
-- Used for Codex (ChatGPT subscription), Claude (Anthropic subscription), and GitHub Copilot models

ALTER TABLE model_profiles ADD COLUMN subscription_only INTEGER NOT NULL DEFAULT 0;

-- Index for filtering subscription-only models
CREATE INDEX IF NOT EXISTS idx_model_profiles_subscription_only
ON model_profiles(subscription_only)
WHERE is_active = 1 AND subscription_only = 1;
