import { api, apiGet, apiPost, apiPut, apiDelete, getTokenForPath } from './api';

import type {
  ApiProvider,
  ApiModel,
  ApiTenant,
  ApiKey,
  ApiRouteDecision,
  ApiQuotaState,
  ApiBillingSummary,
  ApiUsagePoint,
  ApiAlert,
  ApiAuditEvent,
  ApiTelemetryEvent,
  ApiBenchmarkResult,
  ApiPolicyRule,
  ApiMemoryItem,
  ApiMemoryCreate,
  ApiSandboxJob,
  ApiWorker,
  ApiWorkerRegister,
  ApiFederationNode,
  ApiDashboardStats,
  ApiCatalogEntry,
  ApiHealthResponse,
  ApiMcpStatus,
  ApiMcpTool,
  ApiMcpToolExecute,
  ApiMcpToolResult,
  ApiProviderTestResult,
  ApiProviderOAuthStart,
  ApiMemorySearch,
  ApiBenchmarkRun,
  ApiSandboxSubmit,
  ApiFederationRegister,
  ApiRerankResult,
  ApiMcpConfig,
  ApiRbacPolicy,
  ApiMcpFederationPeer,
  ApiMcpAggregatedServer,
} from '@/types/api';


// ----------------------------------------------------------------------------
// Wire-format transforms
//
// The admin API returns snake_case (matching DB column names). Components and
// store code read camelCase aliases. These tiny mappers ensure the runtime
// shape matches the TypeScript types so `provider.adapterType` etc. don't
// silently return `undefined`.
//
// Kept intentionally narrow — only the fields the UI actually consumes.
// ----------------------------------------------------------------------------

function toCamelProvider(p: ApiProvider): ApiProvider {
  return {
    ...p,
    adapterType: p.adapterType ?? p.adapter_type,
    baseUrl: p.baseUrl ?? p.base_url ?? null,
    apiKeyRef: p.apiKeyRef ?? p.api_key_ref ?? null,
    tier: p.tier,
    keys: p.keys,
  };
}

function toCamelModel(m: ApiModel): ApiModel {
  const providerName = m.providerName ?? m.provider_name;
  return {
    ...m,
    providerId: m.providerId ?? m.provider_id,
    provider: m.provider ?? providerName,
    providerName,
    // Surface the upstream model identifier as a camelCase field too. Without
    // this, callers that read `m.modelId` after listing models get `undefined`
    // and the playground silently sends the row UUID — which the router
    // can't match against any candidate and the request 500s.
    modelId: m.modelId ?? m.model_id,
    displayName: m.displayName ?? m.display_name,
    intelligenceLayer: m.intelligenceLayer ?? m.intelligence_layer,
    capabilityTier: m.capabilityTier ?? m.capability_tier,
    contextWindow: m.contextWindow ?? m.context_window,
    maxOutputTokens: m.maxOutputTokens ?? m.max_output_tokens,
    inputCostPer1k: m.inputCostPer1k ?? m.input_cost_per_1k,
    outputCostPer1k: m.outputCostPer1k ?? m.output_cost_per_1k,
    costPerImage: m.costPerImage ?? m.cost_per_image,
    qualityScore: m.qualityScore ?? m.quality_score,
    supportsStreaming: m.supportsStreaming ?? m.supports_streaming,
    supportsVision: m.supportsVision ?? m.supports_vision,
    supportsToolUse: m.supportsToolUse ?? m.supports_tool_use,
    supportsReasoning: m.supportsReasoning ?? m.supports_reasoning,
    supportsFunctionCall: m.supportsFunctionCall ?? m.supports_function_call,
    isActive: m.isActive ?? m.is_active,
    createdAt: m.createdAt ?? m.created_at,
  };
}

function toCamelTenant(t: ApiTenant): ApiTenant {
  return {
    ...t,
    tokensLimit: t.tokensLimit ?? t.tokens_limit,
    requestsLimit: t.requestsLimit ?? t.requests_limit,
    costLimit: t.costLimit ?? t.cost_limit,
    createdAt: t.createdAt ?? t.created_at,
  };
}

export const Admin = {
  // Health & dashboard
  health: () => apiGet<ApiHealthResponse>('/health'),
  dashboard: () => apiGet<ApiDashboardStats>('/admin/dashboard/stats').then(normalizeDashboard),

  // MCP server status. The MCP server is a separate process — the gateway
  // reports its env-derived config and probes the MCP server's /health
  // endpoint when reachable. `available: null` means the server runs in
  // stdio mode (per-client child process) and can't be probed from here.
  getMcpStatus: () => apiGet<ApiMcpStatus>('/admin/mcp/status'),

  // Providers
  listProviders: async (): Promise<ApiProvider[]> => {
    const res = await apiGet<ApiProvider[] | { providers: ApiProvider[] }>('/admin/providers');
    const list = Array.isArray(res) ? res : (res as { providers?: ApiProvider[] })?.providers ?? [];
    return list.map(toCamelProvider);
  },
  getProvider: async (id: string): Promise<ApiProvider> => {
    const p = await apiGet<ApiProvider>(`/admin/providers/${id}`);
    return toCamelProvider(p);
  },
  createProvider: (body: Partial<ApiProvider> & { tier?: 'free' | 'paid' }) =>
    apiPost<ApiProvider>('/admin/providers', {
      name: body.name,
      adapter_type: body.adapterType ?? body.adapter_type,
      base_url: body.baseUrl ?? body.base_url,
      api_key_ref: body.apiKeyRef ?? body.api_key_ref,
      config: body.config ?? {},
      tier: body.tier,
    }),
  activateProvider: (body: {
    template_id: string;
    api_key?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    oauth_token_expires_at?: string;
    auth_method?: 'api_key' | 'oauth';
    name?: string;
    tier?: 'free' | 'paid';
  }) => apiPost<{ success: boolean; provider: ApiProvider }>('/admin/providers/activate', body),
  updateProvider: (id: string, body: Partial<ApiProvider>) =>
    apiPut<ApiProvider>(`/admin/providers/${id}`, {
      name: body.name,
      adapter_type: body.adapterType ?? body.adapter_type,
      base_url: body.baseUrl ?? body.base_url ?? null,
      api_key_ref: body.apiKeyRef ?? body.api_key_ref ?? null,
      auth_method: body.authMethod,
      region: (body as any).region ?? null,
      priority: (body as any).priority,
      enabled: (body as any).enabled,
      config: body.config ?? {},
    }),
  updateProviderApiKey: (id: string, apiKey: string, options?: { tier?: 'free' | 'paid' }) =>
    apiPut<{ success: boolean; provider: ApiProvider }>(`/admin/providers/${id}/api-key`, {
      api_key: apiKey,
      tier: options?.tier,
    }),

  // ----------------------------------------------------------------
  // Per-key management
  //
  // The activate / api-key endpoints always touch the "Default" key.
  // These endpoints manage additional keys (e.g. a free + a paid key
  // for the same Google upstream). The provider detail drawer calls
  // them when the user clicks "Add another key" or rotates an
  // existing key.
  // ----------------------------------------------------------------
  listProviderKeys: async (id: string) => {
    const res = await apiGet<{ keys?: ApiProvider['keys'] } | ApiProvider['keys']>(
      `/admin/providers/${id}/keys`,
    );
    if (Array.isArray(res)) return res;
    return res?.keys ?? [];
  },
  addProviderKey: (
    id: string,
    body: {
      label?: string;
      tier: 'free' | 'paid';
      api_key?: string;
      oauth_access_token?: string;
      oauth_refresh_token?: string;
      oauth_token_expires_at?: string;
      auth_method?: 'api_key' | 'oauth';
      priority?: number;
    },
  ) =>
    apiPost<{ success: boolean; key: NonNullable<ApiProvider['keys']>[number] }>(
      `/admin/providers/${id}/keys`,
      body,
    ),
  rotateProviderKey: (
    id: string,
    keyId: string,
    body: {
      label?: string;
      tier?: 'free' | 'paid';
      api_key?: string;
      oauth_access_token?: string;
      oauth_refresh_token?: string;
      oauth_token_expires_at?: string;
      auth_method?: 'api_key' | 'oauth';
      priority?: number;
      is_active?: boolean;
    },
  ) =>
    apiPut<{ success: boolean; key: NonNullable<ApiProvider['keys']>[number] }>(
      `/admin/providers/${id}/keys/${keyId}`,
      body,
    ),
  removeProviderKey: (id: string, keyId: string) =>
    apiDelete<{ success: boolean }>(`/admin/providers/${id}/keys/${keyId}`),

  deleteProvider: (id: string) => apiDelete<{ ok: true }>(`/admin/providers/${id}`),
  testProvider: (id: string) => apiPost<ApiProviderTestResult>('/admin/providers/test', { provider_id: id }).then(normalizeProviderTestResult),
  startProviderOAuth: (id: string) =>
    apiPost<ApiProviderOAuthStart>(`/admin/providers/${id}/oauth/authorize`),
  completeProviderOAuth: (id: string, code: string, state: string) =>
    apiPost<ApiProvider>(`/admin/providers/${id}/oauth/callback`, { code, state }),
  refreshProviderOAuth: (id: string) =>
    apiPost<{ success: boolean; expiresAt?: string | null }>(`/admin/providers/${id}/oauth/refresh`),
  getProviderOAuthStatus: (id: string) =>
    apiGet<{ hasOAuth: boolean; authMethod: string; tokenExpiresAt: string | null; isExpired: boolean; oauthFlow: string | null }>(
      `/admin/providers/${id}/oauth/status`,
    ),
  pollProviderOAuthDeviceCode: (id: string, deviceCode: string) =>
    apiPost<{ success: boolean; status: string; expiresAt?: string | null }>(
      `/admin/providers/${id}/oauth/device-code/poll`,
      { device_code: deviceCode },
    ),

  // Models
  listModels: async (query?: { providerId?: string; modality?: string; available_only?: string }): Promise<ApiModel[]> => {
    const res = await apiGet<ApiModel[] | { models: ApiModel[] }>('/admin/models', query);
    const list = Array.isArray(res) ? res : (res as { models?: ApiModel[] })?.models ?? [];
    return list.map(toCamelModel);
  },
  getModel: async (id: string): Promise<ApiModel> => {
    const m = await apiGet<ApiModel>(`/admin/models/${id}`);
    return toCamelModel(m);
  },
  createModel: (body: Partial<ApiModel>) => apiPost<ApiModel>('/admin/models', body),
  updateModel: (id: string, body: Partial<ApiModel>) => apiPut<ApiModel>(`/admin/models/${id}`, body),
  deleteModel: (id: string) => apiDelete<{ ok: true }>(`/admin/models/${id}`),

  // Tenants & API keys
  listTenants: async (): Promise<ApiTenant[]> => {
    const res = await apiGet<ApiTenant[] | { tenants: ApiTenant[] }>('/admin/tenants');
    const list = Array.isArray(res) ? res : (res as { tenants?: ApiTenant[] })?.tenants ?? [];
    return list.map(toCamelTenant);
  },
  getTenant: async (id: string): Promise<ApiTenant> => {
    const t = await apiGet<ApiTenant>(`/admin/tenants/${id}`);
    return toCamelTenant(t);
  },
  createTenant: (body: Partial<ApiTenant>) => apiPost<ApiTenant>('/admin/tenants', body),
  updateTenant: (id: string, body: Partial<ApiTenant>) =>
    apiPut<ApiTenant>(`/admin/tenants/${id}`, body),
  deleteTenant: (id: string) => apiDelete<{ ok: true }>(`/admin/tenants/${id}`),
  listApiKeys: async () => {
    const res = await apiGet<ApiKey[] | { api_keys: ApiKey[] }>('/admin/api-keys');
    if (!res) return [];
    const raw = Array.isArray(res) ? res : res.api_keys ?? [];
    // Wire shape: { id, tenant_id, tenant_name, name, is_active, created_at, last_used_at }.
    // The list response intentionally omits the plaintext key (only `key_hash` is stored).
    return raw.map((k) => ({
      id: k.id,
      name: k.name,
      tenant_id: k.tenant_id,
      tenant_name: k.tenant_name,
      scopes: (() => {
        const raw = (k as any).scopes;
        if (!raw) return undefined;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : undefined;
          } catch {
            return undefined;
          }
        }
        return undefined;
      })(),
      is_active: k.is_active,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
      // List responses don't include the plaintext key; only the create response does.
      // Drop the field so downstream components can treat its absence as "key hidden".
      key: k.key && k.key.length > 0 ? k.key : undefined,
    }));
  },
  createApiKey: (body: { tenant_id: string; name?: string; scopes?: string[]; allowed_tools?: string[] }) =>
    apiPost<ApiKey & { key: string }>('/admin/api-keys', body),
  revokeApiKey: (id: string) =>
    apiDelete<{ ok: true }>(`/admin/api-keys/${id}`),

  // MCP Tools
  listMcpTools: () => apiGet<{ tools: ApiMcpTool[] }>('/admin/mcp/tools').then(r => r.tools),
  executeMcpTool: (body: ApiMcpToolExecute) =>
    apiPost<ApiMcpToolResult>('/admin/mcp/tools/execute', body),

  // API Key Tool Restrictions
  getApiKeyTools: (id: string) =>
    apiGet<{ allowed_tools: string[] }>(`/admin/api-keys/${id}/tools`).then(r => r.allowed_tools),
  setApiKeyTools: (id: string, allowed_tools: string[]) =>
    apiPut<{ allowed_tools: string[] }>(`/admin/api-keys/${id}/tools`, { allowed_tools }),

// Routing & quota
  listRouteDecisions: (query?: { limit?: number }) =>
    apiGet<{ decisions: ApiRouteDecision[] }>('/admin/routing/decisions', query).then(r => r.decisions),
  getQuota: (tenantId?: string) => apiGet<{ quotas: ApiQuotaState[] }>('/admin/quota', { tenant_id: tenantId }).then(r => r.quotas),

  // Billing & usage
  getBilling: (period?: string) =>
    apiGet<ApiBillingSummary>('/admin/billing/summary', { period }),
  getUsage: (granularity?: string) =>
    apiGet<{ history: ApiUsagePoint[] }>('/admin/billing/usage-history', { granularity }).then(r => ({
      points: r.history.map(normalizeUsagePoint),
      total: r.history.length,
    })),

  // Observability
  listAlerts: () =>
    apiGet<{ alerts: ApiAlert[] }>('/admin/alerts').then(r => r.alerts.map(normalizeAlert)),
  // Alerts are currently derived from transient state and are not persistent.
  // TODO: Implement backend persistence for alert acknowledgment/resolution.
  acknowledgeAlert: (id: string) =>
    apiPost<ApiAlert>(`/admin/alerts/${id}/ack`),
  resolveAlert: (id: string) =>
    apiPost<ApiAlert>(`/admin/alerts/${id}/resolve`),
  listAudit: () =>
    apiGet<{ events: ApiAuditEvent[] }>('/admin/audit/events').then(r => r.events.map(normalizeAuditEvent)),
  listTelemetry: () =>
    apiGet<{ events: ApiTelemetryEvent[] }>('/admin/telemetry/events').then(r => r.events.map(normalizeTelemetryEvent)),
  streamTelemetry: async (signal: AbortSignal, onEvent: (e: ApiTelemetryEvent) => void) => {
    const token = getTokenForPath('/admin/telemetry/stream');
    const url = buildSseUrl(token ? `/admin/telemetry/stream?token=${token}` : '/admin/telemetry/stream');

    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
      },
      signal,
    });

    if (!res.ok || !res.body) throw new Error('Failed to connect to telemetry stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              onEvent(normalizeTelemetryEvent(JSON.parse(line.slice(6))));
            } catch {
              // ignore invalid JSON
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Telemetry stream error:', err);
      }
    }
  },

  streamDashboardStats: async (signal: AbortSignal, onStats: (stats: Record<string, unknown>) => void) => {
    const token = getTokenForPath('/admin/dashboard/stream');
    const url = buildSseUrl(token ? `/admin/dashboard/stream?token=${token}` : '/admin/dashboard/stream');

    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
      },
      signal,
    });

    if (!res.ok || !res.body) throw new Error('Failed to connect to dashboard stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              onStats(JSON.parse(line.slice(6)));
            } catch {
              // ignore invalid JSON
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Dashboard stream error:', err);
      }
    }
  },

  // Benchmarks
  runBenchmark: (body: ApiBenchmarkRun) => apiPost<{ status: string; message: string }>('/admin/benchmarks/run', body),
  getLeaderboard: () => apiGet<{ leaderboard: any[] }>('/admin/benchmarks/leaderboard').then(r => r.leaderboard),
  getBattles: () => apiGet<{ battles: any[] }>('/admin/benchmarks/battles').then(r => r.battles),
  runArenaBattle: (modelA: string, modelB: string) => apiPost('/admin/benchmarks/battle', { modelA, modelB }),
  submitFeedback: (feedback: any) => apiPost('/admin/playground/feedback', feedback),
  // Batch add messages
  batchAddMessages: (conversationId: string, messages: any[]) =>
    apiPost<{ success: boolean; count: number }>(`/conversations/${conversationId}/messages/batch`, {
      messages,
    }),

  // Policies
  listPolicies: () => apiGet<{ policies: ApiPolicyRule[] }>('/admin/policies').then(r => r.policies ?? []),
  upsertPolicy: (body: Partial<ApiPolicyRule>) => apiPost<ApiPolicyRule>('/admin/policies', body),
  updatePolicy: (id: string, body: Partial<ApiPolicyRule>) =>
    apiPut<ApiPolicyRule>(`/admin/policies/${id}`, body),
  deletePolicy: (id: string) => apiDelete<{ ok: true }>(`/admin/policies/${id}`),


  // Memory
  searchMemory: (body: ApiMemorySearch) => apiPost<ApiMemoryItem[]>('/admin/memory/search', body),
  listMemory: (query?: { tenantId?: string; limit?: number }) =>
    apiGet<{ items: ApiMemoryItem[] }>('/admin/memory', query).then(r => r.items ?? []),
  createMemory: (body: ApiMemoryCreate) => apiPost<ApiMemoryItem>('/admin/memory', body),
  deleteMemory: (id: string) => apiDelete<{ ok: true }>(`/admin/memory/${id}`),
  getMemoryStats: () => apiGet<{
    total_items?: number;
    by_namespace?: Record<string, number>;
    by_source?: Record<string, number>;
    oldest_item?: string;
    newest_item?: string;
    retention_days?: number;
  }>('/admin/memory/stats'),

  // Sandbox
  listSandboxJobs: () => apiGet<{ jobs: ApiSandboxJob[] }>('/admin/sandbox/jobs').then(r => r.jobs ?? []),
  submitSandbox: (body: ApiSandboxSubmit) => apiPost<ApiSandboxJob>('/admin/sandbox/jobs', body),
  cancelSandbox: (id: string) => apiPost<{ ok: true }>(`/admin/sandbox/jobs/${id}/cancel`),

  // Workers
  listWorkers: () => apiGet<{ workers: ApiWorker[] }>('/admin/workers').then(r => r.workers ?? []),
  registerWorker: (body: ApiWorkerRegister) => apiPost<ApiWorker>('/admin/workers', body),
  drainWorker: (id: string) => apiPost<ApiWorker>(`/admin/workers/${id}/drain`),
  resumeWorker: (id: string) => apiPost<ApiWorker>(`/admin/workers/${id}/resume`),
  cleanupWorkers: (daysToKeep?: number) =>
    apiPost<{ ok: true }>('/admin/workers/cleanup', { daysToKeep: daysToKeep ?? 30 }),
  listWorkerJobs: (id?: string) =>
    id
      ? apiGet<{ jobs: ApiWorkerJob[] }>(`/admin/workers/${id}/jobs`).then(r => r.jobs ?? [])
      : apiGet<{ jobs: ApiWorkerJob[] }>('/admin/jobs').then(r => r.jobs ?? []),

  // Federation
  listFederation: () => apiGet<{ nodes: ApiFederationNode[] }>('/admin/federation').then(r => r.nodes ?? []),
  registerFederation: (body: ApiFederationRegister) =>
    apiPost<ApiFederationNode>('/admin/federation', body),
  unregisterFederation: (id: string) =>
    apiDelete<{ ok: true }>(`/admin/federation/${id}`),
  healthCheckFederation: (id: string) => apiPost<ApiFederationNode>(`/admin/federation/${id}/health`),
  syncFederationBenchmark: (id: string) => apiPost<{ ok: boolean }>(`/admin/federation/${id}/sync`),

  // Catalog
  getCatalog: async (query?: { category?: string; query?: string }) => {
    const res = await apiGet<{ entries?: ApiCatalogEntry[]; catalog?: ApiCatalogEntry[] }>('/admin/catalog', query);
    return { entries: res.entries ?? res.catalog ?? [] };
  },

  // Free-tier summary
  getFreeTierSummary: () => apiGet('/admin/free-tier/summary'),

  // Cost dashboard
  getCostDashboard: (days: number = 30) => apiGet('/admin/cost/dashboard', { days }),

  // Benchmarks
  listBenchmarks: () => apiGet<{ benchmarks: ApiBenchmarkResult[] }>('/admin/benchmarks').then(r => r.benchmarks ?? []),

  // Settings
  getSettings: () => apiGet<Record<string, unknown>>('/admin/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    apiPut<Record<string, unknown>>('/admin/settings', body),

  // Agent Integrations
  getAgentIntegrationConfig: () =>
    apiGet<Record<string, unknown>>('/admin/settings').then((s) => ({
      claudeCode: (s.agentIntegrationClaudeCode as Record<string, unknown>) ?? null,
      codex: (s.agentIntegrationCodex as Record<string, unknown>) ?? null,
      antigravity: (s.agentIntegrationAntigravity as Record<string, unknown>) ?? null,
    })),
  updateAgentIntegrationConfig: (
    tool: 'claudeCode' | 'codex' | 'antigravity',
    config: Record<string, unknown>,
  ) => {
    const key =
      tool === 'claudeCode'
        ? 'agentIntegrationClaudeCode'
        : tool === 'codex'
          ? 'agentIntegrationCodex'
          : 'agentIntegrationAntigravity';
    return apiPut('/admin/settings', { [key]: config });
  },
  testIntegration: (tool: 'claude-code' | 'codex' | 'antigravity') =>
    apiPost<{ success: boolean; latencyMs: number; error?: string }>('/admin/integrations/test', { tool }),

  // Security
  // Rotate the admin API key at runtime. Returns the new key (one-time display).
  rotateAdminKey: () =>
    apiPost<{ new_key: string; message: string }>('/admin/security/rotate-admin-key'),

  // MCP Configuration
  getMcpConfig: () => apiGet<ApiMcpConfig>('/admin/mcp/config'),
  updateMcpConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/config', body),

  // MCP Tool Search
  getToolSearchConfig: () => apiGet('/admin/mcp/tool-search/config'),
  updateToolSearchConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/tool-search/config', body),

  // MCP Guardrails
  getGuardrailsConfig: () => apiGet('/admin/mcp/guardrails/config'),
  updateGuardrailsConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/guardrails/config', body),

  // MCP Audit
  getAuditConfig: () => apiGet('/admin/mcp/audit/config'),
  updateAuditConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/audit/config', body),

  // MCP RBAC
  listRbacPolicies: () => apiGet<{ policies: ApiRbacPolicy[] }>('/admin/mcp/rbac/policies'),
  createRbacPolicy: (body: Omit<ApiRbacPolicy, 'id'> & { id?: string }) => apiPost<ApiRbacPolicy>('/admin/mcp/rbac/policies', body),
  deleteRbacPolicy: (id: string) => apiDelete<{ ok: true }>(`/admin/mcp/rbac/policies/${id}`),

  // MCP Federation
  getFederationConfig: () => apiGet('/admin/mcp/federation/config'),
  updateFederationConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/federation/config', body),
  listFederationPeers: () => apiGet<{ peers: ApiMcpFederationPeer[] }>('/admin/mcp/federation/peers'),
  addFederationPeer: (body: { name: string; endpoint: string; secretRef?: string }) => apiPost<ApiMcpFederationPeer>('/admin/mcp/federation/peers', body),
  removeFederationPeer: (id: string) => apiDelete<{ ok: true }>(`/admin/mcp/federation/peers/${id}`),

  // MCP A2A
  getA2AConfig: () => apiGet('/admin/mcp/a2a/config'),
  updateA2AConfig: (body: Record<string, unknown>) => apiPut('/admin/mcp/a2a/config', body),

  // MCP Aggregation
  listAggregatedServers: () => apiGet<{ servers: ApiMcpAggregatedServer[] }>('/admin/mcp/aggregation/servers'),
  addAggregatedServer: (body: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[] }) => apiPost<ApiMcpAggregatedServer>('/admin/mcp/aggregation/servers', body),
  removeAggregatedServer: (id: string) => apiDelete<{ ok: true }>(`/admin/mcp/aggregation/servers/${id}`),

  // Credits
  getCreditBalance: (tenantId?: string) => apiGet<any>(`/admin/credits/balance${tenantId ? `?tenant_id=${tenantId}` : ''}`),
  topupCredits: (amountCents: number, description?: string) => apiPost<any>('/admin/credits/topup', { amount_cents: amountCents, description, tenant_id: 'default' }),
  getCreditTransactions: (opts?: { type?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return apiGet<any>(`/admin/credits/transactions${qs ? `?${qs}` : ''}`);
  },

  // Model Classifications
  getModelClassifications: (opts?: { tier?: string; provider_id?: string }) => {
    const params = new URLSearchParams();
    if (opts?.tier) params.set('tier', opts.tier);
    if (opts?.provider_id) params.set('provider_id', opts.provider_id);
    const qs = params.toString();
    return apiGet<any>(`/admin/models/classifications${qs ? `?${qs}` : ''}`);
  },
  verifyModelFree: (providerId: string, modelId: string) => apiPost<any>('/admin/models/verify-free', { provider_id: providerId, model_id: modelId }),
  getFreeModels: () => apiGet<any>('/admin/models/free'),
};

function buildSseUrl(path: string): string {
  const RAW_BASE = (import.meta.env.VITE_API_BASE ?? '') as string;
  const base = RAW_BASE.replace(/\/+$/, '');
  return `${base || ''}${path.startsWith('/') ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// Response normalizers
//
// The server returns snake_case payloads with field name drift from
// the UI types (which were updated to expose camelCase aliases). These
// normalizers are the SINGLE bridge that converts the wire shape into
// the UI's expected shape, so consuming components don't need to know
// which fields are aliased.
//
// Hoisted via `function` declarations so they're available to the
// `Admin` object methods above regardless of source order.
// ---------------------------------------------------------------------------

function normalizeDashboard(s: any): ApiDashboardStats {
  if (!s) return s;
  return {
    ...s,
    requests24h: s.requests24h ?? s.total_requests ?? 0,
    cost24h: s.cost24h ?? s.daily_spend ?? 0,
    avgLatencyMs: s.avgLatencyMs ?? s.avg_latency ?? 0,
    totalTokens24h: s.totalTokens24h ?? s.token_usage ?? 0,
    totalCost24h: s.totalCost24h ?? s.daily_spend ?? 0,
    successRate: s.successRate ?? s.success_rate ?? 100,
    fallbackRate: s.fallbackRate ?? s.fallback_rate ?? 0,
    activeModels: s.activeModels ?? s.active_models ?? 0,
    providerHealth: s.providerHealth ?? s.provider_health ?? 0,
    quotaRemaining: s.quotaRemaining ?? s.quota_remaining ?? 0,
    systemStatus: s.systemStatus ?? s.system_status,
  };
}

function normalizeAlert(a: any): ApiAlert {
  if (!a) return a;
  return {
    ...a,
    title: a.title ?? a.message ?? a.type,
    message: a.message,
    at: a.at ?? a.timestamp,
    acknowledgedAt: a.acknowledgedAt,
    resolvedAt: a.resolvedAt,
  };
}

function normalizeUsagePoint(p: any): ApiUsagePoint {
  if (!p) return p;
  const t = typeof p.t === 'number'
    ? p.t
    : typeof p.time === 'string'
      ? new Date(p.time).getTime()
      : p.time;
  return {
    ...p,
    t,
    time: p.time,
    latency: p.latency,
  };
}

function normalizeTelemetryEvent(e: any): ApiTelemetryEvent {
  if (!e) return e;
  return {
    ...e,
    status: e.status ?? (e.level === 'error' ? 'error' : 'ok'),
    tenant: e.tenant ?? e.metadata?.tenant,
    model: e.model ?? e.metadata?.model,
    provider: e.provider ?? e.metadata?.provider,
    latencyMs: e.latencyMs ?? e.duration,
    message: e.message,
    at: e.at ?? e.timestamp,
  };
}

function normalizeAuditEvent(e: any): ApiAuditEvent {
  if (!e) return e;
  return {
    ...e,
    action: e.action ?? e.event_type,
    description: e.description,
    actor: e.actor,
    at: e.at ?? e.timestamp,
    ip_address: e.ip_address,
    metadata: e.metadata,
  };
}

function normalizeProviderTestResult(r: any): ApiProviderTestResult {
  if (!r) return r;
  // The cast at the end preserves the extra snake_case fields (status, message,
  // provider_id, latency_ms) on the returned object so callers that read them
  // directly still work, while still being assignable to the canonical
  // ApiProviderTestResult shape.
  return {
    ok: r.ok ?? (r.status === 'passed'),
    latencyMs: r.latencyMs ?? r.latency_ms ?? 0,
    error: r.error ?? (r.status === 'failed' ? r.message : undefined),
    status: r.status,
    message: r.message,
    provider_id: r.provider_id,
    latency_ms: r.latency_ms,
  } as ApiProviderTestResult;
}

// ─── Fusion Panel ──────────────────────────────────────────────────────────

export interface ApiFusionSlot {
  id: string;
  panel_id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  slot_order: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ApiFusionPanel {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  slots: ApiFusionSlot[];
}

export const FusionPanel = {
  list: () => apiGet<ApiFusionPanel[]>('/admin/fusion-panels'),

  get: (id: string) => apiGet<ApiFusionPanel>(`/admin/fusion-panels/${id}`),

  create: (data: { name: string; description?: string; slots?: Array<{ provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number }> }) =>
    apiPost<ApiFusionPanel>('/admin/fusion-panels', data),

  update: (id: string, data: { name?: string; description?: string; is_active?: number; slots?: Array<{ id?: string; provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number }> }) =>
    apiPut<ApiFusionPanel>(`/admin/fusion-panels/${id}`, data),

  delete: (id: string) => apiDelete(`/admin/fusion-panels/${id}`),

  addSlot: (panelId: string, data: { provider_id: string; model_id: string; display_name: string; slot_order?: number; is_enabled?: number }) =>
    apiPost<ApiFusionSlot>(`/admin/fusion-panels/${panelId}/slots`, data),

  removeSlot: (panelId: string, slotId: string) =>
    apiDelete(`/admin/fusion-panels/${panelId}/slots/${slotId}`),

  reorderSlots: (panelId: string, slotIds: string[]) =>
    apiPut<{ slots: ApiFusionSlot[] }>(`/admin/fusion-panels/${panelId}/slots/reorder`, { slot_ids: slotIds }),
};

export { api, apiGet, apiPost, apiPut, apiDelete };
