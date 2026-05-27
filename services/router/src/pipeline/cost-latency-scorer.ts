import type { CandidateSet, QualityTarget } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';

interface Weights {
  quality: number;
  cost: number;
  latency: number;
  reliability: number;
}

const WEIGHT_PRESETS: Record<QualityTarget, Weights> = {
  frontier: { quality: 0.7, cost: 0.1, latency: 0.1, reliability: 0.1 },
  balanced: { quality: 0.4, cost: 0.25, latency: 0.2, reliability: 0.15 },
  economy: { quality: 0.15, cost: 0.5, latency: 0.2, reliability: 0.15 },
};

export function costLatencyScorer(
  candidates: CandidateSet,
  qualityTarget: QualityTarget,
  rateLimitService?: RateLimitService
): CandidateSet {
  const weights = WEIGHT_PRESETS[qualityTarget];

  // Find max values for normalization
  const maxCost = Math.max(...candidates.map((m) => m.costPerInputToken || m.costPerImage || 1));
  const maxLatency = Math.max(...candidates.map((m) => m.avgLatencyMs || 1000));

  return candidates
    .map((model) => {
      const costScore = 1 - (model.costPerInputToken || model.costPerImage || 0) / maxCost;
      const latencyScore = 1 - (model.avgLatencyMs || 0) / maxLatency;
      const qualityScore = model.qualityScore;
      const reliabilityScore = model.isHealthy ? 1 : 0;

      let compositeScore =
        weights.quality * qualityScore +
        weights.cost * costScore +
        weights.latency * latencyScore +
        weights.reliability * reliabilityScore;

      // Apply dynamic penalty from 429 responses
      // Each penalty point costs 5% of composite score
      if (rateLimitService) {
        const penaltyPoints = rateLimitService.getPenaltyPoints(model.providerId, model.modelId);
        compositeScore -= penaltyPoints * 0.05;
      }

      return { ...model, compositeScore };
    })
    .sort((a, b) => (b as any).compositeScore - (a as any).compositeScore);
}
