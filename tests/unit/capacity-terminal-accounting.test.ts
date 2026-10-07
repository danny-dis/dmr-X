import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityReservation } from '../../services/quota/src/capacity-manager.js';

const { mkdtempSync } = await import('node:fs');
const { join } = await import('node:path');
const { tmpdir } = await import('node:os');

const directory = mkdtempSync(join(tmpdir(), 'dmrx-capacity-terminal-'));
const previous = process.env.DMRX_DATA_DIR;
let closeDb: typeof import('@dmr-x/db').closeDb;
let Store: typeof import('../../services/quota/src/capacity-store-distributed.js').SQLiteCapacityStore;
let dbModule: typeof import('@dmr-x/db');

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  dbModule = await import('@dmr-x/db');
  closeDb = dbModule.closeDb;
  await dbModule.initDb();
  dbModule.getDb().exec(`CREATE TABLE IF NOT EXISTS capacity_reservations (
    reservation_id TEXT NOT NULL, unit TEXT NOT NULL, scope_id TEXT NOT NULL,
    amount REAL NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, committed_at INTEGER,
    PRIMARY KEY(reservation_id,unit,scope_id))`);
  Store = (await import('../../services/quota/src/capacity-store-distributed.js')).SQLiteCapacityStore;
}, 90000);

afterAll(async () => {
  await closeDb?.();
  if (previous === undefined) delete process.env.DMRX_DATA_DIR; else process.env.DMRX_DATA_DIR = previous;
});

beforeEach(async () => {
  // Clean up capacity tables before each test
  const db = dbModule.getDb();
  db.exec('DELETE FROM capacity_reservations');
  db.exec('DELETE FROM capacity_pool_balances');
});

function makeDimension(scopeId: string, amount = 10, currentRemaining = 10) {
  return { unit: 'total_tokens' as const, scopeId, amount, currentRemaining };
}

function reservation(id: string, scopeId: string): CapacityReservation {
  return {
    id,
    candidateId: 'fixture',
    dimensions: [{ unit: 'total_tokens' as const, scopeId, reserved: 10 }],
    expiresAt: Date.now() + 30000,
    createdAt: Date.now(),
    status: 'reserved',
  };
}

function getRemaining(unit: string, scopeId: string): number | undefined {
  const db = dbModule.getDb();
  const row = db.prepare('SELECT remaining FROM capacity_pool_balances WHERE unit = ? AND scope_id = ?').get(unit, scopeId) as { remaining: number } | undefined;
  return row?.remaining;
}

describe('terminal commit/release idempotency and race safety', () => {
  it('commits the same reservation twice sequentially — debits only once', async () => {
    const scopeId = 'terminal-double-commit-pool';
    const dim = makeDimension(scopeId);
    const store = new Store();
    expect(await store.tryReserve([dim], 'terminal-double-commit', 30000)).not.toBeNull();

    const res = reservation('terminal-double-commit', scopeId);
    const actualUsage = { requests: 1, inputTokens: 2, outputTokens: 3, concurrency: 0 };

    // First commit
    await store.commit(res, actualUsage);

    // Second commit on same reservation — should be idempotent, not double-debit
    await store.commit(res, actualUsage);

    // Verify remaining capacity: started at 10, reserved 10, committed with actual=5 (2+3)
    // So remaining should be 10 - 5 = 5, NOT 10 - 5 - 5 = 0
    expect(getRemaining('total_tokens', scopeId)).toBe(5);
  });

  it('cannot debit a stale reservation snapshot after another committer won', async () => {
    const scopeId = 'terminal-stale-snapshot';
    const store = new Store();
    const db = dbModule.getDb();
    expect(await store.tryReserve([makeDimension(scopeId)], 'stale-snapshot', 30000)).not.toBeNull();
    const res = reservation('stale-snapshot', scopeId);
    const measured = { inputTokens: 2, outputTokens: 3, concurrency: 0 };
    let transactionDepth = 0;
    let raced = false;
    let secondCommit: Promise<void> | undefined;
    const originalTransaction = db.transaction.bind(db);
    const originalPrepare = db.prepare.bind(db);
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation((fn: any) => originalTransaction(() => {
      transactionDepth++;
      try { return fn(); } finally { transactionDepth--; }
    }));
    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes('SELECT unit, scope_id FROM capacity_reservations')) {
        const originalAll = statement.all.bind(statement);
        statement.all = ((...args: any[]) => {
          const rows = originalAll(...args);
          // Simulate a second process winning between the first SELECT and
          // BEGIN IMMEDIATE. Inside the write transaction that gap cannot exist.
          if (transactionDepth === 0 && !raced) {
            raced = true;
            secondCommit = new Store().commit(res, measured);
          }
          return rows;
        }) as typeof statement.all;
      }
      return statement;
    });
    try {
      await store.commit(res, measured);
      await secondCommit;
      expect(getRemaining('total_tokens', scopeId)).toBe(5);
    } finally {
      prepareSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('releases a reservation then commits it — release wins, no debit on commit', async () => {
    const scopeId = 'terminal-release-then-commit-pool';
    const dim = makeDimension(scopeId);
    const store = new Store();
    expect(await store.tryReserve([dim], 'terminal-release-then-commit', 30000)).not.toBeNull();

    const res = reservation('terminal-release-then-commit', scopeId);
    const actualUsage = { requests: 1, inputTokens: 2, outputTokens: 3, concurrency: 0 };

    // Release first
    await store.release(res);

    // Then commit — should not debit since already released
    await store.commit(res, actualUsage);

    // Remaining should be back to 10 (full release), not 5
    expect(getRemaining('total_tokens', scopeId)).toBe(10);
  });

  it('commits a reservation then releases it — commit wins, release is no-op', async () => {
    const scopeId = 'terminal-commit-then-release-pool';
    const dim = makeDimension(scopeId);
    const store = new Store();
    expect(await store.tryReserve([dim], 'terminal-commit-then-release', 30000)).not.toBeNull();

    const res = reservation('terminal-commit-then-release', scopeId);
    const actualUsage = { requests: 1, inputTokens: 2, outputTokens: 3, concurrency: 0 };

    // Commit first
    await store.commit(res, actualUsage);

    // Then release — should not refund since already committed
    await store.release(res);

    // Remaining should be 5 (10 - 5 actual), not 10
    expect(getRemaining('total_tokens', scopeId)).toBe(5);
  });

  it('expired reservation commit — debits actual usage', async () => {
    const scopeId = 'terminal-expired-commit-pool';
    const dim = makeDimension(scopeId);
    const store = new Store();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    try {
      expect(await store.tryReserve([dim], 'terminal-expired-commit', 10)).not.toBeNull();

      // Advance time past expiry
      clock.mockReturnValue(now + 20);

      const res = reservation('terminal-expired-commit', scopeId);
      // Manually expire it
      await store.expireLeases(now + 20);

      // Commit expired reservation
      await store.commit(res, { requests: 1, inputTokens: 2, outputTokens: 3, concurrency: 0 });

      // Should debit actual usage (5 tokens)
      expect(getRemaining('total_tokens', scopeId)).toBe(5);
    } finally {
      clock.mockRestore();
    }
  });

  it('handles malformed demand — fails closed, releases concurrency, retains consumptive usage', async () => {
    const scopeId = 'malformed-demand-pool';
    const concurrencyDim = { unit: 'concurrency' as const, scopeId, amount: 1, currentRemaining: 3 };
    const tokenDim = { unit: 'total_tokens' as const, scopeId, amount: 100, currentRemaining: 50 };

    const store = new Store();
    const db = dbModule.getDb();
    // Pre-create pools with initial values
    db.prepare('INSERT INTO capacity_pool_balances (unit, scope_id, remaining, observed_at) VALUES (?, ?, ?, 0)').run('concurrency', scopeId, 3);
    db.prepare('INSERT INTO capacity_pool_balances (unit, scope_id, remaining, observed_at) VALUES (?, ?, ?, 0)').run('total_tokens', scopeId, 50);

    // Reserve with valid concurrency but excessive tokens (should fail)
    const reserved = await store.tryReserve([concurrencyDim, tokenDim], 'malformed-demand', 30000);
    expect(reserved).toBeNull(); // Should fail closed

    // Verify concurrency was not consumed (no reservation made)
    expect(getRemaining('concurrency', scopeId)).toBe(3);
    expect(getRemaining('total_tokens', scopeId)).toBe(50);
  });
});