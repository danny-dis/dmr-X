-- Preserve an operator's decision to disable a model.
--
-- `is_active` was doing two jobs at once: "discovery last saw this model
-- upstream" and "the operator wants this model routable". Two code paths in
-- auto-register.ts blindly set `is_active = 1` — the per-model refresh during
-- live discovery, and the bulk re-activation that runs when a provider's key
-- becomes available. Both meant an admin disabling a model saw it silently
-- come back on the next gateway restart.
--
-- That is not hypothetical. Google's /v1/models lists 57 entries including
-- several that cannot be called at all (`aqa`, the `deep-research-*` family,
-- `antigravity-preview-*`): they are listed, so discovery re-enables them,
-- so the router keeps selecting models that fail 100% of the time.
--
-- Splitting the two meanings fixes it: discovery continues to own `is_active`,
-- while `operator_disabled` records human intent and always wins.
ALTER TABLE model_profiles ADD COLUMN operator_disabled INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_model_profiles_operator_disabled
  ON model_profiles(provider_id, operator_disabled);
