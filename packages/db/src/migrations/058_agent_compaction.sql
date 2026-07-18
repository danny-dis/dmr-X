-- Opt-in conversation-history compaction for long agent runs.
-- When enabled, the runtime summarizes the early tool-activity turns into a
-- single rolling context block once the transcript passes the configured
-- threshold, preventing context-window blowup on weak local models.
-- Stored as a boolean flag (1/0); the compaction threshold itself lives in the
-- loop engine. Off by default -> existing agents keep unbounded history.

ALTER TABLE agent_definitions ADD COLUMN history_compaction INTEGER NOT NULL DEFAULT 0;
