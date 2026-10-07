-- Durable shared admission and manual quota-reset boundaries.
CREATE TABLE IF NOT EXISTS capacity_reservations (
  reservation_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  amount REAL NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  PRIMARY KEY (reservation_id, unit, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_capacity_reservations_active
  ON capacity_reservations(unit, scope_id, status, expires_at);
CREATE TABLE IF NOT EXISTS capacity_pool_balances (
  unit TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  remaining REAL NOT NULL,
  observed_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (unit, scope_id)
);
CREATE TABLE IF NOT EXISTS quota_allocation_resets (
  allocation_id TEXT PRIMARY KEY REFERENCES quota_allocations(id) ON DELETE CASCADE,
  reset_at TEXT NOT NULL,
  after_rowid INTEGER NOT NULL
);
