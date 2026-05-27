import type {
  TaskProfile,
  CandidateSet,
  ProviderModel,
  RoutingPlan,
  SelectedProvider,
  FallbackStep,
  FreeTierStrategy,
} from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import type { PolicyService } from '@dmr-x/policy';
import { capabilityFilter } from './capability-filter.js';
import { availabilityFilter } from './availability-filter.js';
import { rateLimitFilter } from './rate-limit-filter.js';
import { costLatencyScorer } from './cost-latency-scorer.js';
import { finalSelector } from './final-selector.js';

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
}

export interface PipelineOutput {
  selected: SelectedProvider;
  chain: FallbackStep[];
  scoredCandidates: CandidateSet;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { taskProfile, candidates, epsilon = 0.05, rateLimitService, quotaService, policyService, tenantId, estimatedTokens = 0, freeTierStrategy = 'none' } = input;

  // Stage 1: Capability Filter
  let filtered = capabilityFilter(candidates, taskProfile.capabilities, taskProfile.modality);

  // Stage 2: Availability Filter
  filtered = availabilityFilter(filtered);

  // Stage 3: Rate-Limit Filter (filters candidates that would exceed free-tier limits)
  if (rateLimitService) {
    filtered = await rateLimitFilter(filtered, rateLimitService, estimatedTokens);
  }

  // Stage 4: Policy Filter
  if (policyService && tenantId) {
    filtered = await policyService.filterByPolicy(filtered, tenantId, taskProfile);
  }

  // Stage 5: Quota Filter
  if (quotaService && tenantId) {
    filtered = await quotaService.filterByQuota(filtered, tenantId);
  }

  if (filtered.length === 0) {
    throw new Error('No available providers after filtering');
  }

  // Stage 6: Cost/Latency Scoring (with penalty awareness)
  let scored = costLatencyScorer(filtered, taskProfile.qualityTarget, rateLimitService);

  // Stage 6.5: Apply free-tier strategy
  if (freeTierStrategy !== 'none') {
    scored = applyFreeTierStrategy(scored, freeTierStrategy, rateLimitService);
  }

  // Stage 7: Final Selection
  const { selected, remaining } = finalSelector(scored, epsilon);

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
  primary: SelectedProvider
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
      // Spread traffic across all candidates (free + paid) weighted by health + free bonus
      if (scored.length === 0) return scored;
      if (scored.length === 1) return scored;

      // Free models get a 2x weight bonus to encourage free usage, all weighted by inverse penalty
      const weighted = scored.map((m) => {
        const penalty = rateLimitService?.getPenaltyPoints(m.providerId, m.modelId) ?? 0;
        const freeBonus = isFreeModel(m) ? 2 : 1;
        return { model: m, weight: freeBonus / (1 + penalty) };
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
      const rest = weighted.filter((_, i) => i !== primaryIdx).map((w) => w.model);
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
