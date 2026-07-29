import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

/**
 * Shared query client.
 *
 * Replaces `hooks/useApiData`, which held no cache and ran one independent
 * polling loop per call site — the Dashboard alone fired six concurrent
 * intervals, and two pages showing the same providers each fetched them
 * separately. A single client gives dedupe, shared cache and explicit
 * invalidation instead.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Admin data is not real-time. Serving it from cache for 30s while
      // revalidating keeps navigation instant without showing stale numbers.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // 4xx means the request was wrong; repeating it will not help, and
        // retrying a 401 three times just multiplies the audit-log noise.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Query key factories.
 *
 * Centralised so invalidation can target a subtree — invalidating
 * `keys.agents.all` refreshes lists, detail and instances together, which is
 * what "I just deployed an agent" should do.
 */
export const keys = {
  health: ['health'] as const,

  dashboard: {
    all: ['dashboard'] as const,
    stats: () => [...keys.dashboard.all, 'stats'] as const,
    alerts: () => [...keys.dashboard.all, 'alerts'] as const,
  },

  usage: {
    all: ['usage'] as const,
    live: (window: string) => [...keys.usage.all, 'live', window] as const,
    history: (granularity: string) => [...keys.usage.all, 'history', granularity] as const,
    cost: (days: number) => [...keys.usage.all, 'cost', days] as const,
  },

  providers: {
    all: ['providers'] as const,
    list: () => [...keys.providers.all, 'list'] as const,
    detail: (id: string) => [...keys.providers.all, 'detail', id] as const,
    catalog: () => [...keys.providers.all, 'catalog'] as const,
    keyRotation: () => [...keys.providers.all, 'key-rotation'] as const,
  },

  models: {
    all: ['models'] as const,
    list: () => [...keys.models.all, 'list'] as const,
    free: () => [...keys.models.all, 'free'] as const,
    classifications: () => [...keys.models.all, 'classifications'] as const,
  },

  freeTier: {
    all: ['free-tier'] as const,
    summary: () => [...keys.freeTier.all, 'summary'] as const,
    savings: (days: number) => [...keys.freeTier.all, 'savings', days] as const,
  },

  agents: {
    all: ['agents'] as const,
    list: (query?: Record<string, unknown>) => [...keys.agents.all, 'list', query ?? {}] as const,
    detail: (id: string) => [...keys.agents.all, 'detail', id] as const,
    instances: (status?: string) => [...keys.agents.all, 'instances', status ?? 'any'] as const,
    instancesFor: (id: string) => [...keys.agents.all, 'instances-for', id] as const,
    executions: (instanceId: string) => [...keys.agents.all, 'executions', instanceId] as const,
    steps: (instanceId: string, conversationId?: string) =>
      [...keys.agents.all, 'steps', instanceId, conversationId ?? 'all'] as const,
    analytics: (from?: string, to?: string) => [...keys.agents.all, 'analytics', from ?? '', to ?? ''] as const,
    skills: () => [...keys.agents.all, 'skills'] as const,
    marketplace: (query?: Record<string, unknown>) => [...keys.agents.all, 'marketplace', query ?? {}] as const,
  },

  mcp: {
    all: ['mcp'] as const,
    servers: () => [...keys.mcp.all, 'servers'] as const,
    catalog: () => [...keys.mcp.all, 'catalog'] as const,
    tools: () => [...keys.mcp.all, 'tools'] as const,
    status: () => [...keys.mcp.all, 'status'] as const,
    config: () => [...keys.mcp.all, 'config'] as const,
  },

  a2a: {
    all: ['a2a'] as const,
    status: () => [...keys.a2a.all, 'status'] as const,
    agentCard: () => [...keys.a2a.all, 'agent-card'] as const,
    config: () => [...keys.a2a.all, 'config'] as const,
    tasks: (state?: string) => [...keys.a2a.all, 'tasks', state ?? 'any'] as const,
  },

  observability: {
    all: ['observability'] as const,
    telemetry: () => [...keys.observability.all, 'telemetry'] as const,
    audit: () => [...keys.observability.all, 'audit'] as const,
    routing: () => [...keys.observability.all, 'routing'] as const,
  },
} as const;
