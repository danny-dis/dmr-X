-- Phase 1: Add Elo Rating to Model Profiles
ALTER TABLE model_profiles ADD COLUMN elo_rating REAL NOT NULL DEFAULT 1200;

-- Phase 5: Playground Feedback table
CREATE TABLE IF NOT EXISTS playground_feedback (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
  user_id TEXT, -- Optional, for tracking specific users
  
  -- Explicit feedback
  rating INTEGER, -- 1 for thumbs up, -1 for thumbs down
  feedback_text TEXT,
  
  -- Implicit feedback (JSON flags)
  implicit_signals TEXT DEFAULT '{}', -- e.g. {"copied": true, "regenerated": true}
  
  -- Battle outcome (if comparison was used)
  is_winner INTEGER, -- 1 if this model won the comparison
  competitor_model_id TEXT REFERENCES model_profiles(id),
  
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_playground_feedback_model ON playground_feedback(model_id);
CREATE INDEX IF NOT EXISTS idx_playground_feedback_request ON playground_feedback(request_id);
