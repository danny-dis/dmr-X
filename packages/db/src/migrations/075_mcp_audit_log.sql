-- MCP Server audit log for tool invocations, policy decisions, and auth events.
-- Persists the AuditTrailEngine output so events survive process restarts
-- (compliance requirement for SOC 2 / GDPR).
--
-- This table is written by the MCP server's own DMRX_DATA_DIR database,
-- separate from the gateway's encrypted data.db — the MCP server has its
-- own isolated DB file to avoid contention with the gateway.

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'service',
  actor_id TEXT NOT NULL DEFAULT 'anonymous',
  actor_ip TEXT,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  request TEXT,
  response TEXT,
  previous_hash TEXT,
  hash TEXT NOT NULL
);

-- Most common query: time-ordered recent events
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_timestamp
  ON mcp_audit_log(timestamp DESC);

-- Filter by event type (e.g., all policy.deny events)
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_type
  ON mcp_audit_log(event_type, timestamp DESC);

-- Filter by actor (e.g., all events for a specific user)
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_actor
  ON mcp_audit_log(actor_id, timestamp DESC);

-- Filter by target tool
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_target
  ON mcp_audit_log(target_type, target_id, timestamp DESC);
