-- 086: Durable idempotency ledger for agent quota settlement.
-- A hold may be missing when its TTL cleanup ran before the successful response
-- was settled. The authenticated fallback context still records the measured
-- usage, and hold_id makes retries exact-once across gateway instances.
CREATE TABLE IF NOT EXISTS agent_quota_settlements (
  hold_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  actual_tokens INTEGER NOT NULL DEFAULT 0,
  actual_cost_dollars REAL NOT NULL DEFAULT 0,
  settled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_quota_settlements_tenant
ON agent_quota_settlements(tenant_id, settled_at);
