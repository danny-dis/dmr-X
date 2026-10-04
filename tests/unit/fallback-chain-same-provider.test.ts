import { describe, expect, it } from 'vitest';
import type { CandidateSet, TaskProfile } from '@dmr-x/core';
import { runPipeline } from '../../services/router/src/pipeline/pipeline.js';

function candidate(providerId: string, modelId: string, qualityScore: number, capabilities = ['json_mode']): CandidateSet[0] {
  return {
    providerId, providerName: providerId, modelId, modality: 'llm',
    intelligenceLayer: 'executor', capabilityTier: 'executor', capabilities,
    pricingTier: 'free', costPerInputToken: 0, costPerOutputToken: 0,
    costPerImage: 0, avgLatencyMs: 1000, qualityScore, isHealthy: true,
  };
}

const taskProfile: TaskProfile = {
  modality: 'llm', capabilities: ['json_mode'],
  sizeEstimate: { inputTokens: 50, outputTokensEst: 80 },
  priority: 5, streaming: false, qualityTarget: 'balanced',
};

describe('free JSON fallback chain', () => {
  it('tries another JSON model on the same provider when no other provider qualifies', async () => {
    const result = await runPipeline({
      taskProfile, epsilon: 0, routingStrategy: 'priority',
      candidates: [candidate('native', 'gemini-a', 0.9), candidate('native', 'gemini-b', 0.8), candidate('other', 'no-json', 0.95, [])],
      providerPreferences: { strategy: 'free' },
    });
    expect(result.chain.map(step => [step.provider.providerId, step.provider.modelId]))
      .toEqual([['native', result.selected.modelId === 'gemini-a' ? 'gemini-b' : 'gemini-a']]);
  });

  it('prioritizes a distinct provider before backfilling same-provider models', async () => {
    const result = await runPipeline({
      taskProfile, epsilon: 0, routingStrategy: 'priority',
      candidates: [candidate('native', 'gemini-a', 0.9), candidate('native', 'gemini-b', 0.8), candidate('other', 'json-other', 0.7)],
      providerPreferences: { strategy: 'free' },
    });
    expect(result.chain[0]?.provider.providerId).toBe('other');
    expect(result.chain.some(step => step.provider.providerId === result.selected.providerId && step.provider.modelId !== result.selected.modelId)).toBe(true);
  });
});
