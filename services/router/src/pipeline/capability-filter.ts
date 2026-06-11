import type { CandidateSet, Modality, CapabilityTier } from '@dmr-x/core';

/**
 * Capability tier adjacency — used for soft matching.
 * Tiers in the same group are considered "close" for scoring purposes.
 */
const TIER_ADJACENCY: Record<CapabilityTier, CapabilityTier[]> = {
  orchestrator: ['brain'],
  brain: ['orchestrator', 'thinker'],
  thinker: ['brain', 'executor'],
  executor: ['thinker', 'specialist', 'worker'],
  specialist: ['executor', 'worker'],
  worker: ['executor', 'specialist', 'temp_worker'],
  temp_worker: ['worker'],
};

export function capabilityFilter(
  candidates: CandidateSet,
  requiredCapabilities: string[],
  modality: Modality,
  requiredCapabilityTier?: CapabilityTier,
): CandidateSet {
  return candidates.filter((model) => {
    // Must match modality
    if (model.modality !== modality) {
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
    // This is a soft filter — the actual preference is applied in the scorer
    if (requiredCapabilityTier && model.capabilityTier !== requiredCapabilityTier) {
      // Check if it's an adjacent tier (close match)
      const adjacent = TIER_ADJACENCY[requiredCapabilityTier] || [];
      if (!adjacent.includes(model.capabilityTier)) {
        // Not adjacent — still keep but will be penalized in scoring
        // Only reject if there are enough matching candidates
      }
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
 * - 0.0 = no match (but still available as fallback)
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
