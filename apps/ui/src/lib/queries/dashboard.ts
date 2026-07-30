import { useQuery } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
//
// The primary path for live numbers is the SSE `stats` frame the gateway
// pushes on `/admin/dashboard/stream`, written into `useLiveStore` by the one
// subscription mounted in the app shell. These queries are the slow-poll
// fallback: they paint real numbers before the stream connects and keep the
// page correct if it drops.

export function useDashboardStats() {
  return useQuery({
    queryKey: keys.dashboard.stats(),
    queryFn: () => Admin.dashboard(),
    refetchInterval: 30_000,
  });
}

export function useRouteDecisions(limit = 8, options?: PollOptions) {
  return useQuery({
    queryKey: [...keys.dashboard.all, 'decisions', limit] as const,
    queryFn: () => Admin.listRouteDecisions({ limit }),
    refetchInterval: 30_000,
    ...options,
  });
}

/** Time-bucketed usage history — shared by Dashboard, Routing (traffic
 * composition) and Usage (cost-over-time), each polling at its own cadence. */
export function useUsageHistory(granularity: string = 'hour', options?: PollOptions) {
  return useQuery({
    queryKey: keys.usage.history(granularity),
    queryFn: () => Admin.getUsage(granularity),
    refetchInterval: 30_000,
    ...options,
  });
}
