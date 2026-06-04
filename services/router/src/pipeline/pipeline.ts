import type {
  TaskProfile,
  CandidateSet,
  ProviderModel,
  SelectedProvider,
  FallbackStep,
  FreeTierStrategy,
  ProviderPreferences,
} from '@dmr-x/core';
import { ProviderUnavailableError } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import type { PolicyService } from '@dmr-x/policy';
import { capabilityFilter } from './capability-filter.js';
import { availabilityFilter } from './availability-filter.js';
import { rateLimitFilter } from './rate-limit-filter.js';
import type { RateLimitFilterResult } from './rate-limit-filter.js';
import { costLatencyScorer } from './cost-latency-scorer.js';
import { finalSelector, type ThompsonSamplerLike } from './final-selector.js';
import { resolveProviderSlug } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

export interface PipelineInput {
  taskProfile: TaskProfile;
  candidates: CandidateSet;
  tenantPolicies?: string[];
  epsilon?: number; // exploration rate for epsilon-greedy
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  policyService?: PolicyService;
  tenantId?: string;
  estimatedTokens?: number;
  freeTierStrategy?: FreeTierStrategy;
  providerPreferences?: ProviderPreferences;
  retryWithWait?: boolean;
  maxWaitMs?: number;
  /** When true, candidates are already filtered to free-only by meta-model resolution */
  metaModelFilteredFree?: boolean;
  /** Optional Thompson sampler for smarter exploration of free models */
  thompsonSampler?: ThompsonSamplerLike;
}

export interface PipelineOutput {
  selected: SelectedProvider;
  chain: FallbackStep[];
  scoredCandidates: CandidateSet;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { taskProfile, candidates, epsilon = 0.05, rateLimitService, quotaService, policyService, tenantId, estimatedTokens = 0, freeTierStrategy = 'none', providerPreferences, metaModelFilteredFree, thompsonSampler } = input;

  // Stage 1: Capability Filter
  let filtered = capabilityFilter(candidates, taskProfile.capabilities, taskProfile.modality);

  // Stage 1.5: Provider Preference Filter
  if (providerPreferences) {
    filtered = applyProviderPreferences(filtered, providerPreferences);
  }

  // Stage 2: Availability Filter
  filtered = availabilityFilter(filtered);

  // Save pre-rate-limit candidates for retry logic
  const preRateLimitCandidates = [...filtered];

  // Stage 3: Rate-Limit Filter (filters candidates that would exceed free-tier limits)
  let rateLimitResult: RateLimitFilterResult | undefined;
  if (rateLimitService) {
    rateLimitResult = await rateLimitFilter(filtered, rateLimitService, estimatedTokens);
    filtered = rateLimitResult.allowed;
  }

  // Stage 4: Policy Filter
  if (policyService && tenantId) {
    filtered = await policyService.filterByPolicy(filtered, tenantId, taskProfile);
  }

  // Stage 5: Quota Filter
  if (quotaService && tenantId) {
    filtered = await quotaService.filterByQuota(filtered, tenantId);
  }

  // Retry-with-wait: if all providers are rate-limited and wait is short, retry after reset
  if (filtered.length === 0 && input.retryWithWait !== false && rateLimitResult && rateLimitResult.earliestResetMs > 0) {
    const maxWait = input.maxWaitMs ?? 3000;
    const waitMs = Math.min(rateLimitResult.earliestResetMs, maxWait);
    if (waitMs > 0) {
      logger.info({ waitMs, rateLimitedCount: rateLimitResult.rateLimited.length }, 'All providers rate-limited, waiting for reset');
      await new Promise(resolve => setTimeout(resolve, waitMs));
      // Re-run rate-limit + policy + quota with candidates that existed before rate-limit filtering
      const recheck = await rateLimitFilter(preRateLimitCandidates, rateLimitService!, estimatedTokens);
      filtered = recheck.allowed;
      // Re-apply policy filter
      if (policyService && tenantId) {
        filtered = await policyService.filterByPolicy(filtered, tenantId, taskProfile);
      }
      // Re-apply quota filter
      if (quotaService && tenantId) {
        filtered = await quotaService.filterByQuota(filtered, tenantId);
      }
    }
  }

  if (filtered.length === 0) {
    const tried = candidates.map(c => `${c.providerId}/${c.modelId}`);
    // Convert earliestResetMs to seconds for ProviderUnavailableError
    const retryAfterSeconds = rateLimitResult?.earliestResetMs ? Math.ceil(rateLimitResult.earliestResetMs / 1000) : 30;
    throw new ProviderUnavailableError(tried, retryAfterSeconds);
  }

  // Determine sort strategy from preferences or quality target
  const sortStrategy = providerPreferences?.sort;

  // Stage 6: Cost/Latency Scoring (with penalty awareness and sort preference)
  let scored = costLatencyScorer(filtered, taskProfile.qualityTarget, rateLimitService, sortStrategy);

  // Stage 6.5: Apply free-tier strategy (skip if meta-model already filtered to free-only)
  if (freeTierStrategy !== 'none' && !metaModelFilteredFree) {
    scored = applyFreeTierStrategy(scored, freeTierStrategy, rateLimitService);
  }

  // Stage 6.6: Apply provider order preference (re-sort by user's preferred order)
  if (providerPreferences?.order && providerPreferences.order.length > 0) {
    scored = applyProviderOrder(scored, providerPreferences.order);
  }

  // Stage 7: Final Selection
  const { selected, remaining } = finalSelector(scored, epsilon, taskProfile.qualityTarget, thompsonSampler);

  // Build fallback chain from remaining candidates
  const chain = buildFallbackChain(remaining, selected);

  return {
    selected,
    chain,
    scoredCandidates: scored,
  };
}

function buildFallbackChain(
  remaining: ProviderModel[],
  _primary: SelectedProvider
): FallbackStep[] {
  return remaining.slice(0, 3).map((model, index) => ({
    provider: {
      providerId: model.providerId,
      modelId: model.modelId,
      adapterType: model.providerName, // Will be resolved to adapter type
      score: model.qualityScore,
    },
    trigger: index === 0 ? 'timeout' as const : 'error' as const,
    waitMs: index === 0 ? 1000 : 0,
  }));
}

/**
 * Filter candidates based on provider preferences (only/ignore lists, max price, quantization, ZDR).
 */
function applyProviderPreferences(
  candidates: CandidateSet,
  prefs: ProviderPreferences,
): CandidateSet {
  let result = candidates;

  // When strategy is 'free', filter to zero-cost models only
  if (prefs.strategy === 'free') {
    result = result.filter((m) => (m.costPerInputToken ?? 0) === 0 && (m.costPerOutputToken ?? 0) === 0);
  }

  // Filter by `only` list (whitelist)
  if (prefs.only && prefs.only.length > 0) {
    const allowedSlugs = new Set(prefs.only.map(resolveProviderSlug));
    result = result.filter((m) => allowedSlugs.has(resolveProviderSlug(m.providerId)));
  }

  // Filter by `ignore` list (blocklist) - only if `only` is not set
  if (!prefs.only && prefs.ignore && prefs.ignore.length > 0) {
    const ignoredSlugs = new Set(prefs.ignore.map(resolveProviderSlug));
    result = result.filter((m) => !ignoredSlugs.has(resolveProviderSlug(m.providerId)));
  }

  // Filter by max price
  if (prefs.maxPricePerMillionTokens !== undefined) {
    const maxPrice = prefs.maxPricePerMillionTokens;
    result = result.filter((m) => {
      const totalCost = (m.costPerInputToken + m.costPerOutputToken) * 1_000_000;
      return totalCost <= maxPrice;
    });
  }

  // Filter by quantization
  if (prefs.quantizations && prefs.quantizations.length > 0) {
    const allowed = new Set(prefs.quantizations);
    result = result.filter((m) => {
      if (!m.quantization) return true; // allow unknown quantization
      return allowed.has(m.quantization);
    });
  }

  // Filter by max latency
  if (prefs.preferredMaxLatencyMs !== undefined) {
    const maxLatency = prefs.preferredMaxLatencyMs;
    result = result.filter((m) => {
      if (!m.avgLatencyMs) return true; // allow unknown latency
      return m.avgLatencyMs <= maxLatency;
    });
  }

  // Filter by min throughput (tokens/sec) — uses p50 from throughputPercentiles
  if (prefs.preferredMinThroughputTps !== undefined) {
    const minThroughput = prefs.preferredMinThroughputTps;
    result = result.filter((m) => {
      const tps = m.throughputPercentiles?.p50;
      if (tps === undefined) return true; // allow unknown throughput
      return tps >= minThroughput;
    });
  }

  // Filter by required parameters
  if (prefs.requireParameters) {
    // This is a soft filter - models without parameter info are kept
    // The adapter will handle unsupported params gracefully
  }

  return result;
}

/**
 * Re-sort scored candidates to prioritize user's preferred provider order.
 * Providers in the order list get boosted to the top while preserving relative composite scores within groups.
 */
function applyProviderOrder(scored: CandidateSet, order: string[]): CandidateSet {
  const orderSlugs = order.map(resolveProviderSlug);
  const orderIndex = new Map(orderSlugs.map((slug, i) => [slug, i]));

  return [...scored].sort((a, b) => {
    const aIdx = orderIndex.get(resolveProviderSlug(a.providerId));
    const bIdx = orderIndex.get(resolveProviderSlug(b.providerId));

    // Both in order list: sort by order position
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    // Only one in order list: it goes first
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    // Neither in order list: preserve composite score order
    return ((b as any).compositeScore ?? 0) - ((a as any).compositeScore ?? 0);
  });
}

function isFreeModel(model: ProviderModel): boolean {
  return (model.costPerInputToken ?? 0) === 0 && (model.costPerOutputToken ?? 0) === 0;
}

function applyFreeTierStrategy(
  scored: CandidateSet,
  strategy: FreeTierStrategy,
  rateLimitService?: RateLimitService
): CandidateSet {
  const free = scored.filter(isFreeModel);
  const paid = scored.filter((m) => !isFreeModel(m));

  switch (strategy) {
    case 'prioritize': {
      // Free models first (sorted by score), then paid as fallback
      return [...free, ...paid];
    }

    case 'load_balance': {
      // Spread traffic across all candidates (free + paid) weighted by health + free bonus + headroom
      if (scored.length === 0) return scored;
      if (scored.length === 1) return scored;

      // Free models get a 2x weight bonus to encourage free usage, all weighted by inverse penalty + headroom
      const weighted = scored.map((m) => {
        const penalty = rateLimitService?.getPenaltyPoints(m.providerId, m.modelId) ?? 0;
        const freeBonus = isFreeModel(m) ? 2 : 1;
        let headroomBonus = 0;
        if (rateLimitService) {
          const state = rateLimitService.getState(m.providerId, m.modelId);
          // Compute multi-dimensional headroom from RPM, TPM, RPD, TPD
          const headroomDimensions: number[] = [];
          if (state.config.rpm && state.config.rpm > 0) {
            headroomDimensions.push(Math.max(0, (state.config.rpm - state.currentRPM) / state.config.rpm));
          }
          if (state.config.tpm && state.config.tpm > 0) {
            headroomDimensions.push(Math.max(0, (state.config.tpm - state.currentTPM) / state.config.tpm));
          }
          if (state.config.rpd && state.config.rpd > 0) {
            headroomDimensions.push(Math.max(0, (state.config.rpd - state.currentRPD) / state.config.rpd));
          }
          if (state.config.tpd && state.config.tpd > 0) {
            headroomDimensions.push(Math.max(0, (state.config.tpd - state.currentTPD) / state.config.tpd));
          }
          if (headroomDimensions.length > 0) {
            const avgHeadroom = headroomDimensions.reduce((s, h) => s + h, 0) / headroomDimensions.length;
            headroomBonus = avgHeadroom * 2; // 0-2 bonus based on average headroom
          }
        }
        return { model: m, weight: (freeBonus + headroomBonus) / (1 + penalty) };
      });
      const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

      // Weighted random pick for primary
      let roll = Math.random() * totalWeight;
      let primaryIdx = 0;
      for (let i = 0; i < weighted.length; i++) {
        roll -= weighted[i].weight;
        if (roll <= 0) { primaryIdx = i; break; }
      }

      const primary = weighted[primaryIdx].model;
      // Smart fallback: sort remaining by same weight formula
      const rest = weighted
        .filter((_, i) => i !== primaryIdx)
        .sort((a, b) => b.weight - a.weight)
        .map((w) => w.model);
      return [primary, ...rest];
    }

    case 'fallback': {
      // Paid first (sorted by score), free models as fallback
      return [...paid, ...free];
    }

    default:
      return scored;
  }
}
