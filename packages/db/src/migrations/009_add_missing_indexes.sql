-- Missing indexes for foreign key columns and frequently-queried lookups
-- These prevent full table scans during routing, auth, and quota checks

-- Providers: name is queried by adapter ID in auto-register, health checker, and admin routes
CREATE INDEX IF NOT EXISTS idx_providers_name ON providers(name);

-- Policies: tenant_id is used in policy filtering during every routing request
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id);

-- Quota allocations: tenant_id is used in quota filtering during every routing request
CREATE INDEX IF NOT EXISTS idx_quota_allocations_tenant ON quota_allocations(tenant_id);
