import type { CandidateSet, QualityTarget, ProviderSort } from '@dmr-x/core';
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

/**
 * Weight overrides when user explicitly requests a sort strategy.
 * These dominate the quality-target-based weights.
 */
const SORT_WEIGHT_OVERRIDES: Record<ProviderSort, Weights> = {
  price: { quality: 0.1, cost: 0.7, latency: 0.1, reliability: 0.1 },
  latency: { quality: 0.1, cost: 0.1, latency: 0.7, reliability: 0.1 },
  throughput: { quality: 0.1, cost: 0.15, latency: 0.15, reliability: 0.6 },
};

export function costLatencyScorer(
  candidates: CandidateSet,
  qualityTarget: QualityTarget,
  rateLimitService?: RateLimitService,
  sortStrategy?: ProviderSort,
): CandidateSet {
  // User's sort preference overrides quality target weights
  const weights = sortStrategy
    ? SORT_WEIGHT_OVERRIDES[sortStrategy]
    : WEIGHT_PRESETS[qualityTarget];

  // Find max values for normalization
  const maxCost = Math.max(...candidates.map((m) => m.costPerInputToken || m.costPerImage || 1));
  const maxLatency = Math.max(...candidates.map((m) => m.avgLatencyMs || 1000));

  return candidates
    .map((model) => {
      const costScore = 1 - (model.costPerInputToken || model.costPerImage || 0) / maxCost;
      const latencyScore = 1 - (model.avgLatencyMs || 0) / maxLatency;

      // For free models with catalog metadata, blend runtime quality with curated rankings
      let qualityScore = model.qualityScore;
      if (model.freeTierMetadata) {
        const catalogIntelligence = model.freeTierMetadata.intelligenceRank / 10;
        const catalogSpeed = model.freeTierMetadata.speedRank / 10;
        // 60% runtime quality + 20% intelligence rank + 20% speed rank
        qualityScore = qualityScore * 0.6 + catalogIntelligence * 0.2 + catalogSpeed * 0.2;
      }

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
