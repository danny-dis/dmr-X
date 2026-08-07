import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// Agents (Agent-as-a-Service)
// ---------------------------------------------------------------------------
//
// Wire types are snake_case where the server sends snake_case and camelCase
// where it sends camelCase — the agent registry serialises camelCase, the
// admin routes serialise snake_case. Rather than a normalisation layer that
// leaked both shapes into components, each module declares exactly what its
// endpoints return.

export interface AgentDefinition {
  id: string;
  tenantId: string;
  name: string;
  humanName?: string | null;
  description: string | null;
  version: string;
  systemPrompt: string | null;
  personality: string | null;
  preferredModel: string | null;
  modelTier: string;
  allowedTools: string[];
  customTools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>;
  workflow: Record<string, unknown> | null;
  triggers: Array<Record<string, unknown>>;
  visibility: string;
  tags: string[];
  category: string | null;
  icon: string | null;
  skills?: string[];
  skillNudgeInterval?: number;
  verifyOnStop?: boolean;
  planMode?: boolean;
  historyCompaction?: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstanceDetail {
  id: string;
  agentDefinitionId: string;
  tenantId: string;
  status: 'active' | 'paused' | string;
  configOverride: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  definitionName: string | null;
  definitionHumanName: string | null;
  definitionDescription: string | null;
  definitionCategory: string | null;
  definitionIcon: string | null;
  definitionModelTier: string | null;
  executionCount: number;
  lastExecutionAt: string | null;
  costCents24h: number;
}

export interface AgentExecution {
  id: string;
  agentInstanceId: string;
  input: string | null;
  output: string | null;
  toolsUsed: string[];
  modelUsed: string | null;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface AgentSessionStep {
  conversationId: string;
  turn: number;
  status: string | null;
  budgetStatus: string | null;
  allowedToolCalls: string[];
  blockedToolCalls: string[];
  toolResults: unknown[];
  tokenDelta: number;
  costDelta: number;
  createdAt: string | null;
}

export interface AgentCostAnalytics {
  from: string;
  to: string;
  totals: { executions: number; inputTokens: number; outputTokens: number; costUsd: number; errorCount: number };
  items: Array<{
    agentDefinitionId: string | null;
    agentName: string | null;
    instanceCount: number;
    executions: number;
    successCount: number;
    errorCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    avgDurationMs: number;
    lastExecutionAt: string | null;
  }>;
}

export interface Skill {
  id: string;
  name: string;
  description?: string | null;
  content?: string;
  pinned?: boolean;
  createdAt?: string;
}

// ── Queries ────────────────────────────────────────────────────────────────

// `page`/`limit` must be passed explicitly: the server defaults `limit` to 20
// (AgentListQuerySchema), so omitting it silently caps the list at 20 rows
// while still reporting the true `total`.
export function useAgents(
  query: {
    search?: string;
    category?: string;
    visibility?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  return useQuery({
    queryKey: keys.agents.list(query),
    queryFn: () => api<{ items: AgentDefinition[]; total: number }>('/agents', { query }),
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: keys.agents.detail(id ?? ''),
    queryFn: () => api<AgentDefinition>(`/agents/${id}`),
    enabled: !!id,
  });
}

/**
 * Tenant-wide deployed instances.
 *
 * Hits `/agents/instances`, which had to be added — the previous UI called it
 * but only `/agents/:id/instances` existed, so the request matched
 * `GET /agents/:id` with `id="instances"` and 404'd.
 */
export function useAgentInstances(status?: 'active' | 'paused') {
  return useQuery({
    queryKey: keys.agents.instances(status),
    queryFn: () =>
      api<{ items: AgentInstanceDetail[]; total: number }>('/agents/instances', {
        query: status ? { status } : undefined,
      }),
    // Instances carry a live status and a 24h cost rollup, so they go stale
    // faster than definitions.
    staleTime: 10_000,
  });
}

export function useAgentInstancesFor(agentId: string | undefined) {
  return useQuery({
    queryKey: keys.agents.instancesFor(agentId ?? ''),
    queryFn: () => api<{ items: AgentInstanceDetail[]; total: number }>(`/agents/${agentId}/instances`),
    enabled: !!agentId,
  });
}

export function useAgentExecutions(instanceId: string | undefined) {
  return useQuery({
    queryKey: keys.agents.executions(instanceId ?? ''),
    queryFn: () => api<AgentExecution[]>(`/instances/${instanceId}/executions`),
    enabled: !!instanceId,
  });
}

/** Per-turn run trace from `session_steps`. */
export function useAgentSteps(instanceId: string | undefined, conversationId?: string) {
  return useQuery({
    queryKey: keys.agents.steps(instanceId ?? '', conversationId),
    queryFn: () =>
      api<{ items: AgentSessionStep[]; total: number }>(`/instances/${instanceId}/steps`, {
        query: conversationId ? { conversationId } : undefined,
      }),
    enabled: !!instanceId,
  });
}

export function useAgentAnalytics(from?: string, to?: string) {
  return useQuery({
    queryKey: keys.agents.analytics(from, to),
    queryFn: () =>
      api<AgentCostAnalytics>('/agents/analytics/costs', {
        query: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      }),
  });
}

export function useSkills() {
  return useQuery({
    queryKey: keys.agents.skills(),
    queryFn: () => api<{ items: Skill[]; total: number }>('/skills'),
  });
}

export interface MarketplaceListing {
  id: string;
  title: string;
  description: string | null;
  longDescription: string | null;
  category: string | null;
  tags: string[];
  icon: string | null;
  rating: number;
  ratingCount: number;
  installCount: number;
  priceCents: number;
  status: string;
  createdAt: string;
}

/** `/marketplace` is mounted under the `/v1` prefix on the gateway (see
 * `agentRoutes` registration in server.ts) — every call here needs that
 * prefix even though the route file itself declares bare `/marketplace`. */
export function useMarketplace(query: { search?: string; category?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.agents.marketplace(query),
    queryFn: () => api<{ items: MarketplaceListing[]; total: number }>('/v1/marketplace', { query }),
  });
}

export function useInstallMarketplaceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ success: boolean }>(`/v1/marketplace/${id}/install`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.agents.all }),
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Invalidate the whole agents subtree.
 *
 * Deploying, pausing or editing changes what several views show at once
 * (the grid's instance count, the instances tab, the analytics rollup), so
 * these all invalidate broadly rather than surgically. The queries are cheap
 * and correctness beats shaving a refetch.
 */
function useAgentInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.agents.all });
}

export function useCreateAgent() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: (body: Partial<AgentDefinition>) => api<AgentDefinition>('/agents', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateAgent() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<AgentDefinition>) =>
      api<AgentDefinition>(`/agents/${id}`, { method: 'PUT', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteAgent() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDeployAgent() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<AgentInstanceDetail>(`/agents/${id}/deploy`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
}

export function useDeleteInstance() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: (instanceId: string) => api<void>(`/instances/${instanceId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/** Pause/resume. Paused instances stop being dispatch candidates. */
export function useSetInstanceRunning() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: ({ instanceId, running }: { instanceId: string; running: boolean }) =>
      api<AgentInstanceDetail>(`/instances/${instanceId}/${running ? 'resume' : 'pause'}`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
}

export function usePublishAgent() {
  const invalidate = useAgentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/agents/${id}/publish`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
}
