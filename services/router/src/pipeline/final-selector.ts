import type { CandidateSet, SelectedProvider, ProviderModel, QualityTarget } from '@dmr-x/core';

export interface SelectorOutput {
  selected: SelectedProvider;
  remaining: CandidateSet;
}

/**
 * Optional Thompson sampler for smarter exploration of free models.
 * When provided and candidates are free models, uses Thompson sampling
 * instead of epsilon-greedy selection.
 */
export interface ThompsonSamplerLike {
  select(candidates: CandidateSet, qualityTarget: QualityTarget): ProviderModel;
}

export function finalSelector(
  candidates: CandidateSet,
  epsilon: number,
  qualityTarget?: QualityTarget,
  thompsonSampler?: ThompsonSamplerLike
): SelectorOutput {
  if (candidates.length === 0) {
    throw new Error('No candidates available for selection');
  }

  // Check if all candidates are free models
  const allFree = candidates.every(c => c.costPerInputToken === 0 && c.costPerOutputToken === 0);

  let selectedModel: ProviderModel;

  // Use Thompson sampling for free models when sampler is available
  if (allFree && thompsonSampler && qualityTarget) {
    selectedModel = thompsonSampler.select(candidates, qualityTarget);
  } else {
    // Epsilon-greedy: with probability epsilon, explore top-3 instead of always picking top-1
    let selectedIndex = 0;
    if (Math.random() < epsilon && candidates.length > 1) {
      selectedIndex = Math.floor(Math.random() * Math.min(3, candidates.length));
    }
    selectedModel = candidates[selectedIndex];
  }

  const remaining = candidates.filter(c => c !== selectedModel);

  return {
    selected: {
      providerId: selectedModel.providerId,
      modelId: selectedModel.modelId,
      adapterType: selectedModel.providerName,
      score: selectedModel.compositeScore ?? selectedModel.qualityScore,
    },
    remaining,
  };
}
