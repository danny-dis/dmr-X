-- Judge Reliability Tracking
-- Tracks inter-rater agreement between multiple AI judges evaluating the same battle.

CREATE TABLE IF NOT EXISTS judge_reliability (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  judge_model_a TEXT NOT NULL,          -- e.g. 'gpt-4o'
  judge_model_b TEXT NOT NULL,          -- e.g. 'claude-sonnet-4'
  kappa REAL,                           -- Cohen's kappa coefficient (-1 to 1)
  agreement_percent REAL,               -- Simple percent agreement (0-100)
  total_comparisons INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_judge_reliability_battle ON judge_reliability(battle_id);
CREATE INDEX IF NOT EXISTS idx_judge_reliability_judges ON judge_reliability(judge_model_a, judge_model_b);
