-- Agent definition godmode wrap opt-in flag (Phase 2c).
-- When set (1), the agent's per-turn model calls in the gateway's
-- runAgentChatLoop are routed through the godmode wrap using a router-resolved
-- concrete model (any family) instead of normal router routing.
-- Defaults to 0 (off) so existing agents keep their current routing behavior.

ALTER TABLE agent_definitions ADD COLUMN godmode_wrap INTEGER NOT NULL DEFAULT 0;
