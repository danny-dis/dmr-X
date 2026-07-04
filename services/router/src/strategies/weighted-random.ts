import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Weighted random routing strategy.
 * Selects a candidate with probability proportional to its quality score.
 */
export function selectWeightedRandom(candidates: CandidateSet): SelectedProvider | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      providerId: c.providerId,
      modelId: c.modelId,
      adapterType: c.providerName,
      score: c.qualityScore,
    };
  }

  const weights = candidates.map(c => Math.max(c.qualityScore, 0.01));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * totalWeight;
  let selected = candidates[0];

  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      selected = candidates[i];
      break;
    }
  }

  logger.debug({ providerId: selected.providerId, modelId: selected.modelId }, 'Weighted random routing selected');

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
