-- Store the optional opt-in interval (in turns) at which an agent is
-- nudged to capture or refine a reusable skill. 0 disables the nudge.
-- Default 8 turns. Used only at prompt-construction time (instructional).

ALTER TABLE agent_definitions ADD COLUMN skill_nudge_interval INTEGER NOT NULL DEFAULT 8;
