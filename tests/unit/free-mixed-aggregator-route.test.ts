import { describe, expect, it } from 'vitest';
import type { CandidateSet, UnifiedRequest } from '@dmr-x/core';
import { Router } from '../../services/router/src/router.service.js';

const candidate = (providerName: string, modelId: string, overrides = {}): CandidateSet[number] => ({
  providerId: providerName,
  providerName,
  modelId,
  modality: 'llm',
  intelligenceLayer: 'executor',
  capabilityTier: 'executor',
  capabilities: ['streaming'],
  costPerInputToken: 0,
  costPerOutputToken: 0,
  avgLatencyMs: 1000,
  qualityScore: 0.9,
  isHealthy: true,
  ...overrides,
} as CandidateSet[number]);

const candidates: CandidateSet = [
  candidate('tokenrouter', 'mistralai/mistral-small-2603'),
  candidate('opencode-zen', 'claude-opus-4-8'),
  candidate('tokenrouter', 'qwen/qwen3.8-max-free'),
  candidate('google_native', 'gemini-3-flash-preview', { pricingTier: 'free_with_limits' }),
];
const opts = { path: '/v1/chat/completions', qualityTarget: 'balanced' as const, planOnly: true };

function plan(model: string, costFilter: 'free' | 'all') {
  const router = new Router({ enableDecomposition: false });
  router.setCandidates(candidates);
  router.setAdapterExecutor({ execute: async () => { throw new Error('planOnly must not execute'); } });
  const request: UnifiedRequest = {
    model, modality: 'llm', stream: false,
    messages: [{ role: 'user', content: 'Plan a one-line reply' }],
    metadata: { costFilter },
  };
  return router.route(request, opts);
}

describe('free-only boundary for mixed aggregators', () => {
  it('does not rank unmarked zero-priced aggregator models in a free meta-model', async () => {
    const result = await plan('auto', 'free');
    const selected = [result.plan.primary, ...result.plan.chain.map(step => step.provider)];
    expect(selected.map(item => item.modelId)).not.toContain('mistralai/mistral-small-2603');
    expect(selected.map(item => item.modelId)).not.toContain('claude-opus-4-8');
    expect(selected.length).toBeGreaterThan(0);
  });

  it.each(['tokenrouter/mistralai/mistral-small-2603', 'opencode-zen/claude-opus-4-8'])(
    'rejects a directly pinned unmarked model under costFilter free: %s', async (model) => {
      await expect(plan(model, 'free')).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
    },
  );

  it('keeps explicitly free pinned models and unrestricted paid pins available', async () => {
    expect((await plan('tokenrouter/qwen/qwen3.8-max-free', 'free')).plan.primary.modelId)
      .toBe('qwen/qwen3.8-max-free');
    expect((await plan('tokenrouter/mistralai/mistral-small-2603', 'all')).plan.primary.modelId)
      .toBe('mistralai/mistral-small-2603');
  });
});
