import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { settleAgentRun } from '../../apps/gateway/src/lib/agent-admission.js';
import { QuotaService } from '../../services/quota/src/quota.service.js';

let db: ReturnType<typeof import('@dmr-x/db').getDb>;
let closeDb: typeof import('@dmr-x/db').closeDb;
let creditService: typeof import('@dmr-x/billing').creditService;
const directory = mkdtempSync(join(tmpdir(), 'dmrx-quota-integration-review-'));
const previousDataDir = process.env.DMRX_DATA_DIR;

function uniqueTenant(label: string): string {
  return `quota-review-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function insertTenant(tenantId: string): void {
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, tenantId);
}

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  mkdirSync(directory, { recursive: true });
  const database = await import('@dmr-x/db');
  closeDb = database.closeDb;
  await database.initDb();
  db = database.getDb();
  creditService = (await import('@dmr-x/billing')).creditService;
});

afterAll(async () => {
  await closeDb();
  if (previousDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDataDir;
});

describe('quota integration review regressions', () => {
  it('settles through one durable accounting path and keeps retries at one row', async () => {
    const tenantId = uniqueTenant('exact-once');
    insertTenant(tenantId);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 100, 0);
    expect(hold.ok).toBe(true);

    const billingTelemetry = { recordUsage: vi.fn().mockResolvedValue(undefined) };
    const args = {
      tenantId,
      model: 'fixture-provider/fixture-model',
      allSteps: [],
      requestId: 'exact-once-request',
      sums: { promptTokens: 60, completionTokens: 40, totalTokens: 100, cost: 0 },
      holdId: hold.holdId,
      quotaService: quota,
      billingService: billingTelemetry,
    };

    await settleAgentRun(args);
    await settleAgentRun(args);

    const usage = db.prepare(
      'SELECT COUNT(*) AS rows, SUM(total_tokens) AS tokens FROM usage_records WHERE tenant_id = ?',
    ).get(tenantId) as { rows: number; tokens: number };
    const billing = db.prepare(
      'SELECT COUNT(*) AS rows FROM billing_records WHERE tenant_id = ?',
    ).get(tenantId) as { rows: number };
    const settlements = db.prepare(
      'SELECT COUNT(*) AS rows FROM agent_quota_settlements WHERE tenant_id = ?',
    ).get(tenantId) as { rows: number };

    expect(usage).toEqual({ rows: 1, tokens: 100 });
    expect(billing.rows).toBe(1);
    expect(settlements.rows).toBe(1);
    expect(billingTelemetry.recordUsage).not.toHaveBeenCalled();
  });

  it('preserves measured prompt and completion usage in the durable row', async () => {
    const tenantId = uniqueTenant('token-split');
    insertTenant(tenantId);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 100, 0);
    await settleAgentRun({
      tenantId, model: 'fixture-provider/fixture-model', allSteps: [], requestId: 'split-request',
      sums: { promptTokens: 60, completionTokens: 40, totalTokens: 100, cost: 0 },
      holdId: hold.holdId, quotaService: quota,
    });
    expect(db.prepare('SELECT input_tokens, output_tokens FROM usage_records WHERE tenant_id = ?').get(tenantId))
      .toEqual({ input_tokens: 60, output_tokens: 40 });
  });

  it('never lets a warm budget cache underreport durable usage', async () => {
    const tenantId = uniqueTenant('warm-cache');
    insertTenant(tenantId);
    const quota = new QuotaService();
    await quota.recordUsage(tenantId, 'fixture-provider', 800, 0);
    expect(await quota.getProviderBudgetUsage(tenantId, 'fixture-provider')).toBe(800);

    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 100, 0);
    expect(hold.ok).toBe(true);
    await quota.settleAgentHold(
      hold.holdId!,
      { tokens: 100, costDollars: 0 },
      { tenantId, providerKey: 'fixture-provider', modelId: 'fixture-model' },
    );

    expect(await quota.getProviderBudgetUsage(tenantId, 'fixture-provider')).toBe(900);
    expect(
      (db.prepare('SELECT SUM(total_tokens) AS tokens FROM usage_records WHERE tenant_id = ?').get(tenantId) as { tokens: number }).tokens,
    ).toBe(900);
  });

  it('uses the allocation period instead of counting yesterday against today', async () => {
    const tenantId = uniqueTenant('daily-period');
    insertTenant(tenantId);
    const quota = new QuotaService();
    await quota.createAllocation(tenantId, 'fixture-provider', null, 100, null, 'daily');
    await quota.recordUsage(tenantId, 'fixture-provider', 100, 0);

    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
    db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(yesterday, tenantId);

    const admission = await quota.reserveAgentRun(tenantId, 'fixture-provider', 1, 0);
    expect(admission.ok).toBe(true);
  });

  it('enforces provider=agent allocations as an agent-wide aggregate', async () => {
    const tenantId = uniqueTenant('agent-aggregate');
    insertTenant(tenantId);
    const quota = new QuotaService();
    await quota.createAllocation(tenantId, 'agent', null, 100, null, 'monthly');
    await quota.recordUsage(tenantId, 'fixture-provider', 100, 0);

    const admission = await quota.reserveAgentRun(tenantId, 'fixture-provider', 1, 0);
    expect(admission.ok).toBe(false);
  });

  it('retries a failed credit debit without duplicating usage or credit deduction', async () => {
    const tenantId = uniqueTenant('credit-retry');
    insertTenant(tenantId);
    creditService.topUp(tenantId, 1000);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 1, 100);
    expect(hold.ok).toBe(true);

    const originalDeduct = creditService.deductUsage;
    const injectedFailure = vi.spyOn(creditService, 'deductUsage').mockImplementationOnce(() => {
      throw new Error('injected debit I/O failure');
    });
    try {
      await expect(
        quota.settleAgentHold(
          hold.holdId!,
          { tokens: 1, costDollars: 1 },
          { tenantId, providerKey: 'fixture-provider', modelId: 'fixture-model' },
        ),
      ).rejects.toThrow('injected debit I/O failure');
    } finally {
      injectedFailure.mockRestore();
    }
    expect(creditService.deductUsage).toBe(originalDeduct);

    await quota.settleAgentHold(
      hold.holdId!,
      { tokens: 1, costDollars: 1 },
      { tenantId, providerKey: 'fixture-provider', modelId: 'fixture-model' },
    );

    expect(creditService.getBalance(tenantId)?.balanceCents).toBe(900);
    expect(
      (db.prepare("SELECT COUNT(*) AS rows FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(tenantId) as { rows: number }).rows,
    ).toBe(1);
    expect(
      (db.prepare('SELECT COUNT(*) AS rows FROM usage_records WHERE tenant_id = ?').get(tenantId) as { rows: number }).rows,
    ).toBe(1);
  });

  it('propagates settlement rollback so the caller can retry measured usage', async () => {
    const tenantId = uniqueTenant('rollback');
    insertTenant(tenantId);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 100, 0);
    expect(hold.ok).toBe(true);
    db.exec(
      `CREATE TRIGGER quota_review_fail_billing
       BEFORE INSERT ON billing_records
       WHEN NEW.tenant_id = '${tenantId}'
       BEGIN SELECT RAISE(ABORT, 'injected billing failure'); END;`,
    );

    try {
      await expect(
        settleAgentRun({
          tenantId,
          model: 'fixture-provider/fixture-model',
          allSteps: [],
          requestId: 'rollback-request',
          sums: { promptTokens: 60, completionTokens: 40, totalTokens: 100, cost: 0 },
          holdId: hold.holdId,
          quotaService: quota,
        }),
      ).rejects.toThrow();
    } finally {
      db.exec('DROP TRIGGER quota_review_fail_billing');
    }

    expect((db.prepare('SELECT COUNT(*) AS rows FROM agent_quota_holds WHERE id = ?').get(hold.holdId) as { rows: number }).rows).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS rows FROM agent_quota_settlements WHERE hold_id = ?').get(hold.holdId) as { rows: number }).rows).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS rows FROM usage_records WHERE tenant_id = ?').get(tenantId) as { rows: number }).rows).toBe(0);

    await settleAgentRun({
      tenantId,
      model: 'fixture-provider/fixture-model',
      allSteps: [],
      requestId: 'rollback-request',
      sums: { promptTokens: 60, completionTokens: 40, totalTokens: 100, cost: 0 },
      holdId: hold.holdId,
      quotaService: quota,
    });
    expect((db.prepare('SELECT COUNT(*) AS rows FROM usage_records WHERE tenant_id = ?').get(tenantId) as { rows: number }).rows).toBe(1);
  });

  it('rejects invalid measured actuals instead of writing NaN or negative usage', async () => {
    const tenantId = uniqueTenant('invalid-actuals');
    insertTenant(tenantId);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 1, 0);
    expect(hold.ok).toBe(true);

    await expect(
      quota.settleAgentHold(hold.holdId!, { tokens: Number.NaN, costDollars: 0 }),
    ).rejects.toThrow('actual usage must be finite and non-negative');
    await expect(
      quota.settleAgentHold(hold.holdId!, { tokens: -1, costDollars: 0 }),
    ).rejects.toThrow('actual usage must be finite and non-negative');
  });
});
