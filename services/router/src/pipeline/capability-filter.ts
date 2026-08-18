import type { CandidateSet, Modality, CapabilityTier } from '@dmr-x/core';

/**
 * Capability tier adjacency — used for soft matching.
 * Updated to use the new 5-tier system: frontier > strong > balanced > fast > economy
 */
const TIER_ADJACENCY: Record<CapabilityTier, CapabilityTier[]> = {
  frontier: ['strong'],
  strong: ['frontier', 'balanced'],
  balanced: ['strong', 'fast'],
  fast: ['balanced', 'economy'],
  economy: ['fast'],
};

/**
 * Multi-dimensional request context for scoring.
 */
export interface RoutingContext {
  /** Dimension 1: Required capability tier */
  capabilityTier?: CapabilityTier;
  /** Dimension 3: Required task categories (at least one must match) */
  taskCategories?: string[];
  /** Dimension 4: Budget constraint (max cost per 1k tokens) */
  maxCostPer1k?: number;
  /** Dimension 5: Minimum context window required */
  minContextWindow?: number;
  /** Dimension 6: Deployment preference */
  deployment?: 'cloud' | 'self_hosted' | 'on_device';
  /** Dimension 7: Reasoning mode preference */
  reasoningMode?: 'fixed' | 'adaptive' | 'hybrid';
  /** Dimension 8: Safety tier requirement */
  safetyTier?: 'unrestricted' | 'standard' | 'restricted';
  /** Dimension 9: Agentic level requirement */
  agenticLevel?: 'chat' | 'tool_use' | 'autonomous';
}

export function capabilityFilter(
  candidates: CandidateSet,
  requiredCapabilities: string[],
  modality: Modality,
  requiredCapabilityTier?: CapabilityTier,
): CandidateSet {
  const matchesModality = (model: CandidateSet[number]): boolean => model.modality === modality;

  const strict = candidates.filter((model) => {
    // Must match modality
    if (!matchesModality(model)) {
      return false;
    }

    // Must have all required capabilities
    for (const cap of requiredCapabilities) {
      if (!model.capabilities.includes(cap)) {
        return false;
      }
    }

    // Soft filter: if requiredCapabilityTier is set, prefer matching models
    // but don't reject non-matching ones (they'll get penalized in scoring)
    if (requiredCapabilityTier && model.capabilityTier !== requiredCapabilityTier) {
      const adjacent = TIER_ADJACENCY[requiredCapabilityTier] || [];
      if (!adjacent.includes(model.capabilityTier)) {
        // Not adjacent — still keep but will be penalized in scoring
      }
    }

    return true;
  });

  // Capability tags come from nullable DB columns (`supports_tool_use`,
  // `supports_reasoning`, ...) that are sparsely populated: a model that
  // genuinely supports tools is dropped here whenever its column was never
  // backfilled. Measured on this deployment, requiring `tool_use` cut the
  // pool from 177 models / 3 providers to 8 models / 1 provider, which left
  // the fallback chain with nothing to fail over to and turned any single
  // upstream hiccup into a hard 502.
  //
  // Degrade to a PREFERENCE only for capabilities where a mis-tagged model
  // still produces a usable answer: `tool_use`, `json_mode` and `reasoning`
  // are advisory (a model without the tag usually still handles tool calls,
  // and the adapter surfaces a real error if it truly cannot). `vision` stays
  // HARD — a text-only model cannot see an attached image, so routing there
  // would guarantee a wrong answer instead of risking one. Modality is always
  // hard for the same reason.
  const SOFT_CAPABILITIES = new Set(['tool_use', 'json_mode', 'reasoning', 'function_call']);
  const allSoft =
    requiredCapabilities.length > 0 &&
    requiredCapabilities.every((cap) => SOFT_CAPABILITIES.has(cap));

  if (strict.length > 0 || !allSoft) {
    return strict;
  }

  return candidates.filter(matchesModality);
}

/**
 * Multi-dimensional filter using the 9-dimension taxonomy.
 * Filters candidates based on all dimensions in the routing context.
 */
export function multiDimensionalFilter(
  candidates: CandidateSet,
  modality: Modality,
  context: RoutingContext,
): CandidateSet {
  return candidates.filter((model) => {
    // Must match modality
    if (model.modality !== modality) {
      return false;
    }

    // Dimension 1: Capability tier soft filter
    if (context.capabilityTier && model.capabilityTier !== context.capabilityTier) {
      const adjacent = TIER_ADJACENCY[context.capabilityTier] || [];
      if (!adjacent.includes(model.capabilityTier)) {
        // Penalized but not rejected
      }
    }

    // Dimension 3: Task categories (at least one must match)
    if (context.taskCategories && context.taskCategories.length > 0) {
      const modelCategories = model.taskCategories || ['general'];
      const hasMatch = context.taskCategories.some(tc => modelCategories.includes(tc));
      if (!hasMatch) return false;
    }

    // Dimension 5: Context window (must meet minimum)
    if (context.minContextWindow && model.contextLength) {
      if (model.contextLength < context.minContextWindow) return false;
    }

    // Dimension 6: Deployment preference
    if (context.deployment && model.deployment !== context.deployment) {
      // Soft filter — prefer matching but don't reject
    }

    return true;
  });
}

/**
 * Calculate tier match score for scoring purposes.
 * Returns a value between 0 and 1:
 * - 1.0 = exact match
 * - 0.7 = adjacent tier
 * - 0.4 = two tiers away
 * - 0.2 = far away but still available
 */
export function calculateTierMatchScore(
  modelTier: CapabilityTier,
  requiredTier?: CapabilityTier,
): number {
  if (!requiredTier) return 0.5; // No preference = neutral
  if (modelTier === requiredTier) return 1.0;

  const adjacent = TIER_ADJACENCY[requiredTier] || [];
  if (adjacent.includes(modelTier)) return 0.7;

  // Check two tiers away
  const twoTiersAway = adjacent.flatMap(t => TIER_ADJACENCY[t] || []);
  if (twoTiersAway.includes(modelTier)) return 0.4;

  return 0.2; // Far away but still available
}

/**
 * Calculate task category match score.
 * Returns a value between 0 and 1 based on overlap.
 */
export function calculateTaskMatchScore(
  modelCategories: string[],
  requiredCategories?: string[],
): number {
  if (!requiredCategories || requiredCategories.length === 0) return 0.5;
  
  const overlap = requiredCategories.filter(rc => modelCategories.includes(rc)).length;
  const ratio = overlap / requiredCategories.length;
  
  return Math.max(0.2, ratio); // Minimum 0.2 for having any match
}

/**
 * Calculate cost score (lower cost = higher score).
 * Returns a value between 0 and 1.
 */
export function calculateCostScore(
  modelCostPer1k: number,
  maxCostPer1k?: number,
): number {
  if (!maxCostPer1k) return 0.5; // No budget = neutral
  
  if (modelCostPer1k <= 0) return 1.0; // Free = best
  if (modelCostPer1k >= maxCostPer1k) return 0.2; // Over budget = penalized
  
  // Linear scale: cheaper = better
  return 1.0 - (modelCostPer1k / maxCostPer1k) * 0.8;
}

/**
 * Calculate context window match score.
 * Returns a value between 0 and 1.
 */
export function calculateContextMatchScore(
  modelContextWindow: number,
  minContextWindow?: number,
): number {
  if (!minContextWindow) return 0.5;
  
  if (modelContextWindow >= minContextWindow * 2) return 1.0; // Way more than needed
  if (modelContextWindow >= minContextWindow) return 0.8; // Meets requirement
  if (modelContextWindow >= minContextWindow * 0.5) return 0.5; // Close but not enough
  
  return 0.2; // Way too small
}

/**
 * Calculate reasoning mode match score.
 * Returns a value between 0 and 1.
 */
export function calculateReasoningMatchScore(
  modelMode: string,
  preferredMode?: string,
): number {
  if (!preferredMode) return 0.5;
  
  if (modelMode === preferredMode) return 1.0;
  
  // Adaptive is always good
  if (modelMode === 'adaptive') return 0.8;
  
  // Hybrid can work for most cases
  if (modelMode === 'hybrid' && preferredMode !== 'fixed') return 0.6;
  
  return 0.3;
}

/**
 * Calculate agentic level match score.
 * Returns a value between 0 and 1.
 */
export function calculateAgenticMatchScore(
  modelLevel: string,
  requiredLevel?: string,
): number {
  if (!requiredLevel) return 0.5;
  
  // Autonomous can do anything
  if (modelLevel === 'autonomous') return 1.0;
  
  // Tool use can do chat
  if (modelLevel === 'tool_use' && requiredLevel === 'chat') return 0.9;
  if (modelLevel === 'tool_use' && requiredLevel === 'tool_use') return 1.0;
  
  // Chat can only do chat
  if (modelLevel === 'chat' && requiredLevel === 'chat') return 1.0;
  
  return 0.2; // Not enough capability
}

/**
 * Multi-dimensional scoring function.
 * Combines all 9 dimensions into a single score.
 */
export function multiDimensionalScore(
  model: any,
  context: RoutingContext,
): number {
  let score = 0;
  let weightSum = 0;

  // Dimension 1: Capability tier (25%)
  if (context.capabilityTier) {
    score += calculateTierMatchScore(model.capabilityTier, context.capabilityTier) * 0.25;
    weightSum += 0.25;
  }

  // Dimension 3: Task categories (25%)
  if (context.taskCategories && context.taskCategories.length > 0) {
    score += calculateTaskMatchScore(model.taskCategories || ['general'], context.taskCategories) * 0.25;
    weightSum += 0.25;
  }

  // Dimension 4: Cost (15%)
  if (context.maxCostPer1k !== undefined) {
    const modelCost = (model.inputCostPer1k || 0) + (model.outputCostPer1k || 0);
    score += calculateCostScore(modelCost, context.maxCostPer1k) * 0.15;
    weightSum += 0.15;
  }

  // Dimension 5: Context window (15%)
  if (context.minContextWindow) {
    score += calculateContextMatchScore(model.contextWindow || 0, context.minContextWindow) * 0.15;
    weightSum += 0.15;
  }

  // Dimension 7: Reasoning mode (10%)
  if (context.reasoningMode) {
    score += calculateReasoningMatchScore(model.reasoningMode || 'fixed', context.reasoningMode) * 0.1;
    weightSum += 0.1;
  }

  // Dimension 9: Agentic level (10%)
  if (context.agenticLevel) {
    score += calculateAgenticMatchScore(model.agenticLevel || 'chat', context.agenticLevel) * 0.1;
    weightSum += 0.1;
  }

  // Normalize score if we have weighted dimensions
  return weightSum > 0 ? score / weightSum * (weightSum / 1.0) : 0.5;
}
