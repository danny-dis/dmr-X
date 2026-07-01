-- Credit/Balance system for prepaid spending limits
-- Enables top-ups, balance tracking, and hard spending limits

CREATE TABLE IF NOT EXISTS credits (
  tenant_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_topup_cents INTEGER NOT NULL DEFAULT 0,
  total_used_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'topup', 'usage', 'refund', 'adjustment'
  amount_cents INTEGER NOT NULL, -- positive for topup/refund, negative for usage
  balance_after_cents INTEGER NOT NULL,
  description TEXT,
  request_id TEXT,               -- links to usage_records for usage transactions
  admin_key_hash TEXT,           -- who performed the action
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant
ON credit_transactions(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_tx_type
ON credit_transactions(tenant_id, type, created_at DESC);
