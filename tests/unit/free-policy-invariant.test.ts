import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../services/router/src/pipeline/pipeline.js';
import { EligibilityEngine } from '../../services/router/src/eligibility/eligibility-engine.js';
import type { CandidateSet } from '@dmr-x/core';

describe('Free Policy Invariant', () => {
  it('free_only produces zero paid selections', async () => {
    const candidates: CandidateSet = [
      { providerId: 'p1', providerName: 'p1', modelId: 'm1', modality: 'llm', capabilities: [], intelligenceLayer: 'executor', capabilityTier: 'executor', costPerInputToken: 0, costPerOutputToken: 0, costPerImage: 0, avgLatencyMs: 1000, pricingTier: 'free', qualityScore: 0.9, isHealthy: true } as any,
      { providerId: 'p2', providerName: 'p2', modelId: 'm2', modality: 'llm', capabilities: [], intelligenceLayer: 'executor', capabilityTier: 'executor', costPerInputToken: 0.001, costPerOutputToken: 0.002, costPerImage: 0, avgLatencyMs: 1000, pricingTier: 'paid', qualityScore: 0.95, isHealthy: true } as any,
      { providerId: 'p3', providerName: 'p3', modelId: 'm3', modality: 'llm', capabilities: [], intelligenceLayer: 'executor', capabilityTier: 'executor', costPerInputToken: 0, costPerOutputToken: 0, costPerImage: 0, avgLatencyMs: 1000, pricingTier: 'free_with_limits', qualityScore: 0.8, isHealthy: true } as any,
    ];

    const eligibility = new EligibilityEngine({ freeOnly: true });
    const result = await runPipeline({
      taskProfile: { modality: 'llm', capabilities: [], sizeEstimate: { inputTokens: 100, outputTokensEst: 500 }, priority: 5, streaming: false, qualityTarget: 'balanced' },
      candidates,
      eligibilityEngine: eligibility,
      epsilon: 0,
    });

    // The selected provider must be free
    const selectedIsFree = result.scoredCandidates.find(
      c => c.providerId === result.selected.providerId && c.modelId === result.selected.modelId
    );
    expect(selectedIsFree).toBeDefined();
    expect(selectedIsFree!.pricingTier).toMatch(/free/);

    // No paid candidates in the fallback chain
    for (const step of result.chain) {
      const chainCandidate = result.scoredCandidates.find(
        c => c.providerId === step.provider.providerId && c.modelId === step.provider.modelId
      );
      expect(chainCandidate?.pricingTier).not.toBe('paid');
    }
  });
});