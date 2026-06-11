import type { CandidateSet, QualityTarget, ProviderSort, CapabilityTier, Modality } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';
import { calculateTierMatchScore } from './capability-filter.js';

/**
 * Default estimated video duration in seconds used for cost comparison
 * when a video model uses per-second pricing (costPerSecond).
 * This is a routing-estimate, not the actual requested duration.
 */
const DEFAULT_VIDEO_DURATION_SEC = 5;

interface Weights {
  quality: number;
  cost: number;
  latency: number;
  reliability: number;
  layerMatch: number;
}

const WEIGHT_PRESETS: Record<QualityTarget, Weights> = {
  frontier: { quality: 0.6, cost: 0.1, latency: 0.1, reliability: 0.1, layerMatch: 0.1 },
  balanced: { quality: 0.35, cost: 0.25, latency: 0.2, reliability: 0.1, layerMatch: 0.1 },
  economy: { quality: 0.1, cost: 0.5, latency: 0.2, reliability: 0.1, layerMatch: 0.1 },
};

/**
 * Weight overrides when user explicitly requests a sort strategy.
 * These dominate the quality-target-based weights.
 */
const SORT_WEIGHT_OVERRIDES: Record<ProviderSort, Weights> = {
  price: { quality: 0.1, cost: 0.7, latency: 0.1, reliability: 0.05, layerMatch: 0.05 },
  latency: { quality: 0.1, cost: 0.1, latency: 0.7, reliability: 0.05, layerMatch: 0.05 },
  throughput: { quality: 0.1, cost: 0.15, latency: 0.15, reliability: 0.55, layerMatch: 0.05 },
};

/**
 * Compute the effective cost for a model based on its modality.
 * - LLM/embedding: per-token cost (input + output)
 * - Diffusion/image: costPerImage
 * - Video: costPerVideo, costPerSecond * estimated duration, or fallback to costPerImage
 * - Music/audio: flat cost per generation
 */
function getEffectiveCost(model: CandidateSet[number], modality?: Modality): number {
  // For video modality, use video-specific pricing
  if (modality === 'video') {
    if (model.costPerVideo !== undefined && model.costPerVideo > 0) {
      return model.costPerVideo;
    }
    if (model.costPerSecond !== undefined && model.costPerSecond > 0) {
      return model.costPerSecond * DEFAULT_VIDEO_DURATION_SEC;
    }
    // Fallback: use costPerImage as a rough estimate
    return model.costPerImage || 1;
  }

  // For diffusion/image, use costPerImage
  if (modality === 'diffusion' || modality === 'image_upscaling' || modality === 'image_inpainting') {
    return model.costPerImage || 1;
  }

  // For all other modalities (llm, embedding, audio, etc.), use token costs
  const combinedCost = (model.costPerInputToken || 0) + (model.costPerOutputToken || 0);
  return combinedCost || model.costPerImage || 1;
}

export function costLatencyScorer(
  candidates: CandidateSet,
  qualityTarget: QualityTarget,
  rateLimitService?: RateLimitService,
  sortStrategy?: ProviderSort,
  requiredCapabilityTier?: CapabilityTier,
  modality?: Modality,
): CandidateSet {
  // User's sort preference overrides quality target weights
  const weights = sortStrategy
    ? SORT_WEIGHT_OVERRIDES[sortStrategy]
    : WEIGHT_PRESETS[qualityTarget];

  // Find max values for normalization (use modality-aware effective cost)
  const maxCost = Math.max(...candidates.map((m) => getEffectiveCost(m, modality)));
  const maxLatency = Math.max(...candidates.map((m) => m.avgLatencyMs || 1000));

  return candidates
    .map((model) => {
      const effectiveCost = getEffectiveCost(model, modality);
      const costScore = 1 - effectiveCost / maxCost;
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

      // Layer match score — how well does this model's capability tier match the request?
      const layerMatchScore = calculateTierMatchScore(model.capabilityTier, requiredCapabilityTier);

      let compositeScore =
        weights.quality * qualityScore +
        weights.cost * costScore +
        weights.latency * latencyScore +
        weights.reliability * reliabilityScore +
        weights.layerMatch * layerMatchScore;

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
