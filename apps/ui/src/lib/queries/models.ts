import { useQuery } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiModel } from '@/types/api';

// ---------------------------------------------------------------------------
// Models & classifications
// ---------------------------------------------------------------------------

export function useModels(query?: { available_only?: string }, options?: PollOptions) {
  return useQuery({
    queryKey: [...keys.models.list(), query ?? {}],
    queryFn: () => Admin.listModels(query),
    ...options,
  });
}

export type PricingTier = 'free' | 'free_with_limits' | 'paid' | 'subscription_only' | 'unknown';

export interface ModelClassification {
  providerId: string;
  modelId: string;
  pricingTier: PricingTier;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  hasFreeTier?: boolean;
  verifiedFree?: boolean;
  lastVerification?: string | null;
  source?: string;
}

export interface ModelClassificationsResponse {
  total: number;
  byTier: Record<PricingTier, number>;
  classifications: ModelClassification[];
}

/**
 * Pricing-tier classifications for every catalog model.
 *
 * `/admin/models` doesn't carry a `pricing_tier` column — `model_profiles`
 * has none — so the tier for a given row has to be looked up here by
 * `provider_id:model_id` (see `useModelPricingTier` below). This query is
 * the byTier counts source for the Models page and the free/paid split.
 */
export function useModelClassifications() {
  return useQuery({
    queryKey: keys.models.classifications(),
    queryFn: () => Admin.getModelClassifications() as Promise<ModelClassificationsResponse>,
    staleTime: 60_000,
  });
}

/**
 * Build a `provider_id:model_id` -> pricing tier lookup from the
 * classifications list, matching the key shape the gateway itself uses
 * (see `getFreeModels()` in services/registry).
 */
export function buildPricingTierIndex(
  classifications: ModelClassification[] | undefined,
): Map<string, PricingTier> {
  const map = new Map<string, PricingTier>();
  for (const c of classifications ?? []) {
    map.set(`${c.providerId}:${c.modelId}`, c.pricingTier);
  }
  return map;
}

export function resolvePricingTier(
  model: ApiModel,
  index: Map<string, PricingTier>,
): PricingTier {
  const direct = (model as ApiModel & { pricing_tier?: PricingTier }).pricing_tier;
  if (direct && direct !== 'unknown') return direct;
  const modelId = model.model_id ?? model.modelId ?? '';
  const key = `${model.provider_id}:${modelId}`;
  return index.get(key) ?? direct ?? 'unknown';
}
