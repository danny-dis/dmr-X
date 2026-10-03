-- 082: Hosted agent instances
-- Give deployed agent instances a durable runtime identity independent of any
-- one HTTP request. This is the DMR-X equivalent of the durable agent/session
-- model: the instance survives gateway restarts, while compute wakes only when
-- a message/event/schedule arrives.
--
-- runtime_mode:
--   persistent = long-lived identity (default)
--   ephemeral  = bounded worker / subagent
--
-- access_scope:
--   shared = eligible for intent discovery/dispatch
--   private = addressable by exact instance id only
--
-- lifecycle_state is the durable lifecycle, while the legacy status column
-- remains the coarse active/paused compatibility surface.

ALTER TABLE agent_instances
  ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'persistent';

ALTER TABLE agent_instances
  ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'shared';

ALTER TABLE agent_instances
  ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE agent_instances
  ADD COLUMN lifecycle_policy TEXT NOT NULL DEFAULT '{}';

ALTER TABLE agent_instances
  ADD COLUMN last_activity_at TEXT;

ALTER TABLE agent_instances
  ADD COLUMN last_heartbeat_at TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_instances_runtime
ON agent_instances(tenant_id, runtime_mode, lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_agent_instances_access_scope
ON agent_instances(tenant_id, access_scope, status)
WHERE status = 'active';

-- Scheduled jobs optionally pin to one persistent instance. This prevents a
-- fresh instance from being created on every cron fire and gives the schedule
-- a stable agent identity.
ALTER TABLE agent_scheduled_jobs
  ADD COLUMN agent_instance_id TEXT REFERENCES agent_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_instance
ON agent_scheduled_jobs(agent_instance_id);
