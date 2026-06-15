-- Persist SSE event traces (agentic, tool-loop, etc.) on each message.
-- JSON-encoded array of { name, data } events. NULL means no events
-- were captured (regular chat messages).
ALTER TABLE messages ADD COLUMN events TEXT;
