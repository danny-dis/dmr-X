import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Priority routing strategy.
 * Uses an ordered list of providers. Selects the first healthy provider
 * from the list. If a preferred order is provided, follows it strictly.
 */
export function selectByPriority(
  candidates: CandidateSet,
  preferredOrder?: string[]
): SelectedProvider | null {
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

  if (preferredOrder && preferredOrder.length > 0) {
    // Follow preferred order strictly
    for (const preferred of preferredOrder) {
      const match = candidates.find(c =>
        c.providerId === preferred || c.providerName === preferred
      );
      if (match && match.isHealthy) {
        logger.debug(
          { providerId: match.providerId, modelId: match.modelId },
          'Priority routing selected (preferred order)',
        );
        return {
          providerId: match.providerId,
          modelId: match.modelId,
          adapterType: match.providerName,
          score: match.qualityScore,
        };
      }
    }
  }

  // Default: pick highest quality healthy candidate
  const sorted = [...candidates]
    .filter(c => c.isHealthy)
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

  if (sorted.length === 0) {
    // All unhealthy — pick best anyway
    const best = [...candidates].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      adapterType: best.providerName,
      score: best.qualityScore,
    };
  }

  const selected = sorted[0];
  logger.debug({ providerId: selected.providerId, modelId: selected.modelId }, 'Priority routing selected');

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
