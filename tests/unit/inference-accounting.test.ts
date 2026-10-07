import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { buildDimension, buildVector } from '../../services/quota/src/quota-vector.js';

const directory = mkdtempSync(join(tmpdir(), 'dmrx-inference-accounting-'));
const previousDirectory = process.env.DMRX_DATA_DIR;
let db: ReturnType<typeof import('@dmr-x/db').getDb>;
let closeDb: typeof import('@dmr-x/db').closeDb;
let QuotaService: typeof import('../../services/quota/src/quota.service.js').QuotaService;
let creditService: typeof import('@dmr-x/billing').creditService;
const provider = 'accounting-provider';
const model = 'accounting-model';
const request: UnifiedRequest = { modality: 'llm', model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 16 };
const response: UnifiedResponse = { modality: 'llm', requestId: 'accounting-response', providerId: provider, modelId: model, message: { role: 'assistant', content: 'OK' }, usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }, latencyMs: 1 };

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  const database = await import('@dmr-x/db');
  closeDb = database.closeDb;
  await database.initDb();
  db = database.getDb();
  QuotaService = (await import('../../services/quota/src/quota.service.js')).QuotaService;
  creditService = (await import('@dmr-x/billing')).creditService;
  db.prepare('INSERT INTO providers (id,name,adapter_type) VALUES (?,?,?)').run(provider, provider, 'openai');
  db.prepare('INSERT INTO model_profiles (id,provider_id,model_id,modality,input_cost_per_1k,output_cost_per_1k) VALUES (?,?,?,?,?,?)').run('accounting-profile',provider,model,'llm',0.01,0.02);
}, 90000);

afterAll(async () => {
  await closeDb?.();
  if (previousDirectory === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDirectory;
});

function tenant(name: string, cents = 10) {
  db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run(name,name);
  if (cents > 0) creditService.topUp(name, cents);
  return name;
}

describe('authoritative inference accounting', () => {
  it('does not carry old daily usage into a new UTC day', async () => {
    const id = tenant('accounting-daily');
    const quota = new QuotaService();
    await quota.createAllocation(id, provider, 1, null, null, 'daily');
    await quota.recordUsage(id, provider, 7, 0);
    db.prepare("UPDATE usage_records SET created_at = '2020-01-01 23:59:59' WHERE tenant_id = ?").run(id);
    await expect(new QuotaService().checkQuota(id, provider, 1, 0)).resolves.toBeUndefined();
  });

  it('preserves sub-cent paid usage and debits exactly once', async () => {
    const id = tenant('accounting-paid');
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(id, provider, 16, 1, { modelId: model });
    expect(hold.ok).toBe(true);
    await quota.settleAgentHold(hold.holdId!, {tokens: 5, costDollars: 0.00008});
    await quota.settleAgentHold(hold.holdId!, {tokens: 5, costDollars: 0.00008});
    expect(creditService.getBalance(id).balanceCents).toBeCloseTo(9.992, 8);
    const usage = db.prepare('SELECT COUNT(*) AS count, SUM(cost_cents) AS cents FROM usage_records WHERE tenant_id = ?').get(id) as any;
    expect(usage.count).toBe(1);
    expect(usage.cents).toBeCloseTo(0.008,8);
  });
});

function rowCount(sql: string, ...params: unknown[]): number {
  return Number((db.prepare(sql).get(...params) as any).count);
}

describe('ordinary recordUsage is one atomic debit', () => {
  it('inserts no usage or billing row when the credit debit fails', async () => {
    const id = tenant('accounting-insufficient', 1); // 1 cent of credit
    const quota = new QuotaService();

    await expect(quota.recordUsage(id, provider, 100, 0.5)).rejects.toThrow();

    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ?', id)).toBe(0);
    expect(creditService.getBalance(id)!.balanceCents).toBe(1);
  });

  it('debits fractional cents exactly once and keys the row by a random request id', async () => {
    const id = tenant('accounting-ordinary-fraction');
    const quota = new QuotaService();

    await quota.recordUsage(id, provider, 5, 0.00008);

    expect(creditService.getBalance(id)!.balanceCents).toBeCloseTo(9.992, 8);
    const row = db.prepare(
      'SELECT cost_cents, request_id FROM usage_records WHERE tenant_id = ?',
    ).get(id) as { cost_cents: number; request_id: string };
    expect(row.cost_cents).toBeCloseTo(0.008, 8);
    expect(row.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('zero quota limits are real limits', () => {
  it('rejects admission when every limit on the allocation is zero', async () => {
    const id = tenant('accounting-zero-limits');
    const quota = new QuotaService();
    await quota.createAllocation(id, provider, 0, 0, 0, 'daily');

    await expect(quota.checkQuota(id, provider, 0, 0)).rejects.toThrow();
  });

  it('maps a stored zero cost limit to 0 instead of dropping it', async () => {
    const id = tenant('accounting-zero-map');
    const quota = new QuotaService();

    const allocation = await quota.createAllocation(id, provider, null, null, 0, 'daily');

    expect(allocation.maxCost).toBe(0);
  });

  it('filters a candidate out when any applicable global or provider allocation is exhausted', async () => {
    const id = tenant('accounting-zero-filter');
    const quota = new QuotaService();
    // Generous global allocation first: read-then-check on "the first match"
    // lets this candidate through even though the provider allocation is zero.
    await quota.createAllocation(id, null, 100, 100_000, 100, 'monthly');
    await quota.createAllocation(id, provider, 0, null, null, 'monthly');
    const candidates = [{ providerId: provider, modelId: model }] as unknown as CandidateSet;

    const filtered = await quota.filterByQuota(candidates, id);

    expect(filtered).toHaveLength(0);
  });
});

function utcWeekStart(now = new Date()): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
}

describe('weekly and rolling quota windows', () => {
  it('does not carry pre-week usage into the current UTC Monday week', async () => {
    const id = tenant('accounting-weekly');
    const quota = new QuotaService();
    await quota.createAllocation(id, provider, 1, null, null, 'weekly');

    await quota.recordUsage(id, provider, 1, 0);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();

    const beforeWeek = new Date(utcWeekStart().getTime() - 1000);
    db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(beforeWeek.toISOString(), id);
    await expect(quota.checkQuota(id, provider, 1, 0)).resolves.toBeUndefined();

    // Monday 00:00 UTC itself is inside the window.
    db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(utcWeekStart().toISOString(), id);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();
    db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(beforeWeek.toISOString(), id);

    const hold = await quota.reserveAgentRun(id, provider, 1, 0, { modelId: model });
    expect(hold.ok).toBe(true);
    await quota.releaseAgentHold(hold.holdId!);

    await quota.recordUsage(id, provider, 1, 0);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();
  });

  it('honors rolling_24h windows in both checkQuota and reserveAgentRun', async () => {
    const id = tenant('accounting-rolling24');
    const quota = new QuotaService();
    await quota.createAllocation(id, provider, 1, null, null, 'rolling_24h');

    await quota.recordUsage(id, provider, 1, 0);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();

    const aged = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(aged, id);
    await expect(quota.checkQuota(id, provider, 1, 0)).resolves.toBeUndefined();

    const hold = await quota.reserveAgentRun(id, provider, 1, 0, { modelId: model });
    expect(hold.ok).toBe(true);
    await quota.releaseAgentHold(hold.holdId!);

    await quota.recordUsage(id, provider, 1, 0);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();
  });
});

describe('durable manual quota reset', () => {
  it('cutoffs usage per allocation without deleting ledger rows or resetting spend', async () => {
    const id = tenant('accounting-reset');
    const quota = new QuotaService();
    await quota.createAllocation(id, provider, 1, null, null, 'daily');
    await quota.createAllocation(id, null, null, 1_000_000, null, 'daily');

    await quota.recordUsage(id, provider, 3, 0.00008);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();

    const ledgerRow = db.prepare(
      'SELECT rowid AS rowid FROM usage_records WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 1',
    ).get(id) as { rowid: number };
    const balanceBefore = creditService.getBalance(id)!.balanceCents;

    await quota.resetQuotas(id);

    // Every allocation of the tenant gets its own durable cutoff marker.
    const markers = db.prepare(
      'SELECT allocation_id, reset_at, after_rowid FROM quota_allocation_resets WHERE allocation_id IN (SELECT id FROM quota_allocations WHERE tenant_id = ?)',
    ).all(id) as Array<{ allocation_id: string; reset_at: string; after_rowid: number }>;
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.after_rowid).toBeGreaterThanOrEqual(ledgerRow.rowid);
      expect(typeof marker.reset_at).toBe('string');
    }

    await expect(quota.checkQuota(id, provider, 1, 0)).resolves.toBeUndefined();

    // Append-only ledger: nothing is deleted, and money/credit is untouched.
    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ?', id)).toBe(1);
    expect(creditService.getBalance(id)!.balanceCents).toBeCloseTo(balanceBefore, 8);

    // Pending holds still count after a reset.
    const first = await quota.reserveAgentRun(id, provider, 1, 0, { modelId: model });
    expect(first.ok).toBe(true);
    const second = await quota.reserveAgentRun(id, provider, 1, 0, { modelId: model });
    expect(second.ok).toBe(false);
    await quota.releaseAgentHold(first.holdId!);

    // Spend recorded after the cutoff counts again.
    await quota.recordUsage(id, provider, 1, 0);
    await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();
    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(2);
  });
});

let providerSeq = 0;
function fixtureProvider(tag: string, prices?: { input: number; output: number; maxOutput?: number | null }) {
  const fixturePid = `acct-${tag}-p${++providerSeq}`;
  const fixtureMid = `acct-${tag}-m`;
  db.prepare('INSERT INTO providers (id,name,adapter_type) VALUES (?,?,?)').run(fixturePid, fixturePid, 'openai');
  if (prices) {
    db.prepare(
      'INSERT INTO model_profiles (id,provider_id,model_id,modality,input_cost_per_1k,output_cost_per_1k,max_output_tokens) VALUES (?,?,?,?,?,?,?)',
    ).run(`${fixturePid}-profile`, fixturePid, fixtureMid, 'llm', prices.input, prices.output, prices.maxOutput === undefined ? 64 : prices.maxOutput);
  }
  return { provider: fixturePid, model: fixtureMid };
}

function llmRequest(mid: string, extra?: Partial<UnifiedRequest>): UnifiedRequest {
  return {
    modality: 'llm',
    model: mid,
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 16,
    stream: false,
    metadata: {},
    ...extra,
  };
}

function llmResponse(fixturePid: string, fixtureMid: string, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): UnifiedResponse {
  return {
    modality: 'llm',
    requestId: `res-${fixturePid}`,
    providerId: fixturePid,
    modelId: fixtureMid,
    message: { role: 'assistant', content: 'OK' },
    ...(usage ? { usage } : {}),
    latencyMs: 1,
  };
}

describe('beginInferenceAttempt admission', () => {
  it('admits before dispatch, bills measured usage once, and returns the slot', async () => {
    const { provider: pid, model: mid } = fixtureProvider('admit', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-attempt');
    const quota = new QuotaService();

    const attempt = await quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid, {
      tools: [{ type: 'function', function: { name: 'lookup', description: 'x'.repeat(200), parameters: { type: 'object' } } }],
    }), { concurrencyLimit: 1, requestId: 'req-admit' });

    // Estimate is durable on the hold and stays a POSITIVE sub-cent amount
    // (a Math.round would zero it out).
    const hold = db.prepare(
      'SELECT estimated_cost_cents, estimated_tokens FROM agent_quota_holds WHERE tenant_id = ?',
    ).get(id) as { estimated_cost_cents: number; estimated_tokens: number };
    expect(hold.estimated_cost_cents).toBeGreaterThan(0);
    expect(hold.estimated_tokens).toBeGreaterThan(0);
    // Prompt estimate covers messages AND tools.
    const toolsChars = JSON.stringify({ messages: llmRequest(mid).messages, tools: llmRequest(mid, { tools: [{ type: 'function', function: { name: 'lookup', description: 'x'.repeat(200), parameters: { type: 'object' } } }] }).tools }).length;
    expect(hold.estimated_tokens).toBeGreaterThanOrEqual(Math.ceil(toolsChars / 4));

    await attempt.settle(llmResponse(pid, mid, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }));

    const usage = db.prepare(
      'SELECT input_tokens, output_tokens, total_tokens, cost_cents FROM usage_records WHERE tenant_id = ?',
    ).get(id) as { input_tokens: number; output_tokens: number; total_tokens: number; cost_cents: number };
    expect(usage.input_tokens).toBe(2);
    expect(usage.output_tokens).toBe(3);
    expect(usage.total_tokens).toBe(5);
    expect(usage.cost_cents).toBeCloseTo(0.008, 8);
    expect(creditService.getBalance(id)!.balanceCents).toBeCloseTo(9.992, 8);
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE tenant_id = ?', id)).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_settlements WHERE tenant_id = ?', id)).toBe(1);
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);

    // The single-slot bulkhead is free again after settle.
    const next = await quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid), { concurrencyLimit: 1 });
    await next.release();
  });

  it('never bypasses a registered vector that has no headroom', async () => {
    const { provider: pid, model: mid } = fixtureProvider('registered', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-registered-vector');
    const quota = new QuotaService();
    quota.registerQuotaVector(buildVector({
      providerId: pid,
      modelId: mid,
      keyId: 'dispatch',
      dimensions: [buildDimension({
        unit: 'concurrency',
        scope: 'upstream',
        scopeId: pid,
        limit: 1,
        remaining: 0,
        state: 'available',
        confidence: 1,
        replenishment: 'unknown',
        observedAtMs: Date.now(),
        staleAfterMs: Number.POSITIVE_INFINITY,
      })],
    }));

    await expect(quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid))).rejects.toThrow();
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE tenant_id = ?', id)).toBe(0);
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);
  });

  it('fails closed for an ordinary tenant when the price is missing or invalid', async () => {
    const missing = fixtureProvider('unpriced');
    const invalid = fixtureProvider('badprice', { input: -0.5, output: 0.02 });
    const id = tenant('accounting-unpriced');
    const quota = new QuotaService();

    await expect(quota.beginInferenceAttempt(id, missing.provider, missing.model, llmRequest(missing.model))).rejects.toThrow();
    await expect(quota.beginInferenceAttempt(id, invalid.provider, invalid.model, llmRequest(invalid.model))).rejects.toThrow();

    expect(quota.getCapacityManager().getReservationCount()).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE tenant_id = ?', id)).toBe(0);
  });
});

describe('beginInferenceAttempt accounting boundaries', () => {
  it('shares the default provider concurrency store across independent quota-service instances', async () => {
    const priced = fixtureProvider('default-shared', { input: 0, output: 0 });
    const first = new QuotaService();
    const second = new QuotaService();
    const one = await first.beginInferenceAttempt(undefined, priced.provider, priced.model, llmRequest(priced.model), { concurrencyLimit: 1 });
    try {
      await expect(second.beginInferenceAttempt(undefined, priced.provider, priced.model, llmRequest(priced.model), { concurrencyLimit: 1 })).rejects.toThrow();
    } finally {
      await one.release();
    }
    const two = await second.beginInferenceAttempt(undefined, priced.provider, priced.model, llmRequest(priced.model), { concurrencyLimit: 1 });
    await two.release();
  });
  it('external accounting skips only the tenant hold and debit, never capacity', async () => {
    const priced = fixtureProvider('external', { input: 0.01, output: 0.02 });
    const unpriced = fixtureProvider('external-unpriced');
    const blocked = fixtureProvider('external-blocked', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-external', 1); // 1 cent: a real debit could not cover this
    const quota = new QuotaService();

    // Missing price is fine for external accounting; tenant identity is not
    // required because there is no tenant debit to make.
    const attempt = await quota.beginInferenceAttempt(undefined, unpriced.provider, unpriced.model, llmRequest(unpriced.model), { externalAccounting: true, concurrencyLimit: 1 });
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE tenant_id = ?', id)).toBe(0);
    await attempt.settle(llmResponse(unpriced.provider, unpriced.model, { prompt_tokens: 5000, completion_tokens: 10, total_tokens: 5010 }));

    // No tenant ledger, no debit: accounting stayed with the caller.
    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ?', id)).toBe(0);
    expect(creditService.getBalance(id)!.balanceCents).toBe(1);

    // Provider capacity is still required.
    quota.registerQuotaVector(buildVector({
      providerId: blocked.provider,
      modelId: blocked.model,
      keyId: 'dispatch',
      dimensions: [buildDimension({
        unit: 'concurrency', scope: 'upstream', scopeId: blocked.provider,
        limit: 1, remaining: 0, state: 'available', confidence: 1,
        replenishment: 'unknown', observedAtMs: Date.now(),
        staleAfterMs: Number.POSITIVE_INFINITY,
      })],
    }));
    await expect(
      quota.beginInferenceAttempt(undefined, blocked.provider, blocked.model, llmRequest(blocked.model), { externalAccounting: true }),
    ).rejects.toThrow();
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);

    // Tenant-less local requests still acquire capacity; there is no tenant
    // identity against which a hold or debit could legitimately be posted.
    const anonymous = await quota.beginInferenceAttempt(undefined, priced.provider, priced.model, llmRequest(priced.model), { concurrencyLimit: 1 });
    await expect(quota.beginInferenceAttempt(undefined, priced.provider, priced.model, llmRequest(priced.model), { concurrencyLimit: 1 })).rejects.toThrow();
    await anonymous.settle(llmResponse(priced.provider, priced.model, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);
  });

  it('returns the provider slot when the tenant hold is rejected', async () => {
    const { provider: pid, model: mid } = fixtureProvider('holdfail', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-holdfail');
    const quota = new QuotaService();
    await quota.createAllocation(id, pid, 0, null, null, 'daily');

    await expect(
      quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid), { concurrencyLimit: 1 }),
    ).rejects.toThrow();
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE tenant_id = ?', id)).toBe(0);
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);

    // The single slot was never leaked: another tenant can take it.
    const other = tenant('accounting-holdfail-other');
    const attempt = await quota.beginInferenceAttempt(other, pid, mid, llmRequest(mid), { concurrencyLimit: 1 });
    await attempt.release();
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);
  });

  it('shares one settlement promise, retains the hold on debit failure, and returns the slot', async () => {
    const { provider: pid, model: mid } = fixtureProvider('settlefail', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-settlefail', 1); // 1 cent
    const quota = new QuotaService();

    const attempt = await quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid), { concurrencyLimit: 1 });
    const hold = db.prepare('SELECT id FROM agent_quota_holds WHERE tenant_id = ?').get(id) as { id: string };

    const failing = attempt.settle(llmResponse(pid, mid, { prompt_tokens: 5000, completion_tokens: 10, total_tokens: 5010 }));
    const repeated = attempt.settle(llmResponse(pid, mid, { prompt_tokens: 5000, completion_tokens: 10, total_tokens: 5010 }));
    expect(repeated).toBe(failing);
    await expect(failing).rejects.toThrow();

    // Durable hold retained for retry, no ledger row, no partial money moved.
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE id = ?', hold.id)).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ?', id)).toBe(0);
    expect(creditService.getBalance(id)!.balanceCents).toBe(1);

    // The provider concurrency slot still came back despite the failed debit.
    const other = tenant('accounting-settlefail-other');
    const next = await quota.beginInferenceAttempt(other, pid, mid, llmRequest(mid), { concurrencyLimit: 1 });
    await next.release();

    // An already dispatched, failed debit remains retryable through its handle.
    // Cancellation must not erase the durable liability after settlement began.
    await expect(attempt.release()).rejects.toThrow();
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE id = ?', hold.id)).toBe(1);
    creditService.topUp(id, 10, 'retry-after-topup', 'test');
    await attempt.settle(llmResponse(pid, mid, { prompt_tokens: 5000, completion_tokens: 10, total_tokens: 5010 }));
    expect(rowCount('SELECT COUNT(*) AS count FROM agent_quota_holds WHERE id = ?', hold.id)).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS count FROM usage_records WHERE tenant_id = ?', id)).toBe(1);
    expect(rowCount('SELECT COUNT(*) AS count FROM billing_records WHERE tenant_id = ?', id)).toBe(1);
  });

  it('bills a conservative estimate when a completed response reports no usage', async () => {
    const { provider: pid, model: mid } = fixtureProvider('nousage', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-nousage');
    const quota = new QuotaService();

    const attempt = await quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid));
    await attempt.settle(llmResponse(pid, mid)); // usage absent: dispatched work is not free

    const usage = db.prepare(
      'SELECT total_tokens, cost_cents FROM usage_records WHERE tenant_id = ?',
    ).get(id) as { total_tokens: number; cost_cents: number };
    expect(usage.total_tokens).toBeGreaterThan(0);
    expect(usage.cost_cents).toBeGreaterThan(0);
    expect(creditService.getBalance(id)!.balanceCents).toBeLessThan(10);
    expect(quota.getCapacityManager().getReservationCount()).toBe(0);
  });

  it('keeps the lease and the agent hold alive while the attempt stays active', async () => {
    const { provider: pid, model: mid } = fixtureProvider('keepalive', { input: 0.01, output: 0.02 });
    const id = tenant('accounting-keepalive');
    const quota = new QuotaService();
    const renew = vi.fn();
    (quota.getCapacityManager() as unknown as { renew?: unknown }).renew = renew;

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const attempt = await quota.beginInferenceAttempt(id, pid, mid, llmRequest(mid), { concurrencyLimit: 4 });
      const before = db.prepare('SELECT expires_at FROM agent_quota_holds WHERE tenant_id = ?').get(id) as { expires_at: string };

      vi.advanceTimersByTime(31_000); // past the 30s lease, on an active stream

      expect(renew).toHaveBeenCalled();
      const after = db.prepare('SELECT expires_at FROM agent_quota_holds WHERE tenant_id = ?').get(id) as { expires_at: string };
      expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(before.expires_at).getTime());
      expect(quota.getCapacityManager().getReservationCount()).toBe(1);

      await attempt.release();
      expect(quota.getCapacityManager().getReservationCount()).toBe(0);
      await attempt.release(); // idempotent
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('remaining rolling windows', () => {
  it('honors rolling_7d and rolling_30d in checkQuota', async () => {
    const cases: Array<[string, number]> = [
      ['rolling_7d', 8 * 24 * 60 * 60 * 1000],
      ['rolling_30d', 31 * 24 * 60 * 60 * 1000],
    ];
    for (const [period, ageMs] of cases) {
      const id = tenant(`accounting-${period}`);
      const quota = new QuotaService();
      await quota.createAllocation(id, provider, 1, null, null, period);

      await quota.recordUsage(id, provider, 1, 0);
      await expect(quota.checkQuota(id, provider, 1, 0)).rejects.toThrow();

      const aged = new Date(Date.now() - ageMs).toISOString();
      db.prepare('UPDATE usage_records SET created_at = ? WHERE tenant_id = ?').run(aged, id);
      await expect(quota.checkQuota(id, provider, 1, 0)).resolves.toBeUndefined();
    }
  });
});
