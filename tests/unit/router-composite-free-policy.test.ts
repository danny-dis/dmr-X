import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { describe, expect, it } from 'vitest';

import { Router } from '../../services/router/src/router.service.js';

const free: CandidateSet[0] = {
  providerId: 'free-provider', providerName: 'free-provider', modelId: 'free-model',
  modality: 'llm', intelligenceLayer: 'executor', capabilityTier: 'executor',
  capabilities: ['tool_use'], contextLength: 128000,
  costPerInputToken: 0, costPerOutputToken: 0, costPerImage: 0,
  avgLatencyMs: 100, qualityScore: 0.7, isHealthy: true, pricingTier: 'free',
};
const paid: CandidateSet[0] = {
  ...free, providerId: 'paid-provider', providerName: 'paid-provider',
  modelId: 'paid-model', pricingTier: 'paid', qualityScore: 0.99,
};

function failedComposite(): {
  aggregatedResponse: UnifiedResponse;
  subTaskResults: Map<string, { success: boolean }>;
  modelAssignments: Map<string, string>;
} {
  return {
    aggregatedResponse: {
      modality: 'llm', requestId: 'test', providerId: 'free-provider',
      modelId: 'free-model', latencyMs: 1,
      message: { role: 'assistant', content: '' },
    },
    subTaskResults: new Map([['task', { success: false }]]),
    modelAssignments: new Map(),
  };
}

describe('router effective cost policy', () => {
  it('honors a free default, an explicit all override, and an intrinsic free alias', () => {
    const router = new Router({ metaModelCostFilter: 'free' });
    expect(router.getEffectiveCostFilter('auto')).toBe('free');
    expect(router.getEffectiveCostFilter('auto', 'all')).toBe('all');
    expect(router.getEffectiveCostFilter('free', 'all')).toBe('free');
  });
});

describe('composite free-only fallback', () => {
  it('never puts an explicitly paid candidate in a free-only single-pass plan', async () => {
    const router = new Router({ enableDecomposition: true, decompositionThreshold: 1 });
    router.setCandidates([free, paid]);
    const calls: string[] = [];
    router.setAdapterExecutor({
      execute: async (providerId, modelId): Promise<UnifiedResponse> => {
        calls.push(providerId);
        return {
          modality: 'llm', requestId: 'test', providerId, modelId, latencyMs: 1,
          message: { role: 'assistant', content: 'recovered' },
        };
      },
    });
    (router as any).compositeExecutor.execute = async () => failedComposite();
    const request: UnifiedRequest = {
      modality: 'llm', model: 'free', stream: false,
      messages: [{ role: 'user', content: 'Build a frontend and backend service' }],
      metadata: {},
    };
    const { plan } = await router.route(request, { path: '/v1/chat/completions' });
    expect(plan.primary.providerId).toBe('free-provider');
    expect(plan.chain.map((step) => step.provider.providerId)).not.toContain('paid-provider');
    expect(calls).toEqual(['free-provider']);
  });
});
