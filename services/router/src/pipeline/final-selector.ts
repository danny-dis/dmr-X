import type { CandidateSet, SelectedProvider, ProviderModel, QualityTarget } from '@dmr-x/core';

export interface SelectorOutput {
  selected: SelectedProvider;
  remaining: CandidateSet;
}

/**
 * Optional Thompson sampler for smarter exploration of candidate sets.
 * When provided, uses Thompson (multi-armed bandit) sampling instead of
 * epsilon-greedy selection.
 */
export interface ThompsonSamplerLike {
  select(candidates: CandidateSet, qualityTarget: QualityTarget): ProviderModel;
}

/**
 * Provider-diversity enforcement.
 *
 * The Thompson/epsilon-greedy selectors optimise for the single best arm and
 * naturally re-converge on the highest-reward provider (e.g. mistral), leaving
 * other healthy providers idle. To spread real traffic across available
 * backends — so that, say, tencent/google/deepseek receive requests when the
 * dominant provider is busy — we cap how large a share any one provider may
 * hold of the recent selection window. When the winner exceeds the cap and a
 * different healthy provider is available, we pick the best-ranked candidate
 * from an under-represented provider instead.
 */
const RECENT_WINDOW = 20;
const MAX_PROVIDER_SHARE = 0.4; // no single provider may hold >40% of recent picks

const recentProviders: string[] = [];

function recordProvider(providerId: string): void {
  recentProviders.push(providerId);
  if (recentProviders.length > RECENT_WINDOW) recentProviders.shift();
}

function providerShare(providerId: string): number {
  if (recentProviders.length === 0) return 0;
  const count = recentProviders.filter(p => p === providerId).length;
  return count / recentProviders.length;
}

/**
 * Given the candidate the selector chose, apply provider-diversity: if the
 * chosen provider is over-represented in the recent window and a different
 * provider exists in the candidate set, prefer the best-ranked candidate from
 * an under-represented provider.
 */
function enforceDiversity(chosen: ProviderModel, candidates: CandidateSet): ProviderModel {
  if (candidates.length < 2) return chosen;
  if (providerShare(chosen.providerId) <= MAX_PROVIDER_SHARE) return chosen;

  const otherProviders = candidates.filter(c => c.providerId !== chosen.providerId);
  if (otherProviders.length === 0) return chosen;

  // Pick the highest compositeScore candidate from a different provider.
  otherProviders.sort(
    (a, b) => (b.compositeScore ?? b.qualityScore ?? 0) - (a.compositeScore ?? a.qualityScore ?? 0),
  );
  return otherProviders[0];
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

  // Check if all candidates are from a single provider (explicit provider
  // pin). When the user pins a provider, there's no cross-provider
  // load-balancing benefit — the Thompson sampler would just re-rank by
  // historical reward and can promote a smaller, more reliable arm
  // (e.g. gemma-4-26b-a4b-it) over a better-quality one (e.g.
  // gemini-2.5-flash). Skip the sampler and pick the highest-quality
  // model directly so an explicit pin means "best model on this
  // provider", not "historically most rewardable arm".
  const singleProvider = candidates.every(c => c.providerId === candidates[0].providerId);

  let selectedModel: ProviderModel;

  // Use Thompson sampling for ALL candidate sets when a sampler is available.
  // Previously this was gated on `allFree`, which meant mixed (free + paid)
  // meta-models like `auto` fell through to epsilon-greedy over only the top-3
  // by compositeScore — over-converging on a single provider (e.g. mistral)
  // and leaving other healthy providers idle. Thompson is a multi-armed
  // bandit: it spreads selections across arms in proportion to observed
  // reward, giving every healthy provider real traffic.
  if (!singleProvider && thompsonSampler && qualityTarget) {
    selectedModel = thompsonSampler.select(candidates, qualityTarget);
  } else {
    // Epsilon-greedy: with probability epsilon, explore top-3 instead of always picking top-1
    let selectedIndex = 0;
    if (Math.random() < epsilon && candidates.length > 1) {
      // Uniformly pick from top-3 (not biased toward index 0)
      const explorePool = Math.min(3, candidates.length);
      selectedIndex = Math.floor(Math.random() * explorePool);
    }
    selectedModel = candidates[selectedIndex];
  }

  // Spread traffic across providers so no single backend is starved.
  selectedModel = enforceDiversity(selectedModel, candidates);

  recordProvider(selectedModel.providerId);

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
