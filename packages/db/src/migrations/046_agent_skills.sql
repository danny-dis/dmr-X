-- Persist the list of skill ids an agent possesses on the agent definition.
-- Stored as a JSON array (TEXT) to keep the schema simple and avoid a
-- separate join table / migration of the row shape.

ALTER TABLE agent_definitions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
