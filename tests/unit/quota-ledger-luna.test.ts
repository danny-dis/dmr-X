import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let quota: import('../../services/quota/src/quota.service.js').QuotaService;
let db: ReturnType<typeof import('@dmr-x/db').getDb>;
let closeDb: typeof import('@dmr-x/db').closeDb;
let catalog: typeof import('@dmr-x/provider-catalog').PROVIDER_CATALOG;
const directory = mkdtempSync(join(tmpdir(), 'dmrx-quota-ledger-luna-'));
const previous = process.env.DMRX_DATA_DIR;
const tenant = 'quota-ledger-luna-tenant';

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  mkdirSync(directory, { recursive: true });
  const database = await import('@dmr-x/db');
  closeDb = database.closeDb;
  await database.initDb();
  db = database.getDb();
  db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run(tenant, 'Quota ledger Luna');
  db.prepare('INSERT INTO api_keys (id,tenant_id,key_hash) VALUES (?,?,?)').run(`${tenant}-key`, tenant, 'fixture-quota-ledger-luna-hash');
  catalog = (await import('@dmr-x/provider-catalog')).PROVIDER_CATALOG;
  quota = new (await import('../../services/quota/src/quota.service.js')).QuotaService();
});

afterAll(async () => {
  await closeDb();
  if (previous === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previous;
});

describe('Luna quota ledger hardening', () => {
  it('settles missing holds once with authenticated tenant, provider, and model context', async () => {
    const hold = await quota.reserveAgentRun(tenant, 'settle-provider', 1, 0, { modelId: 'settle-model' });
    expect(hold.ok).toBe(true);
    db.prepare('DELETE FROM agent_quota_holds WHERE id = ?').run(hold.holdId);

    const context = { tenantId: tenant, providerKey: 'settle-provider', modelId: 'settle-model' };
    await quota.settleAgentHold(hold.holdId!, { tokens: 99, costDollars: 0 }, context);
    await quota.settleAgentHold(hold.holdId!, { tokens: 99, costDollars: 0 }, context);

    const usage = db.prepare(
      'SELECT COUNT(*) AS count, MAX(model_id) AS model_id, MAX(total_tokens) AS total_tokens FROM usage_records WHERE tenant_id = ? AND request_id = ?',
    ).get(tenant, hold.holdId) as { count: number; model_id: string; total_tokens: number };
    const settlements = db.prepare(
      'SELECT COUNT(*) AS count FROM agent_quota_settlements WHERE hold_id = ?',
    ).get(hold.holdId) as { count: number };
    expect(usage).toEqual({ count: 1, model_id: 'settle-model', total_tokens: 99 });
    expect(settlements.count).toBe(1);
  });

  it('rejects a pinned free model after its durable daily token budget is exhausted', async () => {
    const provider = catalog.find((candidate) =>
      candidate.models.some((model) => (model.freeTier?.dailyTokenBudget ?? 0) > 0),
    )!;
    const model = provider.models.find((candidate) => (candidate.freeTier?.dailyTokenBudget ?? 0) > 0)!;
    const dailyBudget = model.freeTier!.dailyTokenBudget!;

    await quota.recordUsage(tenant, provider.id, dailyBudget, 0);

    const result = await quota.reserveAgentRun(tenant, provider.id, 1, 0, { modelId: model.id });
    expect(result.ok).toBe(false);
  });
});
