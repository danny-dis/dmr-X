import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { describe, expect, it, vi } from 'vitest';
import { Router } from '../../services/router/src/router.service.js';
import { InferenceSettlementError } from '../../services/router/src/inference-accounting.js';

const candidate = (providerId: string, providerName: string, modelId: string, pricingTier: 'free' | 'paid'): CandidateSet[0] => ({
  providerId, providerName, modelId, modality: 'llm', intelligenceLayer: 'executor', capabilityTier: 'executor',
  capabilities: ['tool_use'], contextLength: 128000, costPerInputToken: pricingTier === 'free' ? 0 : 0.001,
  costPerOutputToken: pricingTier === 'free' ? 0 : 0.002, avgLatencyMs: 100, qualityScore: 0.7,
  isHealthy: true, pricingTier,
});

describe('composite single-pass fallback policy', () => {
  it('surfaces single-pass settlement failure instead of returning empty success', async () => {
    const error = new InferenceSettlementError(new Error('ledger unavailable'));
    const execute = vi.fn().mockRejectedValue(error);
    const router = new Router({ enableDecomposition: true, decompositionThreshold: 1, freeTierStrategy: 'free_only' });
    router.setCandidates([candidate('native-free-id', 'native-free-adapter', 'free-model', 'free')]);
    router.setAdapterExecutor({ execute });
    (router as any).compositeExecutor.execute = async () => ({
      aggregatedResponse: { modality: 'llm', requestId: 'settlement-composite', message: { role: 'assistant', content: '' } },
      subTaskResults: new Map([['task', { success: false }]]), modelAssignments: new Map(),
    });
    await expect(router.route({
      modality: 'llm', model: 'auto', messages: [{ role: 'user', content: 'Build a frontend and backend service' }], metadata: {},
    }, { requestId: 'settlement-composite' })).rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('uses configured strict-free policy and native adapter identity for an empty-metadata request', async () => {
    const router = new Router({ enableDecomposition: true, decompositionThreshold: 1, freeTierStrategy: 'free_only' });
    router.setCandidates([
      candidate('native-free-id', 'native-free-adapter', 'free-model', 'free'),
      candidate('paid-id', 'paid-adapter', 'paid-model', 'paid'),
    ]);
    const calls: string[] = [];
    router.setAdapterExecutor({ execute: async (providerId, modelId): Promise<UnifiedResponse> => {
      calls.push(providerId);
      return { modality: 'llm', requestId: 'composite-policy', providerId, modelId, latencyMs: 1, message: { role: 'assistant', content: 'recovered' } };
    } });
    (router as any).compositeExecutor.execute = async () => ({
      aggregatedResponse: { modality: 'llm', requestId: 'composite-policy', providerId: 'native-free-id', modelId: 'free-model', latencyMs: 1, message: { role: 'assistant', content: '' } },
      subTaskResults: new Map([['task', { success: false }]]), modelAssignments: new Map(),
    });
    const request: UnifiedRequest = {
      modality: 'llm', model: 'auto', stream: false,
      messages: [{ role: 'user', content: 'Build a frontend and backend service' }], metadata: {},
    };

    const { plan } = await router.route(request, { path: '/v1/chat/completions', requestId: 'composite-policy' });

    expect(calls).toEqual(['native-free-id']);
    expect(plan.primary).toMatchObject({ providerId: 'native-free-id', modelId: 'free-model', adapterType: 'native-free-adapter' });
    expect(plan.chain.every((step) => step.provider.providerId !== 'paid-id')).toBe(true);
    expect(plan.chain.every((step) => step.provider.adapterType === 'native-free-adapter')).toBe(true);
  });

  it('passes fallback quota, tenant, request, and callback policy into the actual fallback boundary', async () => {
    const onProviderSuccess = vi.fn();
    const checkQuota = vi.fn();
    const router = new Router({
      enableDecomposition: true, decompositionThreshold: 1, onProviderSuccess,
      quotaService: { checkQuota, recordUsage: vi.fn(), recordProviderBudgetUsage: vi.fn() } as any,
    });
    router.setCandidates([candidate('free-id', 'native-adapter', 'free-model', 'free')]);
    router.setAdapterExecutor({ execute: async (providerId, modelId): Promise<UnifiedResponse> => ({
      modality: 'llm', requestId: 'fallback-options', providerId, modelId, latencyMs: 1, message: { role: 'assistant', content: 'recovered' },
    }) });
    (router as any).compositeExecutor.execute = async () => ({
      aggregatedResponse: { modality: 'llm', requestId: 'fallback-options', providerId: 'free-id', modelId: 'free-model', latencyMs: 1, message: { role: 'assistant', content: '' } },
      subTaskResults: new Map([['task', { success: false }]]), modelAssignments: new Map(),
    });
    const request: UnifiedRequest = {
      modality: 'llm', model: 'free', stream: false,
      messages: [{ role: 'user', content: 'Build a frontend and backend service' }],
      metadata: { tenant: { id: 'tenant-7' } },
    };

    await router.route(request, { path: '/v1/chat/completions', requestId: 'fallback-options' });

    expect(checkQuota).toHaveBeenCalledWith('tenant-7', 'free-id', 0, 0);
    expect(onProviderSuccess).toHaveBeenCalledWith('free-id');
  });
});
