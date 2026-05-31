const API_BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function getAuthHeaders(): Record<string, string> {
  const apiKey = (typeof localStorage !== 'undefined' && localStorage.getItem('dmrx_api_key')) || import.meta.env.VITE_API_KEY;
  if (apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  }
  return {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: customHeaders, ...rest } = options || {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...customHeaders,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText);
  }

  return res.json();
}

// --- Admin: Providers ---

export interface ApiProvider {
  id: string;
  name: string;
  adapter_type: string;
  base_url: string | null;
  api_key_ref: string | null;
  config: Record<string, unknown>;
  created_at: string;
  status?: string;
  hasKey?: boolean;
  signupUrl?: string;
  description?: string;
  category?: string | string[];
  region?: string;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  category: string;
  baseUrl: string;
  authMethod: string;
  apiFormat: string;
  envKey: string;
  description: string;
  signupUrl?: string;
  models: any[];
}

export async function fetchProviders(): Promise<ApiProvider[]> {
  const data = await request<{ providers: ApiProvider[] }>('/v1/admin/providers');
  return data.providers;
}

export async function fetchCatalog(): Promise<ProviderTemplate[]> {
  const data = await request<{ catalog: ProviderTemplate[] }>('/v1/admin/catalog');
  return data.catalog;
}

export async function activateProvider(template_id: string, api_key?: string): Promise<{ success: boolean; provider: ApiProvider }> {
  return request<{ success: boolean; provider: ApiProvider }>('/v1/admin/providers/activate', {
    method: 'POST',
    body: JSON.stringify({ template_id, api_key }),
  });
}

export async function createProvider(input: {
  name: string;
  adapter_type: string;
  base_url?: string;
  api_key_ref?: string;
  config?: Record<string, unknown>;
}): Promise<ApiProvider> {
  return request<ApiProvider>('/v1/admin/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProviderApiKey(provider_id: string, api_key: string): Promise<{ success: boolean; provider: ApiProvider }> {
  return request<{ success: boolean; provider: ApiProvider }>(`/v1/admin/providers/${provider_id}/api-key`, {
    method: 'PUT',
    body: JSON.stringify({ api_key }),
  });
}

export interface TestProviderResult {
  status: 'passed' | 'failed';
  provider_id: string;
  latency_ms: number;
  message: string;
}

export async function testProviderConnection(
  provider_id: string,
  base_url: string,
  api_key: string
): Promise<TestProviderResult> {
  return request<TestProviderResult>('/v1/admin/providers/test', {
    method: 'POST',
    body: JSON.stringify({ provider_id, base_url, api_key }),
  });
}

// --- Admin: Models ---

export interface ApiModel {
  id: string;
  provider_id: string;
  provider_name: string;
  model_id: string;
  display_name: string | null;
  modality: string;
  intelligence_layer: string;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_streaming: boolean;
  supports_vision: boolean;
  supports_tool_use: boolean;
  supports_reasoning: boolean;
  supports_function_call: boolean;
  supports_json_mode: boolean;
  quality_score: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  cost_per_image: number;
  created_at: string;
}

export async function fetchModels(): Promise<ApiModel[]> {
  const data = await request<{ models: ApiModel[] }>('/v1/admin/models');
  return data.models;
}

export async function createModel(input: {
  provider_id: string;
  model_id: string;
  display_name?: string;
  modality: string;
  intelligence_layer?: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_streaming?: boolean;
  supports_vision?: boolean;
  supports_tool_use?: boolean;
  input_cost_per_1k?: number;
  output_cost_per_1k?: number;
  cost_per_image?: number;
}): Promise<ApiModel> {
  return request<ApiModel>('/v1/admin/models', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Admin: Tenants ---

export interface ApiTenant {
  id: string;
  name: string;
  created_at: string;
}

export async function fetchTenants(): Promise<ApiTenant[]> {
  const data = await request<{ tenants: ApiTenant[] }>('/v1/admin/tenants');
  return data.tenants;
}

export async function createTenant(name: string): Promise<ApiTenant> {
  return request<ApiTenant>('/v1/admin/tenants', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

// --- Admin: API Keys ---

export interface ApiKey {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  name: string | null;
  key?: string;
  is_active?: boolean;
  created_at: string;
  last_used_at?: string;
}

export async function fetchApiKeys(): Promise<ApiKey[]> {
  const data = await request<{ api_keys: ApiKey[] }>('/v1/admin/api-keys');
  return data.api_keys;
}

export async function createApiKey(tenant_id: string, name?: string): Promise<ApiKey> {
  return request<ApiKey>('/v1/admin/api-keys', {
    method: 'POST',
    body: JSON.stringify({ tenant_id, name }),
  });
}

export async function deleteApiKey(id: string): Promise<void> {
  await request<unknown>(`/v1/admin/api-keys/${id}`, { method: 'DELETE' });
}

// --- Admin: Routing ---

export interface ApiRouteDecision {
  id: string;
  timestamp: string;
  task_type: string;
  selected_model: string;
  selected_provider: string;
  execution_mode: string;
  decision_reason: string;
  fallback_chain: string[];
  latency: number;
  cost: number;
  confidence: number;
  input_tokens: number;
  output_tokens: number;
  status: string;
}

export async function fetchRouteDecisions(): Promise<ApiRouteDecision[]> {
  const data = await request<{ decisions: ApiRouteDecision[] }>('/v1/admin/routing/decisions');
  return data.decisions;
}

// --- Admin: Quota ---

export interface ApiQuotaState {
  id: string;
  provider_id: string;
  provider_name: string;
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  window: string;
  reset_time: string;
  burn_rate: number;
  predicted_exhaustion: string;
  alerts: string[];
  rerouting_suggestions: string[];
}

export async function fetchQuotaStates(): Promise<ApiQuotaState[]> {
  const data = await request<{ quotas: ApiQuotaState[] }>('/v1/admin/quota');
  return data.quotas;
}

// --- Admin: Billing ---

export interface ApiBillingSummary {
  id: string;
  tenant_id: string;
  tenant_name: string;
  current_month_spend: number;
  estimated_end_of_month: number;
  previous_month_spend: number;
  cost_by_provider: { provider: string; cost: number }[];
  cost_by_model: { model: string; cost: number }[];
  cost_by_modality: { modality: string; cost: number }[];
  invoices: { id: string; period: string; amount: number; status: string; due_date: string; paid_date?: string }[];
  plan_limits: { requests: number; tokens: number; spend: number };
  overage_flags: string[];
}

export async function fetchBillingSummary(): Promise<ApiBillingSummary> {
  return request<ApiBillingSummary>('/v1/admin/billing/summary');
}

export interface ApiUsageHistory {
  time: string;
  requests: number;
  latency: number;
  cost: number;
}

export async function fetchUsageHistory(): Promise<ApiUsageHistory[]> {
  const data = await request<{ history: ApiUsageHistory[] }>('/v1/admin/billing/usage-history');
  return data.history;
}

// --- Admin: Alerts ---

export interface ApiAlert {
  id: string;
  timestamp: string;
  type: string;
  severity: string;
  message: string;
  source: string;
  acknowledged: boolean;
  resolved: boolean;
  details: Record<string, unknown>;
}

export async function fetchAlerts(): Promise<ApiAlert[]> {
  const data = await request<{ alerts: ApiAlert[] }>('/v1/admin/alerts');
  return data.alerts;
}

// --- Admin: Audit ---

export interface ApiAuditEvent {
  id: string;
  timestamp: string;
  event_type: string;
  severity: string;
  actor: string;
  tenant_id?: string;
  description: string;
  metadata: Record<string, unknown>;
  ip_address?: string | null;
}

export async function fetchAuditEvents(): Promise<ApiAuditEvent[]> {
  const data = await request<{ events: ApiAuditEvent[] }>('/v1/admin/audit/events');
  return data.events;
}

// --- Admin: Telemetry ---

export interface ApiTelemetryEvent {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export async function fetchTelemetryEvents(): Promise<ApiTelemetryEvent[]> {
  const data = await request<{ events: ApiTelemetryEvent[] }>('/v1/admin/telemetry/events');
  return data.events;
}

// --- Admin: Benchmarks ---

export interface ApiBenchmarkResult {
  id: string;
  model_id: string;
  model_name: string;
  benchmark_name: string;
  score: number;
  latency: number;
  cost: number;
  task_type: string;
  run_date: string;
  regression: boolean;
  previous_score?: number;
  comparison_scores?: Record<string, number>;
}

export async function fetchBenchmarkResults(): Promise<ApiBenchmarkResult[]> {
  const data = await request<{ benchmarks: ApiBenchmarkResult[] }>('/v1/admin/benchmarks');
  return data.benchmarks;
}

// --- Admin: Policies ---

export interface ApiPolicyRule {
  id: string;
  name: string;
  tenant_id?: string;
  type: string;
  target: string[];
  action: string;
  conditions?: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export async function fetchPolicyRules(): Promise<ApiPolicyRule[]> {
  const data = await request<{ policies: ApiPolicyRule[] }>('/v1/admin/policies');
  return data.policies;
}

export async function createPolicy(policy: { name: string; tenant_id?: string; type: string; target: string[]; action: string; priority?: number }): Promise<ApiPolicyRule> {
  return request<ApiPolicyRule>('/v1/admin/policies', {
    method: 'POST',
    body: JSON.stringify(policy),
  });
}

export async function updatePolicy(id: string, updates: { name?: string; type?: string; target?: string[]; action?: string; priority?: number; enabled?: boolean }): Promise<ApiPolicyRule> {
  return request<ApiPolicyRule>(`/v1/admin/policies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deletePolicy(id: string): Promise<void> {
  await request(`/v1/admin/policies/${id}`, { method: 'DELETE' });
}

// --- Admin: Memory ---

export interface ApiMemoryItem {
  id: string;
  content: string;
  namespace: string;
  confidence: number;
  created_at: string;
  retrieved_at?: string;
  source: string;
  metadata: Record<string, unknown>;
  redaction_status: string;
  retention_days: number;
  embedding_model: string;
}

export async function fetchMemoryItems(): Promise<ApiMemoryItem[]> {
  const data = await request<{ items: ApiMemoryItem[] }>('/v1/admin/memory/items');
  return data.items;
}

// --- Admin: Sandbox ---

export interface ApiSandboxJob {
  id: string;
  name: string;
  type: string;
  status: string;
  isolation_level: string;
  resource_usage: { cpu: number; memory: number; io: number };
  start_time: string;
  end_time?: string;
  retries: number;
  max_retries: number;
  output?: string;
  error?: string;
}

export async function fetchSandboxJobs(): Promise<ApiSandboxJob[]> {
  const data = await request<{ jobs: ApiSandboxJob[] }>('/v1/admin/sandbox/jobs');
  return data.jobs;
}

// --- Admin: Scheduler ---

export interface ApiWorker {
  id: string;
  name: string;
  status: string;
  uptime: number;
  idle_timeout: number;
  task_assigned?: string;
  queue_depth: number;
  health: string;
  cpu_usage: number;
  memory_usage: number;
  auto_terminate: boolean;
  spawn_time: string;
}

export async function fetchWorkers(): Promise<ApiWorker[]> {
  const data = await request<{ workers: ApiWorker[] }>('/v1/admin/scheduler/workers');
  return data.workers;
}

// --- Admin: Federation ---

export interface ApiFederationNode {
  id: string;
  name: string;
  region: string;
  status: string;
  last_sync: string;
  benchmark_summary: { global_score: number; local_score: number; variance: number };
  anonymized_updates: number;
  privacy_level: string;
}

export async function fetchFederationNodes(): Promise<ApiFederationNode[]> {
  const data = await request<{ nodes: ApiFederationNode[] }>('/v1/admin/federation/nodes');
  return data.nodes;
}

// --- Admin: Dashboard ---

export interface ApiDashboardStats {
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

export async function fetchDashboardStats(): Promise<ApiDashboardStats> {
  return request<ApiDashboardStats>('/v1/admin/dashboard/stats');
}

// --- Admin: Settings ---

export async function fetchSettings(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/v1/admin/settings');
}

export async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  await request<Record<string, unknown>>('/v1/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

// --- Chat Completions ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  return request<ChatCompletionResponse>('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ ...req, stream: false }),
  });
}

export async function chatCompletionStream(
  req: ChatCompletionRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ ...req, stream: true }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, body.message || res.statusText);
    }

    if (!res.body) throw new ApiError(0, 'Response body is empty');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          onDone(fullText);
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            onChunk(fullText);
          } else if (delta?.tool_calls) {
            // Tool calls in streaming — append to full text for visibility
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) fullText += `\n[tool_call: ${tc.function.name}]`;
              if (tc.function?.arguments) fullText += tc.function.arguments;
            }
            onChunk(fullText);
          }
        } catch (parseErr) {
          // skip malformed SSE chunks (common in streaming)
          console.debug('[ui] Skipped malformed SSE chunk:', parseErr);
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// --- Models list (OpenAI-compatible) ---

export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export async function listModels(): Promise<OpenAIModel[]> {
  const data = await request<{ data: OpenAIModel[] }>('/v1/models');
  return data.data;
}
