import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Headroom routing strategy.
 * Selects the provider with the most remaining quota/budget.
 * Free-tier models with no limits get highest headroom.
 */
export function selectByHeadroom(candidates: CandidateSet): SelectedProvider | null {
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

  // Compute headroom score for each candidate
  const withHeadroom = candidates.map(c => {
    let headroom = 100; // default high headroom

    // Free-tier models with no budget limit get max headroom
    if (c.freeTierMetadata) {
      const { monthlyTokenBudget, rateLimits } = c.freeTierMetadata;
      if (monthlyTokenBudget === 0 && rateLimits.tpd === 0) {
        headroom = 1000; // uncapped
      } else if (monthlyTokenBudget > 0) {
        // Estimate remaining budget (simplified — real impl would check actual usage)
        headroom = monthlyTokenBudget / 1_000_000; // normalize to millions
      } else if (rateLimits.tpd > 0) {
        headroom = rateLimits.tpd / 1_000_000;
      }
    }

    // Penalize unhealthy providers
    if (!c.isHealthy) headroom = 0;

    return { model: c, headroom };
  });

  // Sort by headroom descending, then quality
  withHeadroom.sort((a, b) => {
    if (b.headroom !== a.headroom) return b.headroom - a.headroom;
    return (b.model.qualityScore ?? 0) - (a.model.qualityScore ?? 0);
  });

  const selected = withHeadroom[0].model;
  logger.debug(
    { providerId: selected.providerId, modelId: selected.modelId, headroom: withHeadroom[0].headroom },
    'Headroom routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
