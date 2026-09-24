import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateSet, UnifiedRequest } from '@dmr-x/core';
import { Router } from '../../services/router/src/router.service.js';

const free: CandidateSet[0] = {
  providerId: 'free-provider', providerName: 'free-provider', modelId: 'free-model',
  modality: 'llm', intelligenceLayer: 'executor', capabilityTier: 'fast',
  capabilities: [], contextLength: 128000,
  costPerInputToken: 0, costPerOutputToken: 0, costPerImage: 0,
  avgLatencyMs: 100, qualityScore: 0.7, isHealthy: true, pricingTier: 'free',
};
const paid: CandidateSet[0] = {
  ...free, providerId: 'paid-provider', providerName: 'paid-provider',
  modelId: 'paid-model', pricingTier: 'paid', qualityScore: 0.99,
};

afterEach(() => { delete process.env.DMRX_RATE_LIMIT_MAX_WAIT_MS; });

describe('exhausted free pool', () => {
  it('returns one reset hint promptly without probing paid models or rechecking a long cooldown', async () => {
    process.env.DMRX_RATE_LIMIT_MAX_WAIT_MS = '150';
    const checked: string[] = [];
    const dispatched: string[] = [];
    const rateLimitService = {
      isOnCooldown: () => false,
      checkLimit: (_providerId: string, modelId: string) => {
        checked.push(modelId);
        return { allowed: false, retryAfterMs: 60_000, reason: 'Free-tier RPM exhausted' };
      },
    };
    const router = new Router({ enableDecomposition: false, rateLimitService: rateLimitService as any });
    router.setCandidates([free, paid]);
    router.setAdapterExecutor({ execute: async (providerId) => { dispatched.push(providerId); throw new Error('unexpected dispatch'); } });
    const request: UnifiedRequest = {
      modality: 'llm', model: 'auto', stream: false,
      messages: [{ role: 'user', content: 'Return JSON' }],
      metadata: { costFilter: 'free' }, response_format: { type: 'json_object' },
    };
    const start = performance.now();
    let failure: any;
    try { await router.route(request, { path: '/v1/chat/completions' }); }
    catch (error) { failure = error; }
    expect(failure?.retryAfter).toBe(60);
    expect(checked).toEqual(['free-model']);
    expect(dispatched).toEqual([]);
    expect(performance.now() - start).toBeLessThan(120);
  });
});
