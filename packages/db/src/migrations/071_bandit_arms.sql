-- Thompson bandit arm state, persisted so routing doesn't forget everything
-- it has learned on every gateway restart.
--
-- ThompsonSampler (services/router/src/bandit/thompson-sampler.ts) previously
-- kept alpha/beta/pulls/totalReward only in an in-memory Map, keyed by
-- `${providerId}:${modelId}` (see getArmKey()). That state is the posterior
-- over which provider/model actually performs well; losing it on every
-- restart reverts routing to argmax-over-static-score until the bandit
-- re-learns from scratch.
--
-- One row per arm. `key` is the same `providerId:modelId` string the
-- in-memory Map already uses, so restore is a straight key lookup.
CREATE TABLE IF NOT EXISTS bandit_arms (
  key TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1,
  beta REAL NOT NULL DEFAULT 1,
  pulls INTEGER NOT NULL DEFAULT 0,
  total_reward REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bandit_arms_provider
ON bandit_arms(provider_id);
