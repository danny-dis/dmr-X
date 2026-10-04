import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProviderModel } from '@dmr-x/core';
import { SpecialistRouter } from '../../services/router/src/decomposer/specialist-router.js';
import { inferPricingTier } from '../../packages/provider-catalog/src/index.js';
import { buildDimension, buildVector } from '../../services/quota/src/quota-vector.js';
import { CapacityManager, InMemoryCapacityStore } from '../../services/quota/src/capacity-manager.js';

const candidate = (modelId: string): ProviderModel => ({
  providerId: 'tokenrouter', providerName: 'tokenrouter', modelId,
  modality: 'llm', intelligenceLayer: 'executor', capabilities: ['general'],
  pricingTier: 'free_with_limits', costPerInputToken: 0, costPerOutputToken: 0,
  avgLatencyMs: 10, qualityScore: 1, isHealthy: true,
} as ProviderModel);
const task = { id: 'coding', modality: 'llm', priority: 1, specializations: [], description: 'write code' };
const dimension = (scope: 'account' | 'key', scopeId: string, remaining = 1) => buildDimension({
  unit: 'requests', scope, scopeId, limit: remaining, remaining,
  state: 'available', replenishment: 'fixed_window', resetAtMs: Date.now() + 60_000,
});
const manager = () => new CapacityManager({
  store: new InMemoryCapacityStore(),
  estimateDemand: () => ({ requests: 1, inputTokens: 0, outputTokens: 0, concurrency: 0 }),
});

describe('Final routing review regressions', () => {
  it('does not execute an unmarked mixed-aggregator specialist under free_only', () => {
    const router = new SpecialistRouter();
    expect(router.routeAllSubTasks([task as never], [candidate('paid-unmarked')], 'balanced', 'free_only').size).toBe(0);
  });
  it('preserves explicitly free mixed-aggregator specialists', () => {
    const router = new SpecialistRouter();
    expect(router.routeAllSubTasks([task as never], [candidate('model:free')], 'balanced', 'free_only').get('coding')?.modelId).toBe('model:free');
  });
  it('does not classify payment-method-required trials as strictly free', () => {
    expect(inferPricingTier({ freeTier: { offerKind: 'trial', trialDays: 5, requiresPaymentMethod: true } } as never)).toBe('paid');
  });
  it('preserves a no-card trial as a limited free offer', () => {
    expect(inferPricingTier({ freeTier: { offerKind: 'trial', trialDays: 5, requiresPaymentMethod: false } } as never)).toBe('free_with_limits');
  });
  it('constructs account pool identity independently of credentials', () => {
    const a = buildVector({ providerId: 'p', modelId: 'm', keyId: 'key-a', dimensions: [dimension('account', 'org-one')] });
    const b = buildVector({ providerId: 'p', modelId: 'm', keyId: 'key-b', dimensions: [dimension('account', 'org-one')] });
    expect(a.poolId).toBe('p::account::org-one');
    expect(b.poolId).toBe(a.poolId);
  });
  it('normalizes raw registered vectors so credentials share one account hold', async () => {
    const capacity = manager();
    for (const keyId of ['key-a', 'key-b']) capacity.registerVector({
      providerId: 'p', modelId: 'm', keyId,
      dimensions: [dimension('account', 'org-one')], lastObservedAtMs: Date.now(),
    });
    const first = await capacity.reserve('p', 'm', 'key-a', {});
    const second = await capacity.reserve('p', 'm', 'key-b', {});
    expect(first.success).toBe(true);
    expect(first.reservation?.dimensions[0].scopeId).toBe('p::account::org-one');
    expect(second.success).toBe(false);
  });
  it('does not share capacity across unrelated providers with the same scope label', async () => {
    const capacity = manager();
    for (const providerId of ['provider-a', 'provider-b']) capacity.registerVector({
      providerId, modelId: 'm', keyId: 'key',
      dimensions: [dimension('account', 'default')], lastObservedAtMs: Date.now(),
    });
    expect((await capacity.reserve('provider-a', 'm', 'key', {})).success).toBe(true);
    expect((await capacity.reserve('provider-b', 'm', 'key', {})).success).toBe(true);
  });
  it('preserves independent account and key constraints in one vector', async () => {
    const capacity = manager();
    for (const keyId of ['key-a', 'key-b']) capacity.registerVector({
      providerId: 'p', modelId: 'm', keyId,
      dimensions: [dimension('account', 'org-one', 2), dimension('key', keyId)],
      lastObservedAtMs: Date.now(),
    });
    const first = await capacity.reserve('p', 'm', 'key-a', {});
    expect(first.success).toBe(true);
    expect(first.reservation?.dimensions.map(d => d.scopeId)).toEqual(['p::account::org-one', 'p::key::key-a']);
    expect((await capacity.reserve('p', 'm', 'key-b', {})).success).toBe(true);
    expect((await capacity.reserve('p', 'm', 'key-a', {})).success).toBe(false);
  });
  it('loads the quota vector module in Bun without exporting erased TypeScript types', () => {
    const modulePath = fileURLToPath(new URL('../../services/quota/src/quota-vector.ts', import.meta.url));
    const result = spawnSync('bun', ['--no-env-file', '-e', `import(${JSON.stringify(modulePath.replaceAll('\\', '/'))}).then(m => console.log(typeof m.buildVector))`], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('function');
  });
});
