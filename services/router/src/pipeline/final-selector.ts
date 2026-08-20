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
 * Model- and provider-diversity enforcement.
 *
 * The Thompson/epsilon-greedy selectors optimise for the single best arm and
 * naturally re-converge on the highest-reward provider (e.g. mistral) or even
 * a single model on it, leaving other healthy backends idle. To spread real
 * traffic across available backends — so that, say, tencent/google/deepseek
 * receive requests when the dominant provider is busy, and one model cannot
 * hoard its provider's entire budget (e.g. gitlawb's rank-9 free model
 * repeatedly failing) — we cap how large a share any one provider AND any one
 * model may hold of the recent selection window. When the winner exceeds a cap
 * and a candidate outside the over-represented group is available, we pick the
 * best-ranked such candidate instead.
 */
const RECENT_WINDOW = 20;
const MAX_PROVIDER_SHARE = 0.4; // no single provider may hold >40% of recent picks
const MAX_MODEL_SHARE = 0.25; // no single model may hold >25% of recent picks

const recentProviders: string[] = [];
const recentModels: string[] = [];

function recordProvider(providerId: string): void {
  recentProviders.push(providerId);
  if (recentProviders.length > RECENT_WINDOW) recentProviders.shift();
}

function providerShare(providerId: string): number {
  if (recentProviders.length === 0) return 0;
  const count = recentProviders.filter(p => p === providerId).length;
  return count / recentProviders.length;
}

function recordModel(modelId: string): void {
  recentModels.push(modelId);
  if (recentModels.length > RECENT_WINDOW) recentModels.shift();
}

function modelShare(modelId: string): number {
  if (recentModels.length === 0) return 0;
  const count = recentModels.filter(m => m === modelId).length;
  return count / recentModels.length;
}

/**
 * Given the candidate the selector chose, apply model- and provider-diversity:
 * if the chosen model or provider is over-represented in the recent window and
 * a candidate outside that over-represented group exists in the candidate set,
 * prefer the best-ranked such candidate. Model diversity is applied first, then
 * provider diversity; a candidate from a DIFFERENT model AND DIFFERENT provider
 * is ideal, and we degrade gracefully (fixing only the violated cap) when no
 * single candidate satisfies both.
 */
function enforceDiversity(chosen: ProviderModel, candidates: CandidateSet): ProviderModel {
  if (candidates.length < 2) return chosen;

  const modelOver = modelShare(chosen.modelId) > MAX_MODEL_SHARE;
  const providerOver = providerShare(chosen.providerId) > MAX_PROVIDER_SHARE;
  if (!modelOver && !providerOver) return chosen;

  const pickBest = (pool: ProviderModel[]): ProviderModel | null => {
    if (pool.length === 0) return null;
    const sorted = [...pool].sort(
      (a, b) => (b.compositeScore ?? b.qualityScore ?? 0) - (a.compositeScore ?? a.qualityScore ?? 0),
    );
    return sorted[0];
  };

  // Ideal: a candidate outside BOTH over-represented groups at once.
  let pool = candidates;
  if (modelOver) pool = pool.filter(c => c.modelId !== chosen.modelId);
  if (providerOver) pool = pool.filter(c => c.providerId !== chosen.providerId);
  const combined = pickBest(pool);
  if (combined) return combined;

  // Fall back gracefully: fix each violated cap on its own, model first.
  if (modelOver) {
    const differentModel = pickBest(candidates.filter(c => c.modelId !== chosen.modelId));
    if (differentModel) return differentModel;
  }
  if (providerOver) {
    const differentProvider = pickBest(candidates.filter(c => c.providerId !== chosen.providerId));
    if (differentProvider) return differentProvider;
  }

  return chosen;
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
  recordModel(selectedModel.modelId);

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
