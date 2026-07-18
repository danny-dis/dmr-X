-- Fix session_steps audit table: the agent execution recorder
-- (agent-session.store.ts) inserts into `allowed_tool_calls` and
-- `blocked_tool_calls`, but migration 055 omitted these columns, so every
-- agent run 500s on the first telemetry write. Add them now.
-- Idempotent: guarded by IF NOT EXISTS semantics via PRAGMA column checks
-- performed by the runner, but ALTER TABLE ADD COLUMN is itself safe to
-- re-run only if the column is missing — wrap defensively.

-- SQLite has no "ADD COLUMN IF NOT EXISTS", so the runner's tableHasColumn
-- guard is what makes this idempotent. The columns below mirror the
-- SessionStep interface (allowedToolCallNames / blockedToolCallNames).
ALTER TABLE session_steps ADD COLUMN allowed_tool_calls TEXT NOT NULL DEFAULT '[]';
ALTER TABLE session_steps ADD COLUMN blocked_tool_calls TEXT NOT NULL DEFAULT '[]';
