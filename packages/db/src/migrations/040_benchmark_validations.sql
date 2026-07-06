-- Benchmark Human Validation
-- Tracks human spot-checks of AI judge decisions to measure judge accuracy.

CREATE TABLE IF NOT EXISTS benchmark_validations (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  judge_winner TEXT NOT NULL,           -- What the AI judge decided ('A', 'B', 'Tie')
  human_winner TEXT NOT NULL,           -- What the human decided ('A', 'B', 'Tie')
  agreed INTEGER NOT NULL,              -- 1 if same, 0 if different
  reviewer_id TEXT,                     -- Optional reviewer identifier
  notes TEXT,                           -- Optional human notes
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_validations_battle ON benchmark_validations(battle_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_validations_agreed ON benchmark_validations(agreed);
