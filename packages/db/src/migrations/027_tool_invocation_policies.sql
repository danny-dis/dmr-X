-- Tool invocation policies for controlling which tools can be called
-- Supports per-tenant, per-tool policies with approval workflows

CREATE TABLE IF NOT EXISTS tool_invocation_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  -- Policy action: 'allow', 'deny', 'require_approval'
  action TEXT NOT NULL DEFAULT 'allow',
  -- Optional conditions (JSON): tool input patterns, user roles, etc.
  conditions TEXT,
  -- Priority for rule ordering (higher = evaluated first)
  priority INTEGER NOT NULL DEFAULT 0,
  -- Description for audit logging
  description TEXT,
  -- Who created this policy
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one policy per tool per tenant
  UNIQUE(tenant_id, tool_name)
);

-- Index for querying by tenant (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_tool_invocation_policies_tenant
ON tool_invocation_policies(tenant_id, is_active);

-- Index for querying by tool name
CREATE INDEX IF NOT EXISTS idx_tool_invocation_policies_tool
ON tool_invocation_policies(tool_name, is_active);

-- Global policies (tenant_id = '*' applies to all tenants)
-- These are evaluated after tenant-specific policies

-- Policy evaluation cache for performance
CREATE TABLE IF NOT EXISTS tool_policy_evaluation_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT NOT NULL,
  -- Cached evaluation result: 'allow', 'deny', 'require_approval'
  result TEXT NOT NULL,
  -- Cache expiry (ISO timestamp)
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_tool_policy_cache_lookup
ON tool_policy_evaluation_cache(tenant_id, tool_name, tool_input_hash, expires_at);

-- Policy audit log for tracking all policy evaluations
CREATE TABLE IF NOT EXISTS tool_policy_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT,
  -- Evaluation result
  result TEXT NOT NULL,
  -- Policy ID that matched (if any)
  policy_id TEXT,
  -- Reason for denial/approval requirement
  reason TEXT,
  -- Request context
  request_id TEXT,
  user_id TEXT,
  ip_address TEXT
);

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_timestamp
ON tool_policy_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_tenant
ON tool_policy_audit_log(tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_tool_policy_audit_tool
ON tool_policy_audit_log(tool_name, timestamp DESC);
