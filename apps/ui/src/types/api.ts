export type Status = 'operational' | 'degraded' | 'maintenance' | 'outage' | 'no_providers' | 'ok';
export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'maintenance' | 'online' | 'offline' | 'unknown';
export type RouteStatus = 'success' | 'fallback' | 'error' | 'retry';
export type ExecutionMode = 'sync' | 'async' | 'stream';
export type AuthMethod = 'api_key' | 'oauth' | 'none' | 'device_code' | 'client_credentials' | 'pkce';
export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';
export type CapabilityTier = 'orchestrator' | 'brain' | 'thinker' | 'executor' | 'specialist' | 'worker' | 'temp_worker';
export type Modality =
  | 'llm'
  | 'diffusion'
  | 'embedding'
  | 'audio_tts'
  | 'audio_stt'
  | 'video'
  | 'music'
  | 'reranking'
  | 'moderation'
  | 'code_completion'
  | 'image';
export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'premium';
export type AlertSeverity = 'error' | 'warning' | 'info' | 'success' | 'critical';
export type TelemetryStatus = 'ok' | 'error';
export type TelemetryKind = 'request' | 'routing' | 'model' | 'tool' | 'tenant' | 'system';
export type PolicyAction = 'allow' | 'deny' | 'redirect' | 'rate_limit' | 'tag';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface ApiProvider {
  id: string;
  name: string;
  adapter_type?: string;
  base_url?: string | null;
  api_key_ref?: string | null;
  enabled?: boolean;
  status?: ProviderStatus;
  health?: {
    status: 'ok' | 'degraded' | 'down' | 'unknown';
    latencyMs?: number;
    lastCheckAt?: string;
    errorMessage?: string;
  };
  authType?: AuthMethod;
  authMethod?: AuthMethod;
  hasKey?: boolean;
  hasOAuthToken?: boolean;
  oauthTokenExpiresAt?: string | null;
  priority?: number;
  capabilities?: Modality[];
  models?: ApiModel[];
  modelCount?: number;
  local?: boolean;
  region?: string;
  category?: string | string[];
  description?: string;
  createdAt?: string;
  config?: Record<string, unknown>;
}

export interface ApiModel {
  id: string;
  provider_id: string;
  provider?: string;
  provider_name?: string;
  name: string;
  display_name?: string | null;
  modality: Modality;
  intelligence_layer?: IntelligenceLayer;
  capability_tier?: CapabilityTier;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_1k?: number;
  output_cost_per_1k?: number;
  cost_per_image?: number;
  tier?: CostTier | string;
  quality_score?: number;
  supports_streaming?: boolean;
  supports_vision?: boolean;
  supports_tool_use?: boolean;
  supports_reasoning?: boolean;
  supports_function_call?: boolean;
  is_active?: boolean;
  created_at?: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  email?: string;
  tier?: string;
  tokens_used?: number;
  tokens_limit?: number;
  requests_used?: number;
  requests_limit?: number;
  cost_used?: number;
  cost_limit?: number;
  suspended?: boolean;
  created_at?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  tenant_id: string;
  scopes?: string[];
  last_used_at?: string;
  is_active: number;
  created_at?: string;
}

export interface ApiRouteDecision {
  id?: string;
  timestamp: string;
  task_type?: string;
  selected_model: string;
  selected_provider: string;
  execution_mode?: string;
  decision_reason?: string;
  fallback_chain?: string[];
  latency?: number;
  cost?: number;
  confidence?: number;
  input_tokens?: number;
  output_tokens?: number;
  status: 'success' | 'fallback' | 'error';
}

export interface ApiQuotaState {
  id?: string;
  tenant_id?: string;
  tokens_used?: number;
  tokens_limit?: number;
  requests_used?: number;
  requests_limit?: number;
  cost_used?: number;
  cost_limit?: number;
  reset_at?: string;
  exceeded?: boolean;
  warn_at?: number;
  by_model?: Record<string, number>;
  per_model_limit?: Record<string, number>;
}

export interface ApiUsagePoint {
  t: number;
  requests?: number;
  tokens?: number;
  cost?: number;
  latencyP50?: number;
  latencyP95?: number;
  latencyP99?: number;
  cacheHits?: number;
  fallbacks?: number;
  errors?: number;
}

export interface ApiBillingSummary {
  totalCost?: number;
  totalTokens?: number;
  totalRequests?: number;
  avgCostPerRequest?: number;
  costDelta?: number;
  tokensDelta?: number;
  requestsDelta?: number;
  byCategory?: { llm?: number; diffusion?: number; audio?: number; embedding?: number; tools?: number };
  byProvider?: { provider: string; cost: number }[];
  byModel?: { model: string; cost: number }[];
  invoices?: {
    id: string;
    tenantId?: string;
    tenantName?: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
    status: 'paid' | 'pending' | 'overdue' | 'draft';
  }[];
}

export interface ApiAlert {
  id: string;
  title: string;
  message?: string;
  severity: AlertSeverity;
  source?: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  resolved?: boolean;
  resolvedAt?: string;
  at?: string;
  details?: Record<string, unknown>;
}

export interface ApiAuditEvent {
  id: string;
  actor: string;
  action: string;
  resource: string;
  target?: string;
  detail?: string;
  at?: string;
  ip?: string;
}

export interface ApiTelemetryEvent {
  id: string;
  kind: TelemetryKind;
  status?: TelemetryStatus;
  tenant?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokens?: number;
  cost?: number;
  message?: string;
  at?: string;
}

export interface ApiBenchmarkResult {
  id: string;
  name: string;
  runAt?: string;
  promptCount?: number;
  models?: string[];
  avgLatencyMs?: number;
  throughput?: number;
  byModel?: Record<string, number>;
  results?: Array<{ model: string; latency: number; tokensPerSec: number; cost: number }>;
}

export interface ApiPolicyRule {
  id: string;
  name: string;
  description?: string;
  action: PolicyAction;
  priority?: number;
  enabled?: boolean;
  match?: {
    model?: string;
    tenantId?: string;
    tag?: string;
    modality?: Modality;
  };
  updatedAt?: string;
  createdAt?: string;
}

export interface ApiMemoryItem {
  id: string;
  content: string;
  tenantId: string;
  createdAt?: string;
  score?: number;
  source?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface ApiMemorySearch {
  query: string;
  tenantId?: string;
  limit?: number;
  threshold?: number;
}

export interface ApiSandboxJob {
  id: string;
  language?: string;
  code?: string;
  status: JobStatus;
  submittedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
}

export interface ApiSandboxSubmit {
  language: string;
  code: string;
  timeoutMs?: number;
  input?: string;
}

export interface ApiWorkerRegister {
  name: string;
  type?: string;
}

export interface ApiMemoryCreate {
  content: string;
  tenantId?: string;
  namespace?: string;
  source?: string;
  retentionDays?: number;
  metadata?: Record<string, unknown>;
}

export interface ApiWorker {
  id: string;
  name?: string;
  type?: string;
  alive?: boolean;
  draining?: boolean;
  jobsProcessed?: number;
  uptimeMs?: number;
  lastHeartbeatAt?: string;
  load?: number;
  queueDepth?: number;
  createdAt?: string;
}

export interface ApiFederationNode {
  id: string;
  name?: string;
  url?: string;
  region?: string;
  status?: 'online' | 'degraded' | 'offline' | 'unknown';
  latencyMs?: number;
  lastSeenAt?: string;
  lastSync?: string;
  metadata?: Record<string, unknown>;
}

export interface ApiFederationRegister {
  name: string;
  url: string;
  region?: string;
  authToken?: string;
}

export interface ApiFreeTierCatalogEntry extends ApiCatalogEntry {
  models: ApiModel[];
  freeModelCount?: number;
  totalModelCount?: number;
  signupUrl?: string;
}

export interface ApiBenchmarkRun {
  models: string[];
  promptSet: string;
  promptCount?: number;
  concurrency?: number;
}

export interface ApiCatalogEntry {
  id: string;
  name: string;
  category: string;
  description?: string;
  baseUrl?: string;
  authMethod?: AuthMethod;
  oauthConfig?: {
    flow?: 'authorization_code' | 'pkce' | 'device_code' | 'client_credentials';
    scopes?: string[];
    usePKCE?: boolean;
    tokenResponseType?: string;
  };
  models?: { id: string; name: string; modality: Modality }[];
}

export interface ApiHealthResponse {
  status: Status;
  version?: string;
  uptime?: number;
  checks?: { name: string; status: 'ok' | 'fail'; latencyMs?: number; message?: string }[];
}

export interface ApiDashboardStats {
  requests24h?: number;
  requestsDelta?: number;
  cost24h?: number;
  costDelta?: number;
  avgLatencyMs?: number;
  latencyDelta?: number;
  totalProviders?: number;
  onlineProviders?: number;
  activeTenants?: number;
  totalTokens24h?: number;
  totalCost24h?: number;
  successRate?: number;
  fallbackRate?: number;
  cacheHitRate?: number;
}

export interface ApiProviderTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ApiProviderOAuthStart {
  authorizationUrl?: string;
  authUrl?: string;
  state?: string;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  expiresIn?: number;
  pkce?: { codeVerifier: string; codeChallenge: string; method: string };
  flow: 'authorization_code' | 'pkce' | 'device_code' | 'client_credentials';
  expiresAt?: string;
}
