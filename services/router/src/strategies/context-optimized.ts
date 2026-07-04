import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Context-optimized routing strategy.
 * Selects the best model for the given context size,
 * preferring models with enough context window while minimizing cost.
 */
export function selectByContextSize(
  candidates: CandidateSet,
  contextSize: number
): SelectedProvider | null {
  if (candidates.length === 0) return null;

  // Filter to models that can handle the context size
  const withContext = candidates.map(c => {
    const contextWindow = c.contextLength ?? 128000; // default assumption
    const fits = contextWindow >= contextSize;
    const utilization = contextSize / contextWindow; // how much of the context is used

    return {
      model: c,
      fits,
      utilization,
      contextWindow,
    };
  });

  // Prefer models that fit, with lowest cost that still has good quality
  const scored = withContext
    .filter(w => w.fits)
    .map(w => ({
      ...w,
      score: (w.model.qualityScore ?? 0) * (1 - w.utilization * 0.3), // penalize high utilization
    }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // No model fits — pick largest context window
    const largest = [...withContext].sort((a, b) => b.contextWindow - a.contextWindow)[0];
    logger.warn(
      { providerId: largest.model.providerId, modelId: largest.model.modelId, contextSize, contextWindow: largest.contextWindow },
      'Context-optimized: no model fits, selecting largest',
    );
    return {
      providerId: largest.model.providerId,
      modelId: largest.model.modelId,
      adapterType: largest.model.providerName,
      score: largest.model.qualityScore,
    };
  }

  const selected = scored[0].model;
  logger.debug(
    { providerId: selected.providerId, modelId: selected.modelId, contextSize, contextWindow: scored[0].contextWindow },
    'Context-optimized routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
