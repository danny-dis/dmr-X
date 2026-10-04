-- 087: Durable claims for request-id keyed credit debits.
-- Keep historical credit_transactions untouched; this table is the idempotency
-- boundary for new request-keyed usage charges.
CREATE TABLE IF NOT EXISTS credit_usage_claims (
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  credit_transaction_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_usage_claims_transaction
ON credit_usage_claims(credit_transaction_id);
