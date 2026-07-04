import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

let roundRobinIndex = 0;

/**
 * Round-robin routing strategy.
 * Cycles through candidates in order, wrapping around.
 */
export function selectRoundRobin(candidates: CandidateSet): SelectedProvider | null {
  if (candidates.length === 0) return null;

  const idx = roundRobinIndex % candidates.length;
  roundRobinIndex = (roundRobinIndex + 1) % candidates.length;

  const selected = candidates[idx];
  logger.debug({ providerId: selected.providerId, modelId: selected.modelId }, 'Round-robin routing selected');

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
