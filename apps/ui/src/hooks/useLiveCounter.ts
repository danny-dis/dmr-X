import { useEffect, useMemo } from 'react';

import { useLiveUsage, type UsageWindow } from '@/lib/queries/usage';
import { useLiveStore } from '@/store/useLiveStore';

export interface LiveCounter {
  tokens: number;
  requests: number;
  /** Paid side only: actual spend. */
  costUsd: number;
  /** Free side only: counterfactual cost avoided. */
  costAvoidedUsd: number;
  /** How the cost-avoided figure was derived, for display next to it. */
  basis: { method: string; referenceModels: Array<{ model: string }>; warning: string | null } | null;
  windowStart: string | null;
  isLoading: boolean;
  isLive: boolean;
  error: Error | null;
}

/**
 * Live token counter for one tier.
 *
 * Seeded from `/admin/usage/live` and incremented from `usage_delta` SSE
 * frames, so the number moves as traffic arrives instead of waiting for the
 * next poll. The seed query still refetches slowly as a safety net for a
 * dropped stream.
 *
 * Increments are reset whenever the seed changes, since a fresh seed already
 * includes everything the deltas counted.
 */
export function useLiveCounter(tier: 'free' | 'paid', window: UsageWindow = '24h'): LiveCounter {
  const { data, isLoading, error, dataUpdatedAt } = useLiveUsage(window);
  const counters = useLiveStore((s) => s.counters);
  const connection = useLiveStore((s) => s.connection);
  const resetCounters = useLiveStore((s) => s.resetCounters);

  // A new seed subsumes the deltas accumulated against the old one.
  useEffect(() => {
    if (dataUpdatedAt) resetCounters();
  }, [dataUpdatedAt, resetCounters]);

  return useMemo(() => {
    const seedFree = data?.free ?? { tokens: 0, requests: 0 };
    const seedPaid = data?.paid ?? { tokens: 0, requests: 0, costUsd: 0 };

    if (tier === 'free') {
      return {
        tokens: seedFree.tokens + counters.freeTokens,
        requests: seedFree.requests + counters.freeRequests,
        costUsd: 0,
        costAvoidedUsd: data?.costAvoidedUsd ?? 0,
        basis: data?.savingsBasis ?? null,
        windowStart: data?.windowStart ?? null,
        isLoading,
        isLive: connection === 'open',
        error: (error as Error) ?? null,
      };
    }

    return {
      tokens: seedPaid.tokens + counters.paidTokens,
      requests: seedPaid.requests + counters.paidRequests,
      costUsd: seedPaid.costUsd + counters.paidCostUsd,
      costAvoidedUsd: 0,
      basis: null,
      windowStart: data?.windowStart ?? null,
      isLoading,
      isLive: connection === 'open',
      error: (error as Error) ?? null,
    };
  }, [tier, data, counters, connection, isLoading, error]);
}
