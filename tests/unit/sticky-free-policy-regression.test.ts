import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@dmr-x/core';
import { handleStickySession } from '../../services/router/src/sticky-session-handler.js';
import { InferenceSettlementError } from '../../services/router/src/inference-accounting.js';
import { resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

// The actual getter only applies its free predicate for `prioritize`, not
// `free_only`: the handler must enforce strict policy at its own boundary.
vi.mock('../../services/router/src/sticky/sticky-session.js', () => ({
  getStickyProvider: vi.fn(async () => ({ providerId: 'pinned', modelId: 'same-model' })),
  breakStickySession: vi.fn().mockResolvedValue(undefined),
}));

const candidate = (providerId: string, pricingTier: 'free' | 'paid') => ({
  providerId, providerName: providerId, modelId: 'same-model', isHealthy: true,
  qualityScore: 0.8, modality: 'llm', capabilities: ['chat'],
  pricingTier, costPerInputToken: pricingTier === 'free' ? 0 : 0.001,
  costPerOutputToken: pricingTier === 'free' ? 0 : 0.002,
});
const response = (providerId: string) => ({
  modality: 'llm', providerId, modelId: 'same-model', requestId: 'test',
  message: { role: 'assistant', content: 'answer' }, finishReason: 'stop',
});
const rateLimits = () => ({
  checkLimit: vi.fn().mockReturnValue({ allowed: true }),
  getPenaltyPoints: vi.fn().mockReturnValue(0), recordUsage: vi.fn(),
  acquireConcurrencySlot: vi.fn(), releaseConcurrencySlot: vi.fn(),
});

beforeEach(() => resetModelErrorCache());

describe('sticky strict free policy', () => {
  it.each([false, true])('propagates settlement failure without re-routing or breaking the healthy pin with rate limits=%s', async (withRateLimit) => {
    const error = new InferenceSettlementError(new Error('ledger temporarily unavailable'));
    const execute = vi.fn().mockRejectedValue(error);
    await expect(handleStickySession({
      request: { modality: 'llm', model: 'auto', metadata: {} } as any,
      options: {}, candidates: [candidate('pinned', 'free')] as any,
      adapterExecutor: { execute },
      config: { enablePlanner: false, freeTierStrategy: 'free_only', rateLimitService: withRateLimit ? rateLimits() : undefined } as any,
      thompsonSampler: {} as any, router: {} as any,
      conversationHash: `settlement-pin-${withRateLimit}`, modelTarget: { modelId: 'auto' },
    })).rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('excludes paid same-model fallback with rate-limit service=%s', async (withRateLimit) => {
    const execute = vi.fn(async (providerId: string) => {
      if (providerId === 'pinned') throw new ProviderError('primary unavailable', providerId, 500);
      return response(providerId);
    });
    const result = await handleStickySession({
      request: { modality: 'llm', model: 'auto', messages: [{ role: 'user', content: 'Hello' }], metadata: {} } as any,
      options: {}, candidates: [candidate('pinned', 'free'), candidate('paid-alternate', 'paid')] as any,
      adapterExecutor: { execute } as any,
      config: { enablePlanner: false, freeTierStrategy: 'free_only', rateLimitService: withRateLimit ? rateLimits() : undefined } as any,
      thompsonSampler: {} as any, router: {} as any,
      conversationHash: `strict-free-${withRateLimit}`, modelTarget: { modelId: 'auto' },
    });
    expect(result.used).toBe(false);
    expect(execute.mock.calls.map(([providerId]) => providerId)).toEqual(['pinned']);
  });

  it.each([
    { model: 'auto', freeTierStrategy: 'free_only', costFilter: 'all' },
    { model: 'auto-eco', freeTierStrategy: 'none', costFilter: 'free' },
  ])('rejects a paid pin under effective policy for $model', async ({ model, freeTierStrategy, costFilter }) => {
    const execute = vi.fn().mockResolvedValue(response('pinned'));
    const result = await handleStickySession({
      request: { modality: 'llm', model, metadata: {} } as any,
      options: {}, candidates: [candidate('pinned', 'paid')] as any,
      adapterExecutor: { execute },
      config: { enablePlanner: false, freeTierStrategy } as any,
      thompsonSampler: {} as any,
      router: { getEffectiveCostFilter: () => costFilter } as any,
      conversationHash: `paid-pin-${model}`, modelTarget: { modelId: model },
    });
    expect(result.used).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('permits a paid pin when paid routing is explicitly allowed', async () => {
    const execute = vi.fn().mockResolvedValue(response('pinned'));
    const result = await handleStickySession({
      request: { modality: 'llm', model: 'auto', metadata: { costFilter: 'all' } } as any,
      options: {}, candidates: [candidate('pinned', 'paid')] as any,
      adapterExecutor: { execute },
      config: { enablePlanner: false, freeTierStrategy: 'none', metaModelCostFilter: 'all' } as any,
      thompsonSampler: {} as any, router: { getEffectiveCostFilter: () => 'all' } as any,
      conversationHash: 'paid-pin-allowed', modelTarget: { modelId: 'auto' },
    });
    expect(result.used).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
