import { useQuery } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Bandit (router score)
// ---------------------------------------------------------------------------

export type { BanditArm, BanditSummary } from '@/types/api';

export function useBanditArms(options?: PollOptions) {
  return useQuery({
    queryKey: [...keys.bandit.all, 'arms'] as const,
    queryFn: () => Admin.listBanditArms(),
    refetchInterval: 30_000,
    ...options,
  });
}

export function useBanditSummary(options?: PollOptions) {
  return useQuery({
    queryKey: [...keys.bandit.all, 'summary'] as const,
    queryFn: () => Admin.getBanditSummary(),
    refetchInterval: 30_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Provider status (health, failures, quota)
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  consecutiveFailures: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  isRateLimited: boolean;
  priority: number;
}

// ---------------------------------------------------------------------------
// Free tier capacity & routing distribution
// ---------------------------------------------------------------------------

export interface RoutingDistribution {
  free: number;
  paid: number;
  cacheHits: number;
  fallbacks: number;
}

export interface FreeTierCapacity {
  provider_name: string;
  model_id: string;
  monthly_token_budget: number;
  tokens_used: number;
  tokens_remaining: number;
  utilization_percent: number;
  rate_limits: { rpm: number | null; rpd: number | null };
  is_rate_limited: boolean;
  predicted_exhaustion_days: number | null;
  reliability_score: number;
}
