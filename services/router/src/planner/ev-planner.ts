import { logger } from '@dmr-x/utils';

/**
 * Cache-Aware Expected Value (EV) Planner
 *
 * Inspired by workweave/router's planner that decides STAY vs SWITCH per turn.
 * Compares expected per-turn savings over the remaining horizon against
 * the eviction cost of warming a new cache.
 *
 * Key concepts:
 * - STAY: Keep the pinned model (preserves upstream prompt cache warmth)
 * - SWITCH: Take the cluster scorer's fresh decision (eat one-time cache miss)
 * - Tier-upgrade guard: Forces SWITCH when the fresh decision is strictly higher tier
 * - Cache-warmth gate: When cache has lapsed, both sides are priced uncached
 *
 * This is a pure function — no I/O, no DB lookups. All inputs are values.
 */

export type PlannerDecision = 'STAY' | 'SWITCH';

export interface ModelTier {
  /** Tier level: 'low' | 'mid' | 'high' */
  level: 'low' | 'mid' | 'high';
  /** Quality score (0-1) */
  quality: number;
  /** Cost per 1K tokens (input + output combined) */
  costPer1K: number;
}

export interface PlannerInputs {
  /** The currently pinned model */
  pinnedModel: {
    id: string;
    providerId: string;
    tier: ModelTier;
    costPer1K: number;
    /** Whether this model's upstream prompt cache is warm */
    cacheWarm: boolean;
  };

  /** The fresh routing decision from the scorer */
  freshDecision: {
    id: string;
    providerId: string;
    tier: ModelTier;
    costPer1K: number;
  };

  /** Estimated tokens for this turn */
  estimatedTokens: number;

  /** Estimated remaining turns in the conversation */
  remainingTurns: number;

  /** Whether summarization is available (reduces switch cost) */
  summarizationAvailable: boolean;

  /** Estimated cost of summarization (tokens * cost) */
  summarizationCost: number;
}

export interface PlannerResult {
  decision: PlannerDecision;
  reason: string;
  /** Expected savings (positive = SWITCH is better) */
  expectedSavings: number;
  /** Breakdown for debugging */
  breakdown: {
    stayEV: number;
    switchEV: number;
    cacheWarmthFactor: number;
    tierUpgradeBonus: number;
  };
}

/**
 * Tier order for comparison
 */
const TIER_ORDER: Record<string, number> = { low: 0, mid: 1, high: 2 };

/**
 * Cache warmth multiplier — how much cache warmth saves per turn
 * Anthropic's prompt cache gives ~90% discount on cached prefix tokens.
 * This is an approximation; real savings depend on prefix length.
 */
const CACHE_WARMTH_MULTIPLIER = 0.1; // 90% savings = 10% of original cost

/**
 * Eviction cost — the one-time cost of switching (cache miss + potential summarization)
 */
function computeEvictionCost(inputs: PlannerInputs): number {
  const switchCost = inputs.estimatedTokens * (inputs.freshDecision.costPer1K / 1000);
  const summarizationCost = inputs.summarizationAvailable ? inputs.summarizationCost : 0;
  return switchCost + summarizationCost;
}

/**
 * Expected value of staying with the pinned model
 */
function computeStayEV(inputs: PlannerInputs): number {
  const { pinnedModel, estimatedTokens, remainingTurns } = inputs;

  let totalCost = 0;

  for (let turn = 0; turn < remainingTurns; turn++) {
    if (pinnedModel.cacheWarm && turn === 0) {
      // First turn after switch: cache is warm, pay reduced cost
      totalCost += estimatedTokens * (pinnedModel.costPer1K / 1000) * CACHE_WARMTH_MULTIPLIER;
    } else if (pinnedModel.cacheWarm && turn > 0) {
      // Subsequent turns: cache stays warm (prefix grows but core is cached)
      totalCost += estimatedTokens * (pinnedModel.costPer1K / 1000) * CACHE_WARMTH_MULTIPLIER;
    } else {
      // Cache cold: pay full cost
      totalCost += estimatedTokens * (pinnedModel.costPer1K / 1000);
    }
  }

  return totalCost;
}

/**
 * Expected value of switching to the fresh decision
 */
function computeSwitchEV(inputs: PlannerInputs): number {
  const { freshDecision, estimatedTokens, remainingTurns, summarizationAvailable } = inputs;

  // First turn: pay full cost (cache cold) + eviction cost
  const evictionCost = computeEvictionCost(inputs);
  let totalCost = evictionCost + estimatedTokens * (freshDecision.costPer1K / 1000);

  // Subsequent turns: cache warms up on the new model
  for (let turn = 1; turn < remainingTurns; turn++) {
    totalCost += estimatedTokens * (freshDecision.costPer1K / 1000) * CACHE_WARMTH_MULTIPLIER;
  }

  return totalCost;
}

/**
 * Tier-upgrade guard: force SWITCH when the fresh decision is strictly higher tier
 */
function shouldForceSwitchDueToTier(
  pinnedTier: ModelTier,
  freshTier: ModelTier,
): boolean {
  const pinnedLevel = TIER_ORDER[pinnedTier.level] ?? 0;
  const freshLevel = TIER_ORDER[freshTier.level] ?? 0;

  // Force switch if fresh is strictly higher tier AND quality difference is significant
  return freshLevel > pinnedLevel && (freshTier.quality - pinnedTier.quality) > 0.15;
}

/**
 * The main planner function.
 *
 * Pure function — no I/O, no DB lookups. All inputs are values.
 * This mirrors workweave/router's internal/router/planner logic:
 * https://github.com/workweave/router/blob/main/internal/router/planner/CLAUDE.md
 */
export function planStayOrSwitch(inputs: PlannerInputs): PlannerResult {
  const { pinnedModel, freshDecision, remainingTurns } = inputs;

  // Edge case: same model → always STAY
  if (pinnedModel.id === freshDecision.id) {
    return {
      decision: 'STAY',
      reason: 'Same model — no switch needed',
      expectedSavings: 0,
      breakdown: { stayEV: 0, switchEV: 0, cacheWarmthFactor: 1, tierUpgradeBonus: 0 },
    };
  }

  // Edge case: very few remaining turns → STAY (switch cost not worth it)
  if (remainingTurns <= 1) {
    return {
      decision: 'STAY',
      reason: 'Few remaining turns — switch cost not justified',
      expectedSavings: 0,
      breakdown: { stayEV: 0, switchEV: 0, cacheWarmthFactor: 1, tierUpgradeBonus: 0 },
    };
  }

  // Tier-upgrade guard
  const tierUpgradeBonus = shouldForceSwitchDueToTier(pinnedModel.tier, freshDecision.tier)
    ? 0.2 // Bonus for switching to higher tier
    : 0;

  // Compute EVs
  const stayEV = computeStayEV(inputs);
  const switchEV = computeSwitchEV(inputs);

  // Cache warmth factor
  const cacheWarmthFactor = pinnedModel.cacheWarm ? CACHE_WARMTH_MULTIPLIER : 1;

  // Expected savings (positive = SWITCH is cheaper)
  const expectedSavings = stayEV - switchEV + tierUpgradeBonus * stayEV;

  // Decision threshold: switch only if savings exceed 5% of stay cost
  const savingsThreshold = stayEV * 0.05;

  const decision: PlannerDecision = expectedSavings > savingsThreshold ? 'SWITCH' : 'STAY';

  const reason = decision === 'SWITCH'
    ? `Switch saves ${Math.round(expectedSavings * 100) / 100} tokens-worth (${Math.round(expectedSavings / stayEV * 100)}% of stay cost)`
    : `Stay is cheaper or comparable (savings ${Math.round(expectedSavings * 100) / 100} < threshold ${Math.round(savingsThreshold * 100) / 100})`;

  logger.debug(
    {
      decision,
      stayEV: Math.round(stayEV),
      switchEV: Math.round(switchEV),
      expectedSavings: Math.round(expectedSavings * 100) / 100,
      cacheWarmthFactor,
      tierUpgradeBonus,
      pinnedModel: pinnedModel.id,
      freshDecision: freshDecision.id,
    },
    'Planner decision',
  );

  return {
    decision,
    reason,
    expectedSavings,
    breakdown: {
      stayEV,
      switchEV,
      cacheWarmthFactor,
      tierUpgradeBonus,
    },
  };
}
