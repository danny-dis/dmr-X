import { api, apiGet, apiPost, apiPut, apiDelete } from './api';
export const Admin = {
    // Health & dashboard
    health: () => apiGet('/health'),
    dashboard: () => apiGet('/admin/dashboard'),
    // Providers
    listProviders: () => apiGet('/admin/providers'),
    getProvider: (id) => apiGet(`/admin/providers/${id}`),
    createProvider: (body) => apiPost('/admin/providers', {
        name: body.name,
        adapter_type: body.adapterType,
        base_url: body.baseUrl,
        api_key_ref: body.apiKeyRef,
        config: body.config ?? {},
    }),
    activateProvider: (body) => apiPost('/admin/providers/activate', body),
    updateProvider: (id, body) => apiPut(`/admin/providers/${id}`, body),
    deleteProvider: (id) => apiDelete(`/admin/providers/${id}`),
    testProvider: (id) => apiPost(`/admin/providers/${id}/test`),
    startProviderOAuth: (id) => apiPost(`/admin/providers/${id}/oauth/authorize`),
    completeProviderOAuth: (id, code, state) => apiPost(`/admin/providers/${id}/oauth/callback`, { code, state }),
    refreshProviderOAuth: (id) => apiPost(`/admin/providers/${id}/oauth/refresh`),
    getProviderOAuthStatus: (id) => apiGet(`/admin/providers/${id}/oauth/status`),
    pollProviderOAuthDeviceCode: (id, deviceCode) => apiPost(`/admin/providers/${id}/oauth/device-code/poll`, { device_code: deviceCode }),
    // Models
    listModels: (query) => apiGet('/admin/models', query),
    getModel: (id) => apiGet(`/admin/models/${id}`),
    createModel: (body) => apiPost('/admin/models', body),
    updateModel: (id, body) => apiPut(`/admin/models/${id}`, body),
    deleteModel: (id) => apiDelete(`/admin/models/${id}`),
    // Tenants & API keys
    listTenants: async () => {
        const res = await apiGet('/admin/tenants');
        return Array.isArray(res) ? res : res.tenants;
    },
    getTenant: (id) => apiGet(`/admin/tenants/${id}`),
    createTenant: (body) => apiPost('/admin/tenants', body),
    updateTenant: (id, body) => apiPut(`/admin/tenants/${id}`, body),
    deleteTenant: (id) => apiDelete(`/admin/tenants/${id}`),
    listApiKeys: async (tenantId) => {
        const res = await apiGet(`/admin/tenants/${tenantId}/keys`);
        return Array.isArray(res) ? res : res.api_keys;
    },
    createApiKey: (tenantId, body) => apiPost(`/admin/tenants/${tenantId}/keys`, body),
    revokeApiKey: (tenantId, keyId) => apiDelete(`/admin/tenants/${tenantId}/keys/${keyId}`),
    // Routing & quota
    listRouteDecisions: (query) => apiGet('/admin/routing/decisions', query),
    getQuota: (tenantId) => apiGet(`/admin/tenants/${tenantId}/quota`),
    // Billing & usage
    getBilling: (query) => apiGet('/admin/billing/summary', query),
    getUsage: (query) => apiGet('/admin/usage', query),
    // Observability
    listAlerts: (query) => apiGet('/admin/alerts', query),
    acknowledgeAlert: (id) => apiPost(`/admin/alerts/${id}/ack`),
    resolveAlert: (id) => apiPost(`/admin/alerts/${id}/resolve`),
    listAudit: (query) => apiGet('/admin/audit', query),
    listTelemetry: (query) => apiGet('/admin/telemetry', query),
    streamTelemetry: (signal, onEvent) => {
        const url = '/admin/telemetry/stream';
        const ev = new EventSource(buildSseUrl(url));
        ev.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                onEvent(data);
            }
            catch {
                // ignore
            }
        };
        signal.addEventListener('abort', () => ev.close());
        return ev;
    },
    // Benchmarks
    listBenchmarks: () => apiGet('/admin/benchmarks'),
    runBenchmark: (body) => apiPost('/admin/benchmarks/run', body),
    // Policies
    listPolicies: () => apiGet('/admin/policies'),
    upsertPolicy: (body) => apiPost('/admin/policies', body),
    deletePolicy: (id) => apiDelete(`/admin/policies/${id}`),
    // Memory
    searchMemory: (body) => apiPost('/admin/memory/search', body),
    listMemory: (query) => apiGet('/admin/memory', query),
    deleteMemory: (id) => apiDelete(`/admin/memory/${id}`),
    // Sandbox
    listSandboxJobs: () => apiGet('/admin/sandbox/jobs'),
    submitSandbox: (body) => apiPost('/admin/sandbox/jobs', body),
    cancelSandbox: (id) => apiPost(`/admin/sandbox/jobs/${id}/cancel`),
    // Workers
    listWorkers: () => apiGet('/admin/workers'),
    drainWorker: (id) => apiPost(`/admin/workers/${id}/drain`),
    resumeWorker: (id) => apiPost(`/admin/workers/${id}/resume`),
    // Federation
    listFederation: () => apiGet('/admin/federation'),
    registerFederation: (body) => apiPost('/admin/federation', body),
    unregisterFederation: (id) => apiDelete(`/admin/federation/${id}`),
    // Catalog
    getCatalog: async (query) => {
        const res = await apiGet('/admin/catalog', query);
        return { entries: res.entries ?? res.catalog ?? [] };
    },
    // Settings
    getSettings: () => apiGet('/admin/settings'),
    updateSettings: (body) => apiPut('/admin/settings', body),
};
function buildSseUrl(path) {
    const RAW_BASE = (import.meta.env.VITE_API_BASE ?? '');
    const base = RAW_BASE.replace(/\/+$/, '');
    return `${base || ''}${path.startsWith('/') ? path : `/${path}`}`;
}
export { api, apiGet, apiPost, apiPut, apiDelete };
//# sourceMappingURL=admin.js.map