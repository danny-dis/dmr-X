import { create } from 'zustand';

import type { ApiTelemetryEvent, ApiRouteDecision, ApiAlert } from '@/types/api';

/**
 * Live data pushed from the gateway's SSE streams.
 *
 * The previous version of this store had the right ring buffers and was
 * written to by nothing — every page polled instead, so Observability ran a 3s
 * interval and the dashboard six more. One subscription in the app shell now
 * feeds this store and pages read from it.
 */

/** One completed request, used to increment the live token counters. */
export interface UsageDelta {
  tier: 'free' | 'paid';
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  error: boolean;
  at: number;
}

export interface DashboardStats {
  total_requests: number;
  success_rate: number;
  avg_latency: number;
  token_usage: number;
  daily_spend: number;
  quota_remaining: number;
  active_models: number;
  provider_health: number;
  fallback_rate: number;
  worker_utilization: number;
  system_status: string;
}

/** Totals accumulated from `usage_delta` frames since the last seed. */
export interface CounterState {
  freeTokens: number;
  freeRequests: number;
  paidTokens: number;
  paidRequests: number;
  paidCostUsd: number;
}

const EMPTY_COUNTERS: CounterState = {
  freeTokens: 0,
  freeRequests: 0,
  paidTokens: 0,
  paidRequests: 0,
  paidCostUsd: 0,
};

const MAX_EVENTS = 500;

export interface LiveTelemetryState {
  connection: 'connecting' | 'open' | 'closed';
  stats: DashboardStats | null;
  events: ApiTelemetryEvent[];
  decisions: ApiRouteDecision[];
  alerts: ApiAlert[];
  deltas: UsageDelta[];
  counters: CounterState;
  rate: number;
  lastEventAt: number | null;
  paused: boolean;

  setConnection: (status: LiveTelemetryState['connection']) => void;
  setStats: (stats: DashboardStats) => void;
  pushTelemetry: (e: ApiTelemetryEvent) => void;
  pushDecision: (d: ApiRouteDecision) => void;
  pushAlert: (a: ApiAlert) => void;
  pushDelta: (d: UsageDelta) => void;
  /**
   * Clear accumulated increments.
   *
   * Called whenever the counter seed is refetched or the window changes —
   * without it, deltas counted before the new seed would be added twice.
   */
  resetCounters: () => void;
  setRate: (rate: number) => void;
  clear: () => void;
  setPaused: (v: boolean) => void;
}

export const useLiveStore = create<LiveTelemetryState>((set) => ({
  connection: 'closed',
  stats: null,
  events: [],
  decisions: [],
  alerts: [],
  deltas: [],
  counters: { ...EMPTY_COUNTERS },
  rate: 0,
  lastEventAt: null,
  paused: false,

  setConnection: (connection) => set({ connection }),
  setStats: (stats) => set({ stats }),

  pushTelemetry: (e) =>
    set((s) =>
      s.paused
        ? s
        : {
            events: [e, ...s.events].slice(0, MAX_EVENTS),
            lastEventAt: Date.now(),
          },
    ),
  pushDecision: (d) =>
    set((s) => (s.paused ? s : { decisions: [d, ...s.decisions].slice(0, 200) })),
  pushAlert: (a) =>
    set((s) => (s.paused ? s : { alerts: [a, ...s.alerts].slice(0, 100) })),

  pushDelta: (d) =>
    set((s) => {
      if (s.paused) return s;
      const counters = { ...s.counters };
      const tokens = d.tokensIn + d.tokensOut;
      if (d.tier === 'free') {
        counters.freeTokens += tokens;
        counters.freeRequests += 1;
      } else {
        counters.paidTokens += tokens;
        counters.paidRequests += 1;
        counters.paidCostUsd += d.costUsd;
      }
      // Bounded: an unbounded log is a memory leak on a tab left open
      // overnight.
      return { deltas: [d, ...s.deltas].slice(0, 200), counters, lastEventAt: Date.now() };
    }),

  resetCounters: () => set({ counters: { ...EMPTY_COUNTERS } }),
  setRate: (rate) => set({ rate }),
  clear: () => set({ events: [], decisions: [], deltas: [], lastEventAt: null }),
  setPaused: (paused) => set({ paused }),
}));
