import { describe, it, expect } from 'vitest';
import { Router } from '../../services/router/src/router.service.js';
import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
    capabilities: [],
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    isHealthy: true,
    ...overrides,
  };
}

interface ExecCall {
  providerId: string;
  modelId: string;
  requestModel?: string;
}

function makeRouter(candidates: CandidateSet) {
  const router = new Router({ enableDecomposition: false });
  router.setCandidates(candidates);
  const calls: ExecCall[] = [];
  router.setAdapterExecutor({
    execute: async (providerId: string, modelId: string, request: UnifiedRequest): Promise<UnifiedResponse> => {
      calls.push({ providerId, modelId, requestModel: request.model });
      return {
        modality: 'llm',
        requestId: 'test',
        providerId,
        modelId,
        message: { role: 'assistant', content: 'ok' },
        latencyMs: 1,
      };
    },
  });
  return { router, calls };
}

function makeRequest(model: string): UnifiedRequest {
  return {
    modality: 'llm',
    model,
    // Unique content per test keeps the sticky-session hash distinct.
    messages: [{ role: 'user', content: `prompt-${model}-${Math.random()}` }] as any,
  };
}

const ROUTE_OPTS = { path: '/v1/chat/completions', qualityTarget: 'balanced' as const };

describe('router provider-prefix routing', () => {
  it('routes "providerName/modelId" to the pinned provider, not the highest-scoring one', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.4 }),
      makeCandidate({ providerId: 'goog-uuid', providerName: 'google', modelId: 'gemini-3.5-flash', qualityScore: 0.99 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('pollinations/openai-fast'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('poll-uuid');
    expect(plan.primary.modelId).toBe('openai-fast');
    expect(calls).toHaveLength(1);
    // The executor must receive the bare resolved model, not the prefixed string.
    expect(calls[0].providerId).toBe('poll-uuid');
    expect(calls[0].modelId).toBe('openai-fast');
  });

  it('keeps slashes inside the model id after stripping a known provider prefix', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen/qwen3-coder', qualityScore: 0.5 }),
      makeCandidate({ providerId: 'goog-uuid', providerName: 'google', modelId: 'gemini-3.5-flash', qualityScore: 0.99 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('openrouter-free/qwen/qwen3-coder'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('or-uuid');
    expect(plan.primary.modelId).toBe('qwen/qwen3-coder');
    expect(calls[0].modelId).toBe('qwen/qwen3-coder');
  });

  it('treats an unknown prefix as part of the model id (e.g. OpenRouter vendor slug)', async () => {
    const candidates: CandidateSet = [
      // "qwen" is NOT a provider name here; the full "qwen/qwen3-coder" is the model id.
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter', modelId: 'qwen/qwen3-coder', qualityScore: 0.5 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('qwen/qwen3-coder'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('or-uuid');
    expect(plan.primary.modelId).toBe('qwen/qwen3-coder');
    expect(calls[0].modelId).toBe('qwen/qwen3-coder');
  });

  it('passes the resolved real model (not the meta-model alias) to the executor', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.6 }),
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen3-coder', qualityScore: 0.9 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('auto-smart'), ROUTE_OPTS);

    // The specific free model is chosen by the scoring pipeline (epsilon-greedy
    // + Thompson sampling), so assert membership, not an exact pick.
    const realModels = ['openai-fast', 'qwen3-coder'];
    expect(realModels).toContain(plan.primary.modelId);
    expect(calls).toHaveLength(1);
    // The literal alias must NEVER reach the executor as a model id — this is
    // the core of Bug 2: meta-model resolution worked, but the executor used to
    // discard the resolved model and send the alias verbatim.
    expect(calls[0].modelId).not.toBe('auto-smart');
    expect(realModels).toContain(calls[0].modelId);
  });

  it('scopes a meta-model alias to the pinned provider when both are given', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.6 }),
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen3-coder', qualityScore: 0.9 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('pollinations/auto-smart'), ROUTE_OPTS);

    // Even though openrouter-free scores higher, the pin constrains to pollinations.
    expect(plan.primary.providerId).toBe('poll-uuid');
    expect(plan.primary.modelId).toBe('openai-fast');
    expect(calls[0].providerId).toBe('poll-uuid');
    expect(calls[0].modelId).toBe('openai-fast');
  });
});
