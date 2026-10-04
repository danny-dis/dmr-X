-- 085: Durable tenant-budget holds for agent admission (SEC-002)
-- `checkQuota` is read-only: concurrent agent runs each pass preflight before
-- any usage is recorded and overshoot the company quota. These holds are the
-- atomic reserve-before-run side of admission (see QuotaService.reserveAgentRun
-- / releaseAgentHold / settleAgentHold):
-- - reserve inserts a hold row inside ONE synchronous transaction that also
--   sums outstanding holds, so N gateways cannot oversubscribe;
-- - the hold itself records NO usage; settle records measured actuals once,
--   release records nothing (no double accounting);
-- - holds are tenant-bound (tenant_id) with a bounded expiry (expires_at);
--   crashed gateways stop pinning quota as soon as their holds expire, and
--   reserve purges expired rows on every attempt.
CREATE TABLE IF NOT EXISTS agent_quota_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider_key TEXT NOT NULL DEFAULT 'agent',
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_quota_holds_tenant
ON agent_quota_holds(tenant_id, expires_at);
