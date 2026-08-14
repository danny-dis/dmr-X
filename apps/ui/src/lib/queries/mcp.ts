import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { api } from '../api';
import { keys } from '../queryClient';

import type {
  ApiMcpAggregatedServer,
  ApiMcpAuditConfig,
  ApiMcpFederationConfig,
  ApiMcpFederationPeer,
  ApiMcpGuardrailsConfig,
  ApiMcpToolSearchConfig,
  ApiRbacPolicy,
} from '@/types/api';

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  /** Values are redacted server-side; only the keys are meaningful here. */
  env?: Record<string, string>;
  url?: string;
  apiKey?: string;
  enabled?: boolean;
  status: 'connected' | 'disconnected' | 'disabled';
  toolCount: number;
  connectedAt: string | null;
  tools: McpTool[];
  circuitBreaker: { state: string; failures: number; lastFailure?: string | null } | null;
}

export interface McpCatalogEnvVar {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv: McpCatalogEnvVar[];
  docsUrl?: string;
  official?: boolean;
}

export interface McpTestResult {
  ok: boolean;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  errorMessage?: string;
  latencyMs: number;
}

/** Shape accepted by add/update/test. */
export interface McpServerInput {
  id?: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  allowedTools?: string[];
  enabled?: boolean;
}

// ── Queries ────────────────────────────────────────────────────────────────

export function useMcpServers() {
  return useQuery({
    queryKey: keys.mcp.servers(),
    queryFn: () => api<{ servers: McpServer[]; total: number }>('/admin/mcp/servers'),
    // Status here is a live connection state, not configuration.
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function useMcpCatalog() {
  return useQuery({
    queryKey: keys.mcp.catalog(),
    queryFn: () =>
      api<{ categories: Record<string, string>; entries: McpCatalogEntry[] }>('/admin/mcp/catalog'),
    // Ships with the build; it cannot change without a redeploy.
    staleTime: Infinity,
  });
}

export function useMcpTools() {
  return useQuery({
    queryKey: keys.mcp.tools(),
    queryFn: () =>
      api<{
        tools: Array<{ serverId: string; serverName: string; toolName: string; description?: string }>;
        total: number;
      }>('/admin/mcp/servers/tools'),
  });
}

/** First-party sidecar status — distinct from the aggregated upstreams above. */
export function useMcpStatus() {
  return useQuery({
    queryKey: keys.mcp.status(),
    queryFn: () =>
      api<{
        available: boolean | null;
        transport: string;
        host: string;
        port: number;
        hasApiKey: boolean;
        uptime?: number;
        tools: Array<{ name: string; description?: string }>;
      }>('/admin/mcp/status'),
    refetchInterval: 30_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

function useMcpInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.mcp.all });
}

/**
 * Dry-run a config without saving.
 *
 * Deliberately a mutation rather than a query: it has a side effect (it
 * connects to the upstream, which for stdio spawns a process) and must run
 * only when the operator asks, never on render or refocus.
 */
export function useTestMcpServer() {
  return useMutation({
    mutationFn: (body: McpServerInput) => api<McpTestResult>('/admin/mcp/servers/test', { method: 'POST', body }),
  });
}

export function useAddMcpServer() {
  const invalidate = useMcpInvalidation();
  return useMutation({
    mutationFn: ({ skipTest, ...body }: McpServerInput & { skipTest?: boolean }) =>
      api<McpServer>('/admin/mcp/servers', {
        method: 'POST',
        body,
        query: skipTest ? { skipTest: 'true' } : undefined,
      }),
    onSuccess: invalidate,
  });
}

export function useInstallMcpServer() {
  const invalidate = useMcpInvalidation();
  return useMutation({
    mutationFn: (body: { catalogId: string; name?: string; values: Record<string, string> }) =>
      api<McpServer>('/admin/mcp/servers/install', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateMcpServer() {
  const invalidate = useMcpInvalidation();
  return useMutation({
    mutationFn: ({ id, skipTest, ...body }: McpServerInput & { id: string; skipTest?: boolean }) =>
      api<McpServer>(`/admin/mcp/servers/${id}`, {
        method: 'PUT',
        body,
        query: skipTest ? { skipTest: 'true' } : undefined,
      }),
    onSuccess: invalidate,
  });
}

export function useRefreshMcpServer() {
  const invalidate = useMcpInvalidation();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; status: string; toolCount: number; reconnected: boolean }>(
        `/admin/mcp/servers/${id}/refresh`,
        { method: 'POST', body: {} },
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteMcpServer() {
  const invalidate = useMcpInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/mcp/servers/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Tool search
// ---------------------------------------------------------------------------

export function useToolSearchConfig() {
  return useQuery({
    queryKey: keys.mcp.toolSearch(),
    queryFn: () => Admin.getToolSearchConfig(),
  });
}

export function useUpdateToolSearchConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiMcpToolSearchConfig) => Admin.updateToolSearchConfig({ ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mcp.toolSearch() }),
  });
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export function useGuardrailsConfig() {
  return useQuery({
    queryKey: keys.mcp.guardrails(),
    queryFn: () => Admin.getGuardrailsConfig(),
  });
}

export function useUpdateGuardrailsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiMcpGuardrailsConfig) => Admin.updateGuardrailsConfig({ ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mcp.guardrails() }),
  });
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export function useAuditConfig() {
  return useQuery({
    queryKey: keys.mcp.audit(),
    queryFn: () => Admin.getAuditConfig(),
  });
}

export function useUpdateAuditConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiMcpAuditConfig) => Admin.updateAuditConfig({ ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mcp.audit() }),
  });
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export function useRbacPolicies() {
  return useQuery({
    queryKey: keys.mcp.rbac(),
    queryFn: () => Admin.listRbacPolicies(),
  });
}

function useRbacInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.mcp.rbac() });
}

export function useCreateRbacPolicy() {
  const invalidate = useRbacInvalidation();
  return useMutation({
    mutationFn: (body: Omit<ApiRbacPolicy, 'id'> & { id?: string }) => Admin.createRbacPolicy(body),
    onSuccess: invalidate,
  });
}

export function useDeleteRbacPolicy() {
  const invalidate = useRbacInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.deleteRbacPolicy(id),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

export function useMcpFederationConfig() {
  return useQuery({
    queryKey: keys.mcp.federationConfig(),
    queryFn: () => Admin.getFederationConfig(),
  });
}

export function useUpdateMcpFederationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => Admin.updateFederationConfig(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mcp.federationConfig() }),
  });
}

export function useMcpFederationPeers() {
  return useQuery({
    queryKey: keys.mcp.federationPeers(),
    queryFn: () => Admin.listFederationPeers(),
  });
}

function useMcpFederationPeersInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.mcp.federationPeers() });
}

export function useAddMcpFederationPeer() {
  const invalidate = useMcpFederationPeersInvalidation();
  return useMutation({
    mutationFn: (body: { name: string; endpoint: string; secretRef?: string }) => Admin.addFederationPeer(body),
    onSuccess: invalidate,
  });
}

export function useRemoveMcpFederationPeer() {
  const invalidate = useMcpFederationPeersInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.removeFederationPeer(id),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function useAggregatedServers() {
  return useQuery({
    queryKey: keys.mcp.aggregation(),
    queryFn: () => Admin.listAggregatedServers() as Promise<ApiMcpAggregatedServer[]>,
  });
}

function useAggregationInvalidation() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.mcp.aggregation() });
}

export function useAddAggregatedServer() {
  const invalidate = useAggregationInvalidation();
  return useMutation({
    mutationFn: (body: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[] }) =>
      Admin.addAggregatedServer(body),
    onSuccess: invalidate,
  });
}

export function useRemoveAggregatedServer() {
  const invalidate = useAggregationInvalidation();
  return useMutation({
    mutationFn: (id: string) => Admin.removeAggregatedServer(id),
    onSuccess: invalidate,
  });
}

// Re-exported so components importing peer/server types get everything from
// one module. `ApiMcpFederationConfig` is used only as this hook's return
// type today.
export type { ApiMcpFederationConfig, ApiMcpFederationPeer };
