-- Opt-in plan-then-execute mode for agent definitions.
-- When enabled, before the first ReAct turn the runtime asks the model to emit
-- a structured plan (steps + tool intent) so weak models get an explicit roadmap.
-- Off by default -> existing agents keep the baseline ReAct behavior.

ALTER TABLE agent_definitions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
