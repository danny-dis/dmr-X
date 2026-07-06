import type { CandidateSet, QualityTarget, ProviderSort, CapabilityTier, Modality, TurnType } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';

import { calculateTierMatchScore, calculateTaskMatchScore, calculateContextMatchScore, calculateReasoningMatchScore, calculateAgenticMatchScore, type RoutingContext } from './capability-filter.js';

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
  taskMatch: number;
  contextMatch: number;
  reasoningMatch: number;
  agenticMatch: number;
}

const WEIGHT_PRESETS: Record<QualityTarget, Weights> = {
  frontier: { quality: 0.45, cost: 0.1, latency: 0.1, reliability: 0.1, layerMatch: 0.1, taskMatch: 0.1, contextMatch: 0.05, reasoningMatch: 0.05, agenticMatch: 0.05 },
  balanced: { quality: 0.25, cost: 0.2, latency: 0.15, reliability: 0.1, layerMatch: 0.1, taskMatch: 0.1, contextMatch: 0.05, reasoningMatch: 0.05, agenticMatch: 0.05 },
  economy: { quality: 0.1, cost: 0.4, latency: 0.15, reliability: 0.1, layerMatch: 0.1, taskMatch: 0.05, contextMatch: 0.05, reasoningMatch: 0.05, agenticMatch: 0.05 },
};

/**
 * Weight overrides when user explicitly requests a sort strategy.
 * These dominate the quality-target-based weights.
 */
const SORT_WEIGHT_OVERRIDES: Record<ProviderSort, Weights> = {
  price: { quality: 0.1, cost: 0.7, latency: 0.1, reliability: 0.05, layerMatch: 0.05, taskMatch: 0, contextMatch: 0, reasoningMatch: 0, agenticMatch: 0 },
  latency: { quality: 0.1, cost: 0.1, latency: 0.7, reliability: 0.05, layerMatch: 0.05, taskMatch: 0, contextMatch: 0, reasoningMatch: 0, agenticMatch: 0 },
  throughput: { quality: 0.1, cost: 0.15, latency: 0.15, reliability: 0.55, layerMatch: 0.05, taskMatch: 0, contextMatch: 0, reasoningMatch: 0, agenticMatch: 0 },
};

/**
 * Turn-type-specific weight adjustments applied on top of the base weights.
 * These bias routing toward providers that excel at the detected turn type.
 */
const TURN_TYPE_ADJUSTMENTS: Partial<Record<TurnType, Partial<Weights>>> = {
  code_gen: { quality: 0.15, cost: -0.05, latency: -0.05, reliability: 0.0, layerMatch: -0.05 },
  tool_use: { quality: 0.1, cost: -0.05, latency: 0.0, reliability: 0.1, layerMatch: -0.15 },
  q_a: { quality: -0.05, cost: 0.0, latency: 0.1, reliability: 0.0, layerMatch: -0.05 },
  creative: { quality: 0.1, cost: -0.05, latency: -0.05, reliability: 0.0, layerMatch: 0.0 },
  summarization: { quality: -0.1, cost: 0.1, latency: 0.05, reliability: 0.0, layerMatch: -0.05 },
  translation: { quality: -0.05, cost: 0.05, latency: 0.05, reliability: 0.0, layerMatch: -0.05 },
  data_analysis: { quality: 0.1, cost: 0.0, latency: -0.05, reliability: 0.0, layerMatch: -0.05 },
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
  turnType?: TurnType,
  routingContext?: RoutingContext,
): CandidateSet {
  // User's sort preference overrides quality target weights
  const weights = sortStrategy
    ? { ...SORT_WEIGHT_OVERRIDES[sortStrategy] }
    : { ...WEIGHT_PRESETS[qualityTarget] };

  // Apply turn-type adjustments (additive, clamped to [0, 1])
  if (turnType && TURN_TYPE_ADJUSTMENTS[turnType]) {
    const adj = TURN_TYPE_ADJUSTMENTS[turnType]!;
    for (const key of ['quality', 'cost', 'latency', 'reliability', 'layerMatch'] as const) {
      if (adj[key] !== undefined) {
        weights[key] = Math.max(0, Math.min(1, weights[key] + adj[key]!));
      }
    }
    // Re-normalize weights to sum to 1
    const total = weights.quality + weights.cost + weights.latency + weights.reliability + weights.layerMatch;
    if (total > 0) {
      weights.quality /= total;
      weights.cost /= total;
      weights.latency /= total;
      weights.reliability /= total;
      weights.layerMatch /= total;
    }
  }

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

      // Multi-dimensional scores (using routing context if provided)
      const taskMatchScore = routingContext?.taskCategories
        ? calculateTaskMatchScore(model.taskCategories || ['general'], routingContext.taskCategories)
        : 0.5;
      
      const contextMatchScore = routingContext?.minContextWindow
        ? calculateContextMatchScore(model.contextLength || 0, routingContext.minContextWindow)
        : 0.5;
      
      const reasoningMatchScore = routingContext?.reasoningMode
        ? calculateReasoningMatchScore(model.reasoningMode || 'fixed', routingContext.reasoningMode)
        : 0.5;
      
      const agenticMatchScore = routingContext?.agenticLevel
        ? calculateAgenticMatchScore(model.agenticLevel || 'chat', routingContext.agenticLevel)
        : 0.5;

      let compositeScore =
        weights.quality * qualityScore +
        weights.cost * costScore +
        weights.latency * latencyScore +
        weights.reliability * reliabilityScore +
        weights.layerMatch * layerMatchScore +
        weights.taskMatch * taskMatchScore +
        weights.contextMatch * contextMatchScore +
        weights.reasoningMatch * reasoningMatchScore +
        weights.agenticMatch * agenticMatchScore;

      // Apply dynamic penalty from 429 responses
      // Each penalty point costs 5% of composite score
      if (rateLimitService) {
        const penaltyPoints = rateLimitService.getPenaltyPoints(model.providerId, model.modelId);
        compositeScore -= penaltyPoints * 0.05;

        // Quota headroom bonus: models with more remaining capacity get a boost
        // Bonus range: 0 (exhausted) to +0.15 (full quota)
        const state = rateLimitService.getState(model.providerId, model.modelId);
        const headroomDimensions: number[] = [];
        if (state.config.rpm && state.config.rpm > 0) {
          headroomDimensions.push(Math.max(0, (state.config.rpm - state.currentRPM) / state.config.rpm));
        }
        if (state.config.tpm && state.config.tpm > 0) {
          headroomDimensions.push(Math.max(0, (state.config.tpm - state.currentTPM) / state.config.tpm));
        }
        if (state.config.rpd && state.config.rpd > 0) {
          headroomDimensions.push(Math.max(0, (state.config.rpd - state.currentRPD) / state.config.rpd));
        }
        if (state.config.tpd && state.config.tpd > 0) {
          headroomDimensions.push(Math.max(0, (state.config.tpd - state.currentTPD) / state.config.tpd));
        }
        if (headroomDimensions.length > 0) {
          const avgHeadroom = headroomDimensions.reduce((s, h) => s + h, 0) / headroomDimensions.length;
          compositeScore += avgHeadroom * 0.15; // Up to +0.15 for full quota
        }
      }

      return { ...model, compositeScore };
    })
    .sort((a, b) => (b as any).compositeScore - (a as any).compositeScore);
}
