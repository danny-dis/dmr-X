import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  AGENT_SERVER_MAX_TOKENS,
  clampAgentTokens,
  estimateAgentCostCents,
  estimateAgentRunTokens,
  isFreeAgentModel,
  preflightModelRun,
  settleAgentRun,
} from '../../apps/gateway/src/lib/agent-admission.js';
import { initDb, getDb, closeDb, createNamespacedCache } from '@dmr-x/db';
import { QuotaService } from '../../services/quota/src/quota.service.js';

// TDD regressions for review-hosted-final SEC-001/002/003 + LOGIC-001.
// - LOGIC-001: omitted maxTokens must still get a finite server ceiling.
// - SEC-001: bare aliases with no resolvable pricing must NOT assume free.
// - Pricing math: model pricing is USD per 1k; estimate cents must x100.
// - SEC-002: atomic reserve-before-run; concurrent reserves must not oversubscribe.
// - Paid run without quota service must fail closed (quota-less strict-free
//   fixtures still admitted).

let tempDir: string;
let originalDataDir: string | undefined;
const quotaCache = createNamespacedCache('quota');

function insertTenant(id: string): void {
  getDb().prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(id, `Tenant ${id}`);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-admission-reserve-test-'));
  originalDataDir = process.env.DMRX_DATA_DIR;
  process.env.DMRX_DATA_DIR = tempDir;
  delete process.env.DMRX_ENCRYPTION_KEY;
  await initDb();
  getDb().exec(`CREATE TABLE IF NOT EXISTS agent_quota_holds (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_key TEXT NOT NULL DEFAULT 'agent',
    estimated_tokens INTEGER NOT NULL,
    estimated_cost_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  )`);
});

afterAll(async () => {
  quotaCache.flush();
  await closeDb();
  if (originalDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('LOGIC-001 finite token ceiling', () => {
  it('returns the finite server cap when the client omits maxTokens', () => {
    expect(AGENT_SERVER_MAX_TOKENS).toBeGreaterThan(0);
    expect(clampAgentTokens(undefined)).toBe(AGENT_SERVER_MAX_TOKENS);
    expect(clampAgentTokens(null)).toBe(AGENT_SERVER_MAX_TOKENS);
  });
});

describe('SEC-001 bare aliases fail closed without pricing', () => {
  it('does not treat a bare alias with null pricing as free', () => {
    expect(isFreeAgentModel('auto', null)).toBe(false);
    expect(isFreeAgentModel('auto-smart', null)).toBe(false);
    expect(isFreeAgentModel('test-model', null)).toBe(false);
  });

  it('does not treat a provider pin with null pricing as free', () => {
    expect(isFreeAgentModel('openai/gpt-4o', null)).toBe(false);
  });

  it('treats resolved zero-price pricing as free', () => {
    expect(
      isFreeAgentModel('openai/gpt-4o', {
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputPricePer1kTokens: 0,
        outputPricePer1kTokens: 0,
      }),
    ).toBe(true);
  });

  it('rejects a bare alias with no pricing evidence before touching quota', async () => {
    let quotaTouched = false;
    const out = await preflightModelRun({
      model: 'auto',
      estimatedTokens: 4000,
      maxSteps: 5,
      tenantId: 't-alias',
      getPricing: async () => null,
      quotaService: {
        checkQuota: async () => { quotaTouched = true; },
      } as any,
    });
    expect(out.admitted).toBe(false);
    if (!out.admitted) expect(out.status).toBe(402);
    expect(quotaTouched).toBe(false);
  });

  it('admits a bare alias when router evidence proves a free resolution', async () => {
    let quotaTouched = false;
    const out = await preflightModelRun({
      model: 'auto',
      estimatedTokens: 4000,
      maxSteps: 5,
      tenantId: 't-alias-free',
      getPricing: async () => null,
      resolveAliasFree: async () => true,
      quotaService: {
        checkQuota: async () => { quotaTouched = true; },
      } as any,
    });
    expect(out.admitted).toBe(true);
    expect(quotaTouched).toBe(true);
  });

  it('fails closed for a paid run with no quota service (quota-less free fixtures still pass)', async () => {
    const paid = await preflightModelRun({
      model: 'openai/gpt-4o',
      estimatedTokens: 1000,
      maxSteps: 2,
      tenantId: 't-noquota',
      getPricing: async () => ({
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputPricePer1kTokens: 3,
        outputPricePer1kTokens: 6,
      }),
    });
    expect(paid.admitted).toBe(false);
    if (!paid.admitted) expect(paid.status).toBe(402);

    const free = await preflightModelRun({
      model: 'openai/gpt-4o',
      estimatedTokens: 1000,
      maxSteps: 2,
      tenantId: 't-noquota-free',
      getPricing: async () => ({
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputPricePer1kTokens: 0,
        outputPricePer1kTokens: 0,
      }),
    });
    expect(free.admitted).toBe(true);
  });
});

describe('pricing math (USD per 1k -> cents)', () => {
  it('multiplies USD-per-1k pricing by 100 to reach cents', () => {
    // 2000 tokens at 3 + 6 USD/1k = 2 * 9 USD = 1800 cents.
    // The old code returned 18 (missing the x100).
    const cents = estimateAgentCostCents(
      { providerId: 'p', modelId: 'm', inputPricePer1kTokens: 3, outputPricePer1kTokens: 6 },
      2000,
    );
    expect(cents).toBe(1800);
  });

  it('estimates the whole multi-turn run, not an arbitrary 2000', () => {
    expect(estimateAgentRunTokens(32000, 10)).toBe(320000);
    expect(estimateAgentRunTokens(100, 3)).toBe(300);
  });
});

describe('SEC-002 atomic reserve-before-run (no oversubscribe)', () => {
  it('lets exactly one of two concurrent reserves win when capacity fits one', async () => {
    const tenant = `t-race-${Date.now()}`;
    insertTenant(tenant);
    const svc = new QuotaService();
    await svc.createAllocation(tenant, null, null, 5000, null, 'monthly');

    const run = (tag: string) =>
      svc.reserveAgentRun(tenant, 'agent', 4000, 100, { requestId: tag, ttlMs: 60_000 });
    const [a, b] = await Promise.all([run('a'), run('b')]);
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    // Release the winner so later tests/other runs are unaffected.
    await svc.releaseAgentHold(wins[0].holdId as string);
  });

  it('releases on failure without recording usage, and settles actuals once', async () => {
    const tenant = `t-settle-${Date.now()}`;
    insertTenant(tenant);
    const svc = new QuotaService();
    await svc.createAllocation(tenant, null, null, 100_000, null, 'monthly');

    const held = await svc.reserveAgentRun(tenant, 'agent', 1000, 50, { ttlMs: 60_000 });
    expect(held.ok).toBe(true);
    // Release path records nothing: usage stays zero.
    await svc.releaseAgentHold(held.holdId as string);

    const held2 = await svc.reserveAgentRun(tenant, 'agent', 1000, 50, { ttlMs: 60_000 });
    expect(held2.ok).toBe(true);
    // Settle records the MEASURED actuals exactly once (no double count:
    // settle must not re-add the estimate on top of the actuals).
    await svc.settleAgentHold(held2.holdId as string, { tokens: 700, costDollars: 0.11 });
    // The hold settles under its provider key ('agent'); a per-provider
    // allocation bucket reads it back exactly once (no double count).
    const usage = await (svc as any).getUsage(tenant, { providerId: 'agent' } as any);
    expect(usage.tokens).toBe(700);
  });
});

describe('SEC-003 resume settlement records measured alias usage', () => {
  it('records measured prompt/completion/cost for a bare-alias run instead of zeros', async () => {
    const calls: Array<{ tokens: number; cost: number }> = [];
    const sums = await settleAgentRun({
      tenantId: 't-resume',
      model: 'auto',
      allSteps: [],
      requestId: 'req-resume-1',
      sums: { promptTokens: 120, completionTokens: 45, totalTokens: 165, cost: 0.023 },
      quotaService: {
        recordUsage: async (_t: string, _p: string, tokens: number, cost: number) => {
          calls.push({ tokens, cost });
        },
      } as any,
    });
    expect(sums.totalTokens).toBe(165);
    expect(calls.length).toBe(1);
    expect(calls[0].tokens).toBe(165);
    expect(calls[0].cost).toBeGreaterThan(0);
  });
});
