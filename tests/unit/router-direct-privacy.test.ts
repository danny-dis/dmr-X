import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { describe, expect, it } from 'vitest';

import { Router } from '../../services/router/src/router.service.js';

function candidate(providerId: string, deployment: 'cloud' | 'self_hosted'): CandidateSet[0] {
  return {
    providerId, providerName: providerId, modelId: 'shared-model',
    modality: 'llm', intelligenceLayer: 'executor', capabilityTier: 'executor',
    capabilities: [], costPerInputToken: 0, costPerOutputToken: 0,
    costPerImage: 0, avgLatencyMs: 100, qualityScore: 0.8,
    isHealthy: true, deployment,
  };
}

function request(): UnifiedRequest {
  return {
    model: 'shared-model', modality: 'llm', stream: false,
    messages: [{ role: 'user', content: 'direct model privacy test' }],
    metadata: { providerPreferences: { zdr: true } },
  };
}

function routerWith(candidates: CandidateSet) {
  const router = new Router({ enableDecomposition: false });
  router.setCandidates(candidates);
  const calls: string[] = [];
  router.setAdapterExecutor({
    execute: async (providerId, modelId): Promise<UnifiedResponse> => {
      calls.push(providerId);
      return {
        providerId, modelId, modality: 'llm', requestId: 'test', latencyMs: 1,
        message: { role: 'assistant', content: 'ok' },
      };
    },
  });
  return { router, calls };
}

describe('direct-model hard provider constraints', () => {
  it('rejects a cloud-only direct model when ZDR is required', async () => {
    const { router, calls } = routerWith([candidate('cloud', 'cloud')]);
    await expect(router.route(request(), { path: '/v1/chat/completions' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('routes to a local provider serving the same direct model under ZDR', async () => {
    const { router, calls } = routerWith([
      candidate('cloud', 'cloud'), candidate('local', 'self_hosted'),
    ]);
    const { plan } = await router.route(request(), { path: '/v1/chat/completions' });
    expect(plan.primary.providerId).toBe('local');
    expect(plan.primary.modelId).toBe('shared-model');
    expect(plan.chain.map((step) => step.provider.providerId)).not.toContain('cloud');
    expect(calls).toEqual(['local']);
  });

  it('rejects a direct provider pin that conflicts with ZDR', async () => {
    const { router, calls } = routerWith([
      candidate('cloud', 'cloud'), candidate('local', 'self_hosted'),
    ]);
    const directRequest: UnifiedRequest = {
      ...request(), model: 'general-chat',
      metadata: { providerPreferences: { strategy: 'direct', order: ['cloud'], zdr: true } },
    };
    await expect(router.route(directRequest, { path: '/v1/chat/completions' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
