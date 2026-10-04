import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let quota: import('../../services/quota/src/quota.service.js').QuotaService;
let db: ReturnType<typeof import('@dmr-x/db').getDb>;
let cache: ReturnType<typeof import('@dmr-x/db').createNamespacedCache>;
let closeDb: typeof import('@dmr-x/db').closeDb;
let catalog: typeof import('@dmr-x/provider-catalog').PROVIDER_CATALOG;
const directory = mkdtempSync(join(tmpdir(), 'dmrx-agent-ledger-'));
const previous = process.env.DMRX_DATA_DIR;
const tenant = 'ledger-review-tenant';
beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  mkdirSync(directory, { recursive: true });
  const database = await import('@dmr-x/db');
  closeDb = database.closeDb;
  await database.initDb(); db = database.getDb();
  cache = database.createNamespacedCache('quota');
  db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run(tenant, 'Ledger review');
  db.prepare('INSERT INTO api_keys (id,tenant_id,key_hash) VALUES (?,?,?)').run(`${tenant}-key`, tenant, 'fixture-ledger-key-hash');
  catalog = (await import('@dmr-x/provider-catalog')).PROVIDER_CATALOG;
  quota = new (await import('../../services/quota/src/quota.service.js')).QuotaService();
});
afterAll(async () => { await closeDb(); if (previous === undefined) delete process.env.DMRX_DATA_DIR; else process.env.DMRX_DATA_DIR = previous; });

describe('durable agent usage and hold settlement', () => {
  it('fails closed rather than returning a phantom hold when the transaction fails', async () => {
    const transaction = vi.spyOn(Object.getPrototypeOf(db), 'transaction').mockImplementationOnce(() => { throw new Error('fixture storage failure'); });
    try { expect((await quota.reserveAgentRun(tenant, 'free-provider', 0, 0)).ok).toBe(false); }
    finally { transaction.mockRestore(); }
  });
  it('retains consumed global usage even after the per-process cache is cleared', async () => {
    await quota.createAllocation(tenant, null, null, 10_000, null, 'monthly');
    await quota.recordUsage(tenant, 'global-test-provider', 5_000, 0);
    cache.del(`${tenant}:global-test-provider`); cache.del(`${tenant}:global`);
    expect((await quota.reserveAgentRun(tenant, 'global-test-provider', 6_000, 0)).ok).toBe(false);
  });
  it('settles a purged expired hold using authenticated fallback context exactly once', async () => {
    const hold = await quota.reserveAgentRun(tenant, 'settle-provider', 1, 0);
    expect(hold.ok).toBe(true);
    db.prepare('DELETE FROM agent_quota_holds WHERE id = ?').run(hold.holdId);
    const context = { tenantId: tenant, providerKey: 'settle-provider' };
    // Old implementation ignores the authenticated context and loses actuals.
    await (quota.settleAgentHold as (id: string, actual: { tokens: number; costDollars: number }, context: typeof context) => Promise<void>)(hold.holdId!, { tokens: 99, costDollars: 0 }, context);
    await (quota.settleAgentHold as (id: string, actual: { tokens: number; costDollars: number }, context: typeof context) => Promise<void>)(hold.holdId!, { tokens: 99, costDollars: 0 }, context);
    const rows = db.prepare("SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ? AND description = 'Usage: 99 tokens via settle-provider'").get(tenant) as { count: number };
    expect(rows.count).toBe(1);
  });
  it('reflects agent usage in the monthly provider budget without a separate in-memory update', async () => {
    await quota.recordUsage(tenant, 'monthly-ledger-provider', 75, 0);
    expect(await quota.getProviderBudgetUsage(tenant, 'monthly-ledger-provider')).toBe(75);
  });
  it('rejects a pinned free model after its monthly token budget is exhausted', async () => {
    const provider = catalog.find(p => p.models.some(m => (m.freeTier?.monthlyTokenBudget ?? 0) > 0))!;
    const model = provider.models.find(m => (m.freeTier?.monthlyTokenBudget ?? 0) > 0)!;
    const budgetTenant = 'budget-review-tenant';
    db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run(budgetTenant, 'Budget review');
    db.prepare('INSERT INTO api_keys (id,tenant_id,key_hash) VALUES (?,?,?)').run(`${budgetTenant}-key`, budgetTenant, 'fixture-budget-key-hash');
    await quota.recordUsage(budgetTenant, provider.id, model.freeTier!.monthlyTokenBudget!, 0);
    expect((await quota.reserveAgentRun(budgetTenant, provider.id, 1, 0, { modelId: model.id })).ok).toBe(false);
  });
});
