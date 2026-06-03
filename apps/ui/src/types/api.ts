export type Status = 'operational' | 'degraded' | 'maintenance' | 'outage' | 'no_providers' | 'ok';
export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'maintenance' | 'online' | 'offline' | 'unknown';
export type RouteStatus = 'success' | 'fallback' | 'error' | 'retry';
export type ExecutionMode = 'sync' | 'async' | 'stream';
export type AuthMethod = 'api_key' | 'oauth' | 'none' | 'device_code' | 'client_credentials' | 'pkce';
export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';
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
  adapterType?: string;
  baseUrl?: string | null;
  apiKeyRef?: string | null;
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
  providerId: string;
  provider?: string;
  providerName?: string;
  name: string;
  displayName?: string | null;
  modality: Modality;
  intelligenceLayer?: IntelligenceLayer;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  costPerImage?: number;
  tier?: CostTier | string;
  qualityScore?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsToolUse?: boolean;
  supportsReasoning?: boolean;
  supportsFunctionCall?: boolean;
  isActive?: boolean;
  createdAt?: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  email?: string;
  tier?: string;
  tokensUsed?: number;
  tokensLimit?: number;
  requestsUsed?: number;
  requestsLimit?: number;
  costUsed?: number;
  costLimit?: number;
  suspended?: boolean;
  createdAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  tenantId: string;
  scopes?: string[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt?: string;
}

export interface ApiRouteDecision {
  id: string;
  tenantId?: string;
  provider: string;
  model: string;
  modality?: Modality;
  intelligenceLayer?: IntelligenceLayer;
  reasoning?: string;
  latencyMs?: number;
  tokens?: number;
  cost?: number;
  success?: boolean;
  at?: string;
}

export interface ApiQuotaState {
  id?: string;
  tenantId?: string;
  tokensUsed?: number;
  tokensLimit?: number;
  requestsUsed?: number;
  requestsLimit?: number;
  costUsed?: number;
  costLimit?: number;
  resetAt?: string;
  exceeded?: boolean;
  warnAt?: number;
  byModel?: Record<string, number>;
  perModelLimit?: Record<string, number>;
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
