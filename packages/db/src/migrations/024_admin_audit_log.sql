-- Admin audit log for SOC2/ISO27001 compliance
-- Records all administrative actions for security auditing

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  admin_key_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT
);

-- Index for querying by timestamp (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp
ON admin_audit_log(timestamp DESC);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
ON admin_audit_log(action, timestamp DESC);

-- Index for querying by resource
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource
ON admin_audit_log(resource_type, resource_id);
