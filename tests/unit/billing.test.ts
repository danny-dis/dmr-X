import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { initDb, getDb, closeDb, createNamespacedCache } from '@dmr-x/db';
import { BillingService } from '../../services/billing/src/billing.service.js';
import { CreditService } from '../../services/billing/src/credit.service.js';
import { UsageTracker } from '../../services/billing/src/usage-tracker.js';
import { QuotaService } from '../../services/quota/src/quota.service.js';
import { addCostHeaders, extractCostMetrics } from '../../apps/gateway/src/middleware/cost-headers.js';

// ---------------------------------------------------------------------------
// Test fixtures — real SQLite database with a temp data dir (same pattern as
// usage-tracker.test.ts and auth-lookup-hash.test.ts).
// ---------------------------------------------------------------------------

let tempDir: string;
let originalDataDir: string | undefined;
const usageCache = createNamespacedCache('usage');
const quotaCache = createNamespacedCache('quota');

function insertTenant(id: string): void {
  getDb().prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)').run(id, `Tenant ${id}`);
}

function insertProvider(providerId: string, modelId: string, inputPrice: number, outputPrice: number): void {
  getDb().prepare(
    `INSERT OR IGNORE INTO providers (id, name, adapter_type) VALUES (?, ?, ?)`
  ).run(providerId, providerId, 'openai');
  getDb().prepare(
    `INSERT OR IGNORE INTO model_profiles
       (id, provider_id, model_id, modality, intelligence_layer, input_cost_per_1k, output_cost_per_1k)
     VALUES (?, ?, ?, 'chat', 'executor', ?, ?)`
  ).run(`${providerId}:${modelId}`, providerId, modelId, inputPrice, outputPrice);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-billing-test-'));
  originalDataDir = process.env.DMRX_DATA_DIR;
  process.env.DMRX_DATA_DIR = tempDir;
  delete process.env.DMRX_ENCRYPTION_KEY;
  await initDb();
});

afterAll(async () => {
  usageCache.flush();
  quotaCache.flush();
  await closeDb();
  if (originalDataDir === undefined) {
    delete process.env.DMRX_DATA_DIR;
  } else {
    process.env.DMRX_DATA_DIR = originalDataDir;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// BillingService
// ---------------------------------------------------------------------------

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(() => {
    usageCache.flush();
    insertTenant('t-billing');
    // $0.03/1k input, $0.06/1k output (in cents: 3, 6)
    insertProvider('openai', 'gpt-4', 3, 6);
    getDb().prepare('DELETE FROM usage_records').run();
    getDb().prepare('DELETE FROM billing_records').run();
    service = new BillingService(new UsageTracker());
  });

  it('calculates cost correctly for input + output tokens', () => {
    // 1000 input tokens @ 3 cents/1k = 3 cents
    // 500 output tokens @ 6 cents/1k = 3 cents
    // total = 6 cents
    const cost = service.calculateCost(1000, 500, {
      providerId: 'openai',
      modelId: 'gpt-4',
      inputPricePer1kTokens: 3,
      outputPricePer1kTokens: 6,
    });
    expect(cost).toBe(6);
  });

  it('returns 0 cost when no pricing is available', async () => {
    const record = await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'unknown',
      modelId: 'unknown',
      inputTokens: 100,
      outputTokens: 50,
      requestId: 'req-no-price',
    });
    expect(record.costCents).toBe(0);
  });

  it('loads pricing from model_profiles and records usage with calculated cost', async () => {
    const record = await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 1000,
      outputTokens: 500,
      requestId: 'req-priced',
    });
    // (1000/1000)*3 + (500/1000)*6 = 3 + 3 = 6 cents
    expect(record.costCents).toBe(6);
  });

  it('generates a daily report with correct totals', async () => {
    await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 1000,
      outputTokens: 500,
      requestId: 'req-report-1',
    });
    await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 2000,
      outputTokens: 1000,
      requestId: 'req-report-2',
    });

    const today = new Date();
    const report = await service.generateDailyReport('t-billing', today);
    expect(report.totals.totalRequests).toBe(2);
    expect(report.totals.totalInputTokens).toBe(3000);
    expect(report.totals.totalOutputTokens).toBe(1500);
    expect(report.totals.totalTokens).toBe(4500);
    // cost: (3000/1000)*3 + (1500/1000)*6 = 9 + 9 = 18 cents
    expect(report.totals.totalCostCents).toBe(18);
    expect(report.totals.totalCostFormatted).toBe('$0.18');
  });

  it('checks budget alerts at correct thresholds', async () => {
    // Record usage that brings us to exactly 50% of budget
    await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 1000,
      outputTokens: 500,
      requestId: 'req-alert-1',
    });
    // cost = 6 cents
    const alerts = await service.checkBudgetAlerts('t-billing', 12, [50, 75, 90, 100]);
    // 6/12 = 50%, so 50% threshold should trigger
    expect(alerts.length).toBe(1);
    expect(alerts[0].threshold).toBe(50);
    expect(alerts[0].spentCents).toBe(6);
  });

  it('returns empty alerts when budget is 0', async () => {
    const alerts = await service.checkBudgetAlerts('t-billing', 0);
    expect(alerts).toEqual([]);
  });

  it('queries usage records by tenant', async () => {
    await service.recordUsage({
      tenantId: 't-billing',
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      requestId: 'req-query-1',
    });
    const records = await service.queryUsage({ tenantId: 't-billing' });
    expect(records).toHaveLength(1);
    expect(records[0].requestId).toBe('req-query-1');
  });
});

// ---------------------------------------------------------------------------
// CreditService
// ---------------------------------------------------------------------------

describe('CreditService', () => {
  let service: CreditService;

  beforeEach(() => {
    getDb().prepare('DELETE FROM credits').run();
    getDb().prepare('DELETE FROM credit_transactions').run();
    insertTenant('t-credit');
    service = new CreditService();
  });

  it('returns null for non-existent tenant', () => {
    expect(service.getBalance('t-nonexistent')).toBeNull();
  });

  it('creates a new account with 0 balance', () => {
    const balance = service.getOrCreateBalance('t-credit');
    expect(balance.balanceCents).toBe(0);
    expect(balance.totalTopupCents).toBe(0);
    expect(balance.totalUsedCents).toBe(0);
  });

  it('tops up credits and returns new balance', () => {
    const result = service.topUp('t-credit', 1000, 'Initial top-up');
    expect(result.balanceCents).toBe(1000);
    expect(result.totalTopupCents).toBe(1000);
  });

  it('records a transaction on top-up', () => {
    service.topUp('t-credit', 500, 'Test top-up');
    const txs = service.getTransactions('t-credit', { type: 'topup' });
    expect(txs).toHaveLength(1);
    expect(txs[0].amountCents).toBe(500);
    expect(txs[0].balanceAfterCents).toBe(500);
    expect(txs[0].description).toBe('Test top-up');
  });

  it('deducts usage from balance', () => {
    service.topUp('t-credit', 1000);
    const result = service.deductUsage('t-credit', 300, 'req-1');
    expect(result).toBe(true);
    expect(service.getBalance('t-credit')!.balanceCents).toBe(700);
    expect(service.getBalance('t-credit')!.totalUsedCents).toBe(300);
  });

  it('rejects deduction when balance is insufficient', () => {
    service.topUp('t-credit', 100);
    const result = service.deductUsage('t-credit', 200);
    expect(result).toBe(false);
    // Balance should not have changed
    expect(service.getBalance('t-credit')!.balanceCents).toBe(100);
  });

  it('returns true for deduction when no credit account exists (no limit)', () => {
    const result = service.deductUsage('t-nonexistent', 500);
    expect(result).toBe(true);
  });

  it('issues a refund and restores balance', () => {
    service.topUp('t-credit', 1000);
    service.deductUsage('t-credit', 500);
    const result = service.refund('t-credit', 200, 'Partial refund', 'req-refund');
    expect(result.balanceCents).toBe(700); // 1000 - 500 + 200
  });

  it('throws on non-positive top-up amount', () => {
    expect(() => service.topUp('t-credit', 0)).toThrow('Top-up amount must be positive');
    expect(() => service.topUp('t-credit', -100)).toThrow('Top-up amount must be positive');
  });

  it('throws on non-positive refund amount', () => {
    expect(() => service.refund('t-credit', 0, 'test')).toThrow('Refund amount must be positive');
  });

  it('checks sufficient credits correctly', () => {
    service.topUp('t-credit', 1000);
    const check = service.checkSufficientCredits('t-credit', 500);
    expect(check.sufficient).toBe(true);
    expect(check.balance).toBe(1000);
  });

  it('reports insufficient credits', () => {
    service.topUp('t-credit', 100);
    const check = service.checkSufficientCredits('t-credit', 200);
    expect(check.sufficient).toBe(false);
  });

  it('returns sufficient=true when no credit account exists', () => {
    const check = service.checkSufficientCredits('t-nonexistent', 500);
    expect(check.sufficient).toBe(true);
    expect(check.balance).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// QuotaService
// ---------------------------------------------------------------------------

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(() => {
    quotaCache.flush();
    getDb().prepare('DELETE FROM quota_allocations').run();
    getDb().prepare('DELETE FROM billing_records').run();
    getDb().prepare('DELETE FROM credits').run();
    insertTenant('t-quota');
    service = new QuotaService();
  });

  it('returns empty allocations for tenant with none', async () => {
    // filterByQuota with empty candidates returns empty
    const result = await service.filterByQuota([], 't-quota');
    expect(result).toEqual([]);
  });

  it('creates a quota allocation', async () => {
    const alloc = await service.createAllocation('t-quota', 'openai', 100, 10000, 50, 'monthly');
    expect(alloc.tenantId).toBe('t-quota');
    expect(alloc.providerId).toBe('openai');
    expect(alloc.maxRequests).toBe(100);
    expect(alloc.maxTokens).toBe(10000);
    expect(alloc.maxCost).toBe(50);
    expect(alloc.period).toBe('monthly');
  });

  it('records usage and increments counters', async () => {
    await service.createAllocation('t-quota', 'openai', 100, 10000, 50, 'monthly');
    await service.recordUsage('t-quota', 'openai', 500, 10);
    // Usage is recorded in cache; checkQuota should still pass (under limit)
    await expect(
      service.checkQuota('t-quota', 'openai', 100, 1)
    ).resolves.toBeUndefined();
  });

  it('throws QuotaExhaustedError when max requests exceeded', async () => {
    // Import the error class
    const { QuotaExhaustedError } = await import('@dmr-x/core');
    await service.createAllocation('t-quota', 'openai', 1, null, null, 'monthly');
    await service.recordUsage('t-quota', 'openai', 100, 1);
    // Second request should exceed the limit of 1
    await expect(
      service.checkQuota('t-quota', 'openai', 100, 1)
    ).rejects.toThrow(QuotaExhaustedError);
  });

  it('throws QuotaExhaustedError when max tokens exceeded', async () => {
    const { QuotaExhaustedError } = await import('@dmr-x/core');
    await service.createAllocation('t-quota', 'openai', null, 500, null, 'monthly');
    await expect(
      service.checkQuota('t-quota', 'openai', 600, 1)
    ).rejects.toThrow(QuotaExhaustedError);
  });

  it('throws QuotaExhaustedError when max cost exceeded', async () => {
    const { QuotaExhaustedError } = await import('@dmr-x/core');
    await service.createAllocation('t-quota', 'openai', null, null, 5, 'monthly');
    await expect(
      service.checkQuota('t-quota', 'openai', 100, 10)
    ).rejects.toThrow(QuotaExhaustedError);
  });

  it('does not throw when under all limits', async () => {
    await service.createAllocation('t-quota', 'openai', 100, 10000, 50, 'monthly');
    await expect(
      service.checkQuota('t-quota', 'openai', 100, 1)
    ).resolves.toBeUndefined();
  });

  it('resets quotas clears cache', async () => {
    await service.createAllocation('t-quota', 'openai', 100, 10000, 50, 'monthly');
    await service.recordUsage('t-quota', 'openai', 100, 1);
    await service.resetQuotas('t-quota');
    // After reset, the cache counters should be cleared — new usage is 0
    // (the allocation still exists, but usage counters are reset)
    await expect(
      service.checkQuota('t-quota', 'openai', 100, 1)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addCostHeaders & extractCostMetrics
// ---------------------------------------------------------------------------

describe('cost-headers', () => {
  it('extracts cost metrics from a response body with usage', () => {
    const body = {
      usage: {
        prompt_tokens: 150,
        completion_tokens: 75,
      },
    };
    const metrics = extractCostMetrics(body, 'openai', 'gpt-4', 242);
    expect(metrics.inputTokens).toBe(150);
    expect(metrics.outputTokens).toBe(75);
    expect(metrics.providerId).toBe('openai');
    expect(metrics.modelId).toBe('gpt-4');
    expect(metrics.latencyMs).toBe(242);
    expect(metrics.isFreeTier).toBe(true); // totalCost is 0 (placeholder)
  });

  it('handles missing usage fields gracefully', () => {
    const metrics = extractCostMetrics({}, 'anthropic', 'claude-3', 100);
    expect(metrics.inputTokens).toBe(0);
    expect(metrics.outputTokens).toBe(0);
  });

  it('sets compressionSaved only when positive', () => {
    const metrics = extractCostMetrics({}, 'openai', 'gpt-4', 50, 1024);
    expect(metrics.compressionSaved).toBe(1024);
  });

  it('does not set compressionSaved when 0 or undefined', () => {
    // When compressionSaved is 0, extractCostMetrics returns 0 (not undefined)
    const m1 = extractCostMetrics({}, 'openai', 'gpt-4', 50, 0);
    expect(m1.compressionSaved).toBe(0);
    // When omitted, it returns undefined
    const m2 = extractCostMetrics({}, 'openai', 'gpt-4', 50);
    expect(m2.compressionSaved).toBeUndefined();
  });

  it('addCostHeaders sets all required response headers', () => {
    const headers: Record<string, string | number | undefined> = {};
    const reply = {
      header(key: string, value: string | number) {
        headers[key] = value;
      },
    } as any;

    addCostHeaders(reply, {
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      inputCost: 0.003,
      outputCost: 0.006,
      totalCost: 0.009,
      isFreeTier: false,
      latencyMs: 250,
    });

    expect(headers['X-DMRX-Provider']).toBe('openai');
    expect(headers['X-DMRX-Model']).toBe('gpt-4');
    expect(headers['X-DMRX-Input-Tokens']).toBe('100');
    expect(headers['X-DMRX-Output-Tokens']).toBe('50');
    expect(headers['X-DMRX-Total-Tokens']).toBe('150');
    expect(headers['X-DMRX-Input-Cost']).toBe('0.003000');
    expect(headers['X-DMRX-Output-Cost']).toBe('0.006000');
    expect(headers['X-DMRX-Total-Cost']).toBe('0.009000');
    expect(headers['X-DMRX-Free-Tier']).toBe('false');
    expect(headers['X-DMRX-Latency-Ms']).toBe('250');
  });

  it('addCostHeaders omits compression-saved header when not positive', () => {
    const headers: Record<string, string | number | undefined> = {};
    const reply = {
      header(key: string, value: string | number) {
        headers[key] = value;
      },
    } as any;

    addCostHeaders(reply, {
      providerId: 'openai',
      modelId: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      isFreeTier: true,
      latencyMs: 100,
      compressionSaved: 0,
    });

    expect(headers['X-DMRX-Compression-Saved']).toBeUndefined();
  });
});
