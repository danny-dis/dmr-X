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
  ApiSandboxJob,
  ApiWorker,
  ApiFederationNode,
  ApiDashboardStats,
  ApiCatalogEntry,
  ApiHealthResponse,
  ApiProviderTestResult,
  ApiProviderOAuthStart,
  ApiMemorySearch,
  ApiBenchmarkRun,
  ApiSandboxSubmit,
  ApiFederationRegister,
} from '@/types/api';

import { api, apiGet, apiPost, apiPut, apiDelete } from './api';

export const Admin = {
  // Health & dashboard
  health: () => apiGet<ApiHealthResponse>('/health'),
  dashboard: () => apiGet<ApiDashboardStats>('/admin/dashboard'),

  // Providers
  listProviders: () => apiGet<ApiProvider[]>('/admin/providers'),
  getProvider: (id: string) => apiGet<ApiProvider>(`/admin/providers/${id}`),
  createProvider: (body: Partial<ApiProvider>) =>
    apiPost<ApiProvider>('/admin/providers', {
      name: body.name,
      adapter_type: body.adapterType,
      base_url: body.baseUrl,
      api_key_ref: body.apiKeyRef,
      config: body.config ?? {},
    }),
  activateProvider: (body: {
    template_id: string;
    api_key?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    oauth_token_expires_at?: string;
    auth_method?: 'api_key' | 'oauth';
    name?: string;
  }) => apiPost<{ success: boolean; provider: ApiProvider }>('/admin/providers/activate', body),
  updateProvider: (id: string, body: Partial<ApiProvider>) =>
    apiPut<ApiProvider>(`/admin/providers/${id}`, body),
  deleteProvider: (id: string) => apiDelete<{ ok: true }>(`/admin/providers/${id}`),
  testProvider: (id: string) => apiPost<ApiProviderTestResult>(`/admin/providers/${id}/test`),
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
  listModels: (query?: { providerId?: string; modality?: string }) =>
    apiGet<ApiModel[]>('/admin/models', query),
  getModel: (id: string) => apiGet<ApiModel>(`/admin/models/${id}`),
  createModel: (body: Partial<ApiModel>) => apiPost<ApiModel>('/admin/models', body),
  updateModel: (id: string, body: Partial<ApiModel>) => apiPut<ApiModel>(`/admin/models/${id}`, body),
  deleteModel: (id: string) => apiDelete<{ ok: true }>(`/admin/models/${id}`),

  // Tenants & API keys
  listTenants: async () => {
    const res = await apiGet<ApiTenant[] | { tenants: ApiTenant[] }>('/admin/tenants');
    return Array.isArray(res) ? res : res.tenants;
  },
  getTenant: (id: string) => apiGet<ApiTenant>(`/admin/tenants/${id}`),
  createTenant: (body: Partial<ApiTenant>) => apiPost<ApiTenant>('/admin/tenants', body),
  updateTenant: (id: string, body: Partial<ApiTenant>) =>
    apiPut<ApiTenant>(`/admin/tenants/${id}`, body),
  deleteTenant: (id: string) => apiDelete<{ ok: true }>(`/admin/tenants/${id}`),
  listApiKeys: async (tenantId: string) => {
    const res = await apiGet<ApiKey[] | { api_keys: ApiKey[] }>(`/admin/tenants/${tenantId}/keys`);
    return Array.isArray(res) ? res : res.api_keys;
  },
  createApiKey: (tenantId: string, body: Partial<ApiKey>) =>
    apiPost<ApiKey>(`/admin/tenants/${tenantId}/keys`, body),
  revokeApiKey: (tenantId: string, keyId: string) =>
    apiDelete<{ ok: true }>(`/admin/tenants/${tenantId}/keys/${keyId}`),

  // Routing & quota
  listRouteDecisions: (query?: { tenantId?: string; limit?: number }) =>
    apiGet<ApiRouteDecision[]>('/admin/routing/decisions', query),
  getQuota: (tenantId: string) => apiGet<ApiQuotaState>(`/admin/tenants/${tenantId}/quota`),

  // Billing & usage
  getBilling: (query?: { tenantId?: string; period?: 'day' | 'week' | 'month' }) =>
    apiGet<ApiBillingSummary>('/admin/billing/summary', query),
  getUsage: (query?: { tenantId?: string; from?: string; to?: string; granularity?: 'minute' | 'hour' | 'day' }) =>
    apiGet<{ points: ApiUsagePoint[]; total: number }>('/admin/usage', query),

  // Observability
  listAlerts: (query?: { severity?: string; status?: string }) =>
    apiGet<ApiAlert[]>('/admin/alerts', query),
  acknowledgeAlert: (id: string) => apiPost<ApiAlert>(`/admin/alerts/${id}/ack`),
  resolveAlert: (id: string) => apiPost<ApiAlert>(`/admin/alerts/${id}/resolve`),
  listAudit: (query?: { limit?: number; actor?: string }) =>
    apiGet<ApiAuditEvent[]>('/admin/audit', query),
  listTelemetry: (query?: { since?: string; kind?: string; limit?: number }) =>
    apiGet<ApiTelemetryEvent[]>('/admin/telemetry', query),
  streamTelemetry: (signal: AbortSignal, onEvent: (e: ApiTelemetryEvent) => void) => {
    const url = '/admin/telemetry/stream';
    const ev = new EventSource(buildSseUrl(url));
    ev.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as ApiTelemetryEvent;
        onEvent(data);
      } catch {
        // ignore
      }
    };
    signal.addEventListener('abort', () => ev.close());
    return ev;
  },

  // Benchmarks
  listBenchmarks: () => apiGet<ApiBenchmarkResult[]>('/admin/benchmarks'),
  runBenchmark: (body: ApiBenchmarkRun) => apiPost<ApiBenchmarkResult>('/admin/benchmarks/run', body),

  // Policies
  listPolicies: () => apiGet<ApiPolicyRule[]>('/admin/policies'),
  upsertPolicy: (body: Partial<ApiPolicyRule>) => apiPost<ApiPolicyRule>('/admin/policies', body),
  deletePolicy: (id: string) => apiDelete<{ ok: true }>(`/admin/policies/${id}`),

  // Memory
  searchMemory: (body: ApiMemorySearch) => apiPost<ApiMemoryItem[]>('/admin/memory/search', body),
  listMemory: (query?: { tenantId?: string; limit?: number }) =>
    apiGet<ApiMemoryItem[]>('/admin/memory', query),
  deleteMemory: (id: string) => apiDelete<{ ok: true }>(`/admin/memory/${id}`),

  // Sandbox
  listSandboxJobs: () => apiGet<ApiSandboxJob[]>('/admin/sandbox/jobs'),
  submitSandbox: (body: ApiSandboxSubmit) => apiPost<ApiSandboxJob>('/admin/sandbox/jobs', body),
  cancelSandbox: (id: string) => apiPost<{ ok: true }>(`/admin/sandbox/jobs/${id}/cancel`),

  // Workers
  listWorkers: () => apiGet<ApiWorker[]>('/admin/workers'),
  drainWorker: (id: string) => apiPost<ApiWorker>(`/admin/workers/${id}/drain`),
  resumeWorker: (id: string) => apiPost<ApiWorker>(`/admin/workers/${id}/resume`),

  // Federation
  listFederation: () => apiGet<ApiFederationNode[]>('/admin/federation'),
  registerFederation: (body: ApiFederationRegister) =>
    apiPost<ApiFederationNode>('/admin/federation', body),
  unregisterFederation: (id: string) =>
    apiDelete<{ ok: true }>(`/admin/federation/${id}`),

  // Catalog
  getCatalog: async (query?: { category?: string; query?: string }) => {
    const res = await apiGet<{ entries?: ApiCatalogEntry[]; catalog?: ApiCatalogEntry[] }>('/admin/catalog', query);
    return { entries: res.entries ?? res.catalog ?? [] };
  },

  // Settings
  getSettings: () => apiGet<Record<string, unknown>>('/admin/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    apiPut<Record<string, unknown>>('/admin/settings', body),
};

function buildSseUrl(path: string): string {
  const RAW_BASE = (import.meta.env.VITE_API_BASE ?? '') as string;
  const base = RAW_BASE.replace(/\/+$/, '');
  return `${base || ''}${path.startsWith('/') ? path : `/${path}`}`;
}

export { api, apiGet, apiPost, apiPut, apiDelete };
