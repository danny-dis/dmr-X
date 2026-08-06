import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Usage, free tier and savings
// ---------------------------------------------------------------------------

export type UsageWindow = '1h' | '24h' | '7d' | '30d';

export interface SavingsBasis {
  method: string;
  referenceModels: Array<{
    capabilityTier: string;
    model: string;
    inputCostPer1k: number;
    outputCostPer1k: number;
  }>;
  /** Non-null when there is no paid model to price against. */
  warning: string | null;
}

export interface LiveUsage {
  window: UsageWindow;
  windowStart: string;
  free: { tokens: number; requests: number };
  paid: { tokens: number; requests: number; costUsd: number };
  costAvoidedUsd: number;
  savingsBasis: SavingsBasis;
}

export interface SavingsRow {
  providerId: string;
  providerName: string | null;
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costAvoidedUsd: number;
  referenceModel: string | null;
}

export interface Savings {
  periodDays: number;
  from: string;
  to: string;
  costAvoidedUsd: number;
  freeRequests: number;
  freeTokens: number;
  byProvider: SavingsRow[];
  byModel: SavingsRow[];
  daily: Array<{ date: string; costAvoidedUsd: number; tokens: number; requests: number }>;
  basis: SavingsBasis;
}

export interface FreeTierSummary {
  summary: {
    total_monthly_budget: number;
    total_free_models: number;
    healthy_free_providers: number;
    estimated_tokens_saved: number;
    cost_avoided_usd: number;
    savings_basis: SavingsBasis;
  };
  providers: Array<{
    provider_name: string;
    total_monthly_budget: number;
    is_healthy: boolean;
    models: Array<{
      model_id: string;
      monthly_token_budget: number;
      intelligence_rank: number | null;
      speed_rank: number | null;
      rate_limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null };
    }>;
  }>;
  recent_usage: Array<{
    selected_provider: string;
    selected_model: string;
    total_tokens: number;
    total_requests: number;
  }>;
}

/**
 * Seed for the live token counters.
 *
 * The counters increment from `usage_delta` frames on the dashboard SSE
 * stream; this supplies the starting totals for the window. Polling is a slow
 * safety net for a dropped stream, not the primary path.
 */
export function useLiveUsage(window: UsageWindow = '24h') {
  return useQuery({
    queryKey: keys.usage.live(window),
    queryFn: () => api<LiveUsage>('/admin/usage/live', { query: { window } }),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
}

export function useSavings(days = 30) {
  return useQuery({
    queryKey: keys.freeTier.savings(days),
    queryFn: () => api<Savings>('/admin/free-tier/savings', { query: { days } }),
  });
}

export function useFreeTierSummary() {
  return useQuery({
    queryKey: keys.freeTier.summary(),
    queryFn: () => api<FreeTierSummary>('/admin/free-tier/summary'),
  });
}

export interface CostDashboard {
  period: { start: string; end: string };
  totalCost: number;
  freeTierCost: number;
  paidCost: number;
  costSavings: number;
  savingsBasis: SavingsBasis;
  byProvider: Record<string, { cost: number; requests: number; tokens: number; freePercent: number }>;
  byTenant: Array<{
    tenantId: string;
    tenantName: string;
    totalCost: number;
    freeTierCost: number;
    paidCost: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>;
  dailyCosts: Array<{ date: string; cost: number; free_cost: number; paid_cost: number }>;
}

export function useCostDashboard(days = 30, options?: PollOptions) {
  return useQuery({
    queryKey: keys.usage.cost(days),
    queryFn: () => api<CostDashboard>('/admin/cost/dashboard', { query: { days } }),
    ...options,
  });
}

/**
 * Per-key traffic distribution.
 *
 * `balance` is min/max selections across a provider's key pool: 1.0 is even,
 * near 0 means one key is carrying everything. A key with zero selections is
 * the silent failure mode of a multi-key setup — configured but never used.
 */
export interface KeyRotationPool {
  providerId: string;
  providerName: string;
  totalSelections: number;
  keysUsed: number;
  balance: number;
  keys: Array<{ keyId: string; label?: string; tier?: string; selections: number }>;
}

export function useKeyRotation() {
  return useQuery({
    queryKey: keys.providers.keyRotation(),
    queryFn: () => api<{ pools: KeyRotationPool[] }>('/admin/key-rotation'),
  });
}

// ── Free-model discovery ───────────────────────────────────────────────────

export interface DiscoverResult {
  provider: string;
  discovered: number;
  inserted: number;
  models: Array<{ id: string; name: string; modality: string; contextWindow: number; cost: { input: number; output: number } }>;
}

export interface VerifyBatchResult {
  provider: string;
  freeCount: number;
  paidCount: number;
  errorCount: number;
  results: Array<{ modelId: string; isActuallyFree: boolean; error?: string }>;
}

/**
 * Discover a provider's models from its stored key, then classify which are
 * genuinely free.
 *
 * Both endpoints already existed and were called by nothing, which is why a
 * free key entered in the UI never resulted in routable free models. Chained
 * here because discovery without verification leaves every model classified
 * from a catalog that is often stale.
 */
export function useDiscoverProviderModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const discovered = await api<DiscoverResult>(`/admin/providers/${providerId}/discover`, {
        method: 'POST',
        body: {},
        // Discovery walks the provider's whole model list; the 30s default is
        // not enough for the larger catalogues.
        timeoutMs: 120_000,
      });

      let verified: VerifyBatchResult | null = null;
      let verifyError: string | null = null;
      try {
        verified = await api<VerifyBatchResult>(`/admin/providers/${providerId}/verify-free-batch`, {
          method: 'POST',
          body: {},
          timeoutMs: 180_000,
        });
      } catch (err) {
        // Verification sends a probe request per model and can hit the
        // provider's rate limit. Discovery already succeeded and its result is
        // useful on its own, so surface the partial outcome instead of
        // failing the whole flow.
        verifyError = err instanceof Error ? err.message : String(err);
      }

      return { discovered, verified, verifyError };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.models.all });
      qc.invalidateQueries({ queryKey: keys.freeTier.all });
      qc.invalidateQueries({ queryKey: keys.providers.all });
    },
  });
}
