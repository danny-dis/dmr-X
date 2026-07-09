-- Verify-on-stop safety flag for agent definitions
-- When enabled, the runtime nudges the agent to self-check its final answer.

ALTER TABLE agent_definitions ADD COLUMN verify_on_stop INTEGER NOT NULL DEFAULT 0;
