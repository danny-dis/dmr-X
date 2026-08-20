-- Per-agent conversation-history compaction thresholds.
--
-- a98920e made the compaction thresholds configurable per agent definition,
-- but the fields were never added to the schema/persistence layer — the loop
-- engine always fell back to its defaults and the gateway typecheck was
-- broken. These columns complete that intent:
--   AgentDefinition.compactionThreshold / compactionKeepRecent
-- NULL means "fall back to the loop-engine defaults" (24 / 8).

ALTER TABLE agent_definitions ADD COLUMN compaction_threshold INTEGER;
ALTER TABLE agent_definitions ADD COLUMN compaction_keep_recent INTEGER;