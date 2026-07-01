-- Tool Templates: Pre-configured tool call patterns
-- Users can save and reuse common tool call sequences

CREATE TABLE IF NOT EXISTS tool_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- JSON array of template steps
  steps TEXT NOT NULL,
  -- Tags for discovery
  tags TEXT,
  -- Version (semantic versioning)
  version TEXT NOT NULL DEFAULT '1.0.0',
  -- Who created this
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one template name per tenant
  UNIQUE(tenant_id, name)
);

-- Index for querying by tenant
CREATE INDEX IF NOT EXISTS idx_tool_templates_tenant
ON tool_templates(tenant_id, is_active);

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_tool_templates_name
ON tool_templates(name, is_active);

-- Tool Presets: Default parameters per tenant/tool
CREATE TABLE IF NOT EXISTS tool_presets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  -- Default parameter values (JSON)
  defaults TEXT NOT NULL,
  -- Forced parameter values that cannot be overridden (JSON)
  overrides TEXT,
  -- Priority for rule ordering (higher = evaluated first)
  priority INTEGER NOT NULL DEFAULT 0,
  -- Description for audit
  description TEXT,
  -- Who created this
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Soft delete
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Unique constraint: one preset per tool per tenant
  UNIQUE(tenant_id, tool_name)
);

-- Index for querying presets by tenant
CREATE INDEX IF NOT EXISTS idx_tool_presets_tenant
ON tool_presets(tenant_id, is_active);

-- Index for querying presets by tool
CREATE INDEX IF NOT EXISTS idx_tool_presets_tool
ON tool_presets(tool_name, is_active);

-- Template execution log for tracking usage
CREATE TABLE IF NOT EXISTS tool_template_executions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  template_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  -- Execution details
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER NOT NULL DEFAULT 0,
  -- Results
  output TEXT,
  error TEXT,
  -- Metrics
  duration_ms INTEGER,
  cost_usd REAL,
  -- Request context
  request_id TEXT,
  user_id TEXT,
  FOREIGN KEY (template_id) REFERENCES tool_templates(id)
);

-- Index for querying executions by template
CREATE INDEX IF NOT EXISTS idx_template_executions_template
ON tool_template_executions(template_id, timestamp DESC);

-- Index for querying executions by tenant
CREATE INDEX IF NOT EXISTS idx_template_executions_tenant
ON tool_template_executions(tenant_id, timestamp DESC);
