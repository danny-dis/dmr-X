-- Store an optional human-friendly display name for an agent definition.
-- "humanName" lets a built agent be addressed by a friendly name rather
-- than only its machine `name` (slug).
-- personality column was added in 036_agent_platform.sql; this migration
-- only introduces the optional human_name column.

ALTER TABLE agent_definitions ADD COLUMN human_name TEXT;
