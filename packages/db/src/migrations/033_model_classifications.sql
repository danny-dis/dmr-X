-- Unified Model Classification
-- Tracks pricing tier, free/paid status, and verification state for all models

CREATE TABLE IF NOT EXISTS model_classifications (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  pricingTier TEXT NOT NULL DEFAULT 'unknown',  -- 'free' | 'free_with_limits' | 'paid' | 'subscription_only' | 'unknown'
  input_cost_per_1m REAL NOT NULL DEFAULT 0,
  output_cost_per_1m REAL NOT NULL DEFAULT 0,
  has_free_tier INTEGER NOT NULL DEFAULT 0,
  rate_limit_rpm INTEGER,
  rate_limit_rpd INTEGER,
  rate_limit_tpm INTEGER,
  rate_limit_tpd INTEGER,
  monthly_budget INTEGER NOT NULL DEFAULT 0,
  verified_free INTEGER NOT NULL DEFAULT 0,     -- 1 = runtime-verified free
  last_verification TEXT,                        -- ISO timestamp of last probe
  source TEXT NOT NULL DEFAULT 'catalog',        -- 'catalog' | 'runtime' | 'verified'
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_class_pricing
ON model_classifications(pricingTier);

CREATE INDEX IF NOT EXISTS idx_model_class_free
ON model_classifications(verified_free, pricingTier)
WHERE pricingTier IN ('free', 'free_with_limits');

CREATE INDEX IF NOT EXISTS idx_model_class_cost
ON model_classifications(input_cost_per_1m, output_cost_per_1m);
