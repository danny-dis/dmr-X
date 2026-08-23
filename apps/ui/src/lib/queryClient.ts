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
    toolSearch: () => [...keys.mcp.all, 'tool-search'] as const,
    guardrails: () => [...keys.mcp.all, 'guardrails'] as const,
    audit: () => [...keys.mcp.all, 'audit'] as const,
    rbac: () => [...keys.mcp.all, 'rbac'] as const,
    federationConfig: () => [...keys.mcp.all, 'federation-config'] as const,
    federationPeers: () => [...keys.mcp.all, 'federation-peers'] as const,
    aggregation: () => [...keys.mcp.all, 'aggregation'] as const,
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

  tenants: {
    all: ['tenants'] as const,
    list: () => [...keys.tenants.all, 'list'] as const,
  },

  apiKeys: {
    all: ['api-keys'] as const,
    list: () => [...keys.apiKeys.all, 'list'] as const,
  },

  quota: {
    all: ['quota'] as const,
    byTenant: (tenantId: string) => [...keys.quota.all, tenantId] as const,
  },

  billing: {
    all: ['billing'] as const,
    summary: (period?: string) => [...keys.billing.all, 'summary', period ?? ''] as const,
  },

  policies: {
    all: ['policies'] as const,
    list: () => [...keys.policies.all, 'list'] as const,
  },

  fusionPanels: {
    all: ['fusion-panels'] as const,
    list: () => [...keys.fusionPanels.all, 'list'] as const,
  },

  benchmarks: {
    all: ['benchmarks'] as const,
    leaderboard: () => [...keys.benchmarks.all, 'leaderboard'] as const,
    battles: () => [...keys.benchmarks.all, 'battles'] as const,
    history: () => [...keys.benchmarks.all, 'history'] as const,
    models: () => [...keys.benchmarks.all, 'models'] as const,
    validations: () => [...keys.benchmarks.all, 'validations'] as const,
    modelStats: (modelId: string) => [...keys.benchmarks.all, 'model-stats', modelId] as const,
    modelHistory: (modelId: string) => [...keys.benchmarks.all, 'model-history', modelId] as const,
  },

  sandbox: {
    all: ['sandbox'] as const,
    jobs: () => [...keys.sandbox.all, 'jobs'] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: (status?: string) => [...keys.jobs.all, 'list', status ?? 'any'] as const,
    tasks: (id: string) => [...keys.jobs.all, 'tasks', id] as const,
  },

  workers: {
    all: ['workers'] as const,
    list: () => [...keys.workers.all, 'list'] as const,
    jobs: (id?: string) => [...keys.workers.all, 'jobs', id ?? 'all'] as const,
  },

  settings: {
    all: ['settings'] as const,
  },

  federation: {
    all: ['federation'] as const,
    list: () => [...keys.federation.all, 'list'] as const,
  },

  credits: {
    all: ['credits'] as const,
    balance: () => [...keys.credits.all, 'balance'] as const,
    transactions: (opts?: Record<string, unknown>) => [...keys.credits.all, 'transactions', opts ?? {}] as const,
  },

  memory: {
    all: ['memory'] as const,
    list: () => [...keys.memory.all, 'list'] as const,
    stats: () => [...keys.memory.all, 'stats'] as const,
  },

  compression: {
    all: ['compression'] as const,
    config: () => [...keys.compression.all, 'config'] as const,
    stats: () => [...keys.compression.all, 'stats'] as const,
  },

  integrations: {
    all: ['integrations'] as const,
    config: () => [...keys.integrations.all, 'config'] as const,
  },

  godmode: {
    all: ['godmode'] as const,
    serverStatus: () => [...keys.godmode.all, 'server-status'] as const,
    serverConfig: () => [...keys.godmode.all, 'server-config'] as const,
    serverUpdates: () => [...keys.godmode.all, 'server-updates'] as const,
  },

  conversations: {
    all: ['conversations'] as const,
    list: () => [...keys.conversations.all, 'list'] as const,
  },

  needle: {
    all: ['needle'] as const,
    status: () => [...keys.needle.all, 'status'] as const,
  },
} as const;
