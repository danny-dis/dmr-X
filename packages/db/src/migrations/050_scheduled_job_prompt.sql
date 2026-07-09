-- Scheduled job prompt + max steps
-- Lets each scheduled job carry its own prompt and step limit instead of a
-- hard-coded default.

ALTER TABLE agent_scheduled_jobs ADD COLUMN prompt TEXT;
ALTER TABLE agent_scheduled_jobs ADD COLUMN max_steps INTEGER NOT NULL DEFAULT 5;
