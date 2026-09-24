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

  const retryCandidates: CandidateSet = [
    { providerId: 'free', providerName: 'free', modelId: 'free-model', modality: 'llm', capabilities: [], intelligenceLayer: 'executor', capabilityTier: 'executor', costPerInputToken: 0, costPerOutputToken: 0, avgLatencyMs: 1000, pricingTier: 'free', qualityScore: 0.5, isHealthy: true } as any,
    { providerId: 'paid', providerName: 'paid', modelId: 'paid-model', modality: 'llm', capabilities: [], intelligenceLayer: 'executor', capabilityTier: 'executor', costPerInputToken: 0.001, costPerOutputToken: 0.002, avgLatencyMs: 1000, pricingTier: 'paid', qualityScore: 0.99, isHealthy: true } as any,
  ];

  function retryLimiter(recoveringModels: string[]) {
    const attempts = new Map<string, number>();
    return {
      isOnCooldown: () => false,
      getCooldownExpiry: () => null,
      checkLimit: (_providerId: string, modelId: string) => {
        const count = (attempts.get(modelId) ?? 0) + 1;
        attempts.set(modelId, count);
        return count > 1 && recoveringModels.includes(modelId)
          ? { allowed: true }
          : { allowed: false, retryAfterMs: 1, reason: 'RPM exhausted' };
      },
      getPenaltyPoints: () => 0,
      getState: () => ({ config: { rpm: 10 }, currentRPM: 0, currentRPD: 0, currentTPM: 0, currentTPD: 0, penaltyPoints: 0 }),
    };
  }

  const taskProfile = { modality: 'llm', capabilities: [], sizeEstimate: { inputTokens: 100, outputTokensEst: 500 }, priority: 5, streaming: false, qualityTarget: 'balanced' } as const;

  it('does not restore paid candidates to a free-only fallback chain after rate-limit wait', async () => {
    const result = await runPipeline({
      taskProfile: taskProfile as any,
      candidates: retryCandidates,
      eligibilityEngine: new EligibilityEngine({ freeOnly: true }),
      rateLimitService: retryLimiter(['free-model', 'paid-model']) as any,
      epsilon: 0,
      maxWaitMs: 10,
    });
    expect(result.selected.providerId).toBe('free');
    expect(result.scoredCandidates.every(candidate => candidate.pricingTier !== 'paid')).toBe(true);
    expect(result.chain.every(step => step.provider.providerId !== 'paid')).toBe(true);
  });

  it('fails rather than select a paid candidate when only paid capacity recovers', async () => {
    await expect(runPipeline({
      taskProfile: taskProfile as any,
      candidates: retryCandidates,
      eligibilityEngine: new EligibilityEngine({ freeOnly: true }),
      rateLimitService: retryLimiter(['paid-model']) as any,
      epsilon: 0,
      maxWaitMs: 10,
    })).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
  });
});