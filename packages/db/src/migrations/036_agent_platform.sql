-- Agent Platform
-- Agent definitions, instances, executions, and marketplace listings

-- Agent definitions: the blueprint for an agent
CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  system_prompt TEXT,
  personality TEXT,
  preferred_model TEXT,
  model_tier TEXT NOT NULL DEFAULT 'auto',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  custom_tools TEXT NOT NULL DEFAULT '[]',
  workflow TEXT,
  triggers TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private',
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  icon TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_tenant
ON agent_definitions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_visibility
ON agent_definitions(visibility)
WHERE visibility IN ('team', 'public');

CREATE INDEX IF NOT EXISTS idx_agent_definitions_category
ON agent_definitions(category)
WHERE category IS NOT NULL;

-- Agent instances: a deployed agent (definition + tenant-specific config)
CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  config_override TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_tenant
ON agent_instances(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_instances_definition
ON agent_instances(agent_definition_id);

CREATE INDEX IF NOT EXISTS idx_agent_instances_status
ON agent_instances(tenant_id, status)
WHERE status = 'active';

-- Agent execution logs
CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  input TEXT,
  output TEXT,
  tools_used TEXT NOT NULL DEFAULT '[]',
  model_used TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_instance
ON agent_executions(agent_instance_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_executions_tenant
ON agent_executions(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_executions_status
ON agent_executions(tenant_id, status);

-- Agent marketplace listings
CREATE TABLE IF NOT EXISTS agent_listings (
  id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  publisher_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  long_description TEXT,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  icon TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  rating REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  install_count INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_listings_status
ON agent_listings(status)
WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_agent_listings_category
ON agent_listings(category, status)
WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_agent_listings_publisher
ON agent_listings(publisher_tenant_id);

-- Agent marketplace installs (track which tenants installed which agents)
CREATE TABLE IF NOT EXISTS agent_installs (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES agent_listings(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_installs_tenant
ON agent_installs(tenant_id);

-- Agent marketplace ratings
CREATE TABLE IF NOT EXISTS agent_ratings (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES agent_listings(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_ratings_listing
ON agent_ratings(listing_id);
