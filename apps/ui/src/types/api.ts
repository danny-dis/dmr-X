export type Status = 'operational' | 'degraded' | 'maintenance' | 'outage' | 'no_providers' | 'ok';
export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'maintenance' | 'online' | 'offline' | 'unknown';
export type RouteStatus = 'success' | 'fallback' | 'error' | 'retry';
export type ExecutionMode = 'sync' | 'async' | 'stream';
export type AuthMethod = 'api_key' | 'oauth' | 'none' | 'device_code' | 'client_credentials' | 'pkce';
/** @deprecated Use CapabilityTier with 9-dimension taxonomy instead. */
export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';
export type CapabilityTier = 'frontier' | 'strong' | 'balanced' | 'fast' | 'economy';
// 9-Dimension Taxonomy Types
export type ArchitectureTier = 'dense' | 'moe' | 'ssm' | 'hybrid' | 'unknown';
export type ContextTier = 'short' | 'medium' | 'long' | 'ultra' | 'massive';
export type DeploymentModel = 'cloud' | 'self_hosted' | 'on_device';
export type ReasoningMode = 'fixed' | 'adaptive' | 'hybrid';
export type SafetyTier = 'unrestricted' | 'standard' | 'restricted';
export type AgenticLevel = 'chat' | 'tool_use' | 'autonomous';
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
  /** @deprecated Use adapter_type. camelCase alias. */
  adapterType?: string;
  base_url?: string | null;
  /** @deprecated Use base_url. camelCase alias. */
  baseUrl?: string | null;
  api_key_ref?: string | null;
  /** @deprecated Use api_key_ref. camelCase alias. */
  apiKeyRef?: string | null;
  /** @deprecated Server does not currently return this field. */
  enabled?: boolean;
  status?: ProviderStatus;
  /** @deprecated Server does not currently return this field. */
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
  /** @deprecated Server does not currently return this field. */
  priority?: number;
  /** @deprecated Server does not currently return this field. */
  capabilities?: Modality[];
  models?: ApiModel[];
  /** @deprecated Server does not currently return this field. */
  modelCount?: number;
  local?: boolean;
  region?: string;
  category?: string | string[];
  description?: string;
  createdAt?: string;
  config?: Record<string, unknown>;
  /**
   * Tier of the connection. Derived from the set of active provider
   * keys attached to this provider. 'inactive' means no active keys.
   * The UI uses this to render a Free / Paid / Free+Paid badge and to
   * filter the Free Tier page.
   */
  tier?: ProviderTier;
  /**
   * Every key attached to this provider. The active row with the
   * highest priority is the one the adapter uses; the rest are
   * available for rotation or future round-robin. Ciphertext is never
   * returned — only the masked prefix and metadata.
   */
  keys?: ApiProviderKey[];
}

/**
 * Tier of a provider connection. Server-derived; the UI must NOT
 * recompute it from `keys` (the denormalised cache is the source of
 * truth at the API layer).
 */
export type ProviderTier = 'free' | 'paid' | 'mixed' | 'inactive' | 'subscription';

/**
 * Per-key tier — narrower than ProviderTier because a single key can
 * only be free or paid. The provider-level tier collapses to
 * 'mixed' when the connection carries at least one of each.
 */
export type ProviderKeyTier = 'free' | 'paid';

export interface ApiProviderKey {
  id: string;
  provider_id: string;
  label: string | null;
  tier: ProviderKeyTier;
  auth_method: AuthMethod | string;
  priority: number;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  oauth_token_expires_at: string | null;
  /**
   * First 4 + last 2 characters of the decrypted key, joined by '…'
   * (e.g. "sk-1…yz"). Empty when no key is attached (e.g. an
   * OAuth-only key). '•••' when the ciphertext can't be decrypted.
   */
  masked_key_prefix: string;
  has_api_key: boolean;
  has_oauth_token: boolean;
}

export interface ApiModel {
  id: string;
  provider_id: string;
  /** @deprecated Use provider_id. camelCase alias. */
  providerId?: string;
  provider?: string;
  provider_name?: string;
  /** @deprecated Use provider_name. camelCase alias. */
  providerName?: string;
  /**
   * Upstream model identifier (e.g. "gpt-4o-mini", "claude-3-5-sonnet"). This
   * is the value the provider API actually expects, distinct from `id`
   * which is the local model_profiles row UUID. The playground, model
   * picker, and any other UI that lets the user target a specific model
   * must send `model_id` (or its camelCase alias) — never the row UUID.
   */
  model_id?: string;
  /** @deprecated Use model_id. camelCase alias. */
  modelId?: string;
  name: string;
  display_name?: string | null;
  /** @deprecated Use display_name. camelCase alias. */
  displayName?: string | null;
  modality: Modality;
  intelligence_layer?: IntelligenceLayer;
  /** @deprecated Use intelligence_layer. camelCase alias. */
  intelligenceLayer?: IntelligenceLayer;
  capability_tier?: CapabilityTier;
  /** @deprecated Use capability_tier. camelCase alias. */
  capabilityTier?: CapabilityTier;
  // 9-Dimension Taxonomy Fields
  architecture?: ArchitectureTier;
  task_categories?: string[];
  /** @deprecated Use task_categories. camelCase alias. */
  taskCategories?: string[];
  context_tier?: ContextTier;
  /** @deprecated Use context_tier. camelCase alias. */
  contextTier?: ContextTier;
  deployment?: DeploymentModel;
  reasoning_mode?: ReasoningMode;
  /** @deprecated Use reasoning_mode. camelCase alias. */
  reasoningMode?: ReasoningMode;
  safety_tier?: SafetyTier;
  /** @deprecated Use safety_tier. camelCase alias. */
  safetyTier?: SafetyTier;
  agentic_level?: AgenticLevel;
  /** @deprecated Use agentic_level. camelCase alias. */
  agenticLevel?: AgenticLevel;
  context_window?: number | null;
  /** @deprecated Use context_window. camelCase alias. */
  contextWindow?: number | null;
  max_output_tokens?: number | null;
  /** @deprecated Use max_output_tokens. camelCase alias. */
  maxOutputTokens?: number | null;
  input_cost_per_1k?: number;
  /** @deprecated Use input_cost_per_1k. camelCase alias. */
  inputCostPer1k?: number;
  output_cost_per_1k?: number;
  /** @deprecated Use output_cost_per_1k. camelCase alias. */
  outputCostPer1k?: number;
  cost_per_image?: number;
  /** @deprecated Use cost_per_image. camelCase alias. */
  costPerImage?: number;
  /** @deprecated Server does not return `tier`; use `capability_tier` (or `capabilityTier` alias) instead. */
  tier?: CostTier | string;
  quality_score?: number;
  /** @deprecated Use quality_score. camelCase alias. */
  qualityScore?: number;
  supports_streaming?: boolean;
  /** @deprecated Use supports_streaming. camelCase alias. */
  supportsStreaming?: boolean;
  supports_vision?: boolean;
  /** @deprecated Use supports_vision. camelCase alias. */
  supportsVision?: boolean;
  supports_tool_use?: boolean;
  /** @deprecated Use supports_tool_use. camelCase alias. */
  supportsToolUse?: boolean;
  supports_reasoning?: boolean;
  /** @deprecated Use supports_reasoning. camelCase alias. */
  supportsReasoning?: boolean;
  supports_function_call?: boolean;
  /** @deprecated Use supports_function_call. camelCase alias. */
  supportsFunctionCall?: boolean;
  is_active?: boolean;
  /** @deprecated Use is_active. camelCase alias. */
  isActive?: boolean;
  created_at?: string;
  /** @deprecated Use created_at. camelCase alias. */
  createdAt?: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  email?: string;
  tier?: string;
  tokens_used?: number;
  tokens_limit?: number;
  /** @deprecated Use tokens_limit. camelCase alias. */
  tokensLimit?: number;
  requests_used?: number;
  requests_limit?: number;
  /** @deprecated Use requests_limit. camelCase alias. */
  requestsLimit?: number;
  cost_used?: number;
  cost_limit?: number;
  /** @deprecated Use cost_limit. camelCase alias. */
  costLimit?: number;
  suspended?: boolean;
  created_at?: string;
  /** @deprecated Use created_at. camelCase alias. */
  createdAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  /** Plaintext key — only present on the create response. List responses omit this. */
  key?: string;
  tenant_id: string;
  /** Joined tenant name — only present on list responses, not on the create response. */
  tenant_name?: string;
  scopes?: string[];
  /** Per-key tool restrictions (glob patterns like "dmrx_chat", "dmrx_*", or "*") */
  allowed_tools?: string[];
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
  t?: number | string;
  time?: number | string;
  requests?: number;
  tokens?: number;
  cost?: number;
  latency?: number;
  /** @deprecated Server returns a single latency value, not percentiles. */
  latencyP50?: number;
  /** @deprecated Server returns a single latency value, not percentiles. */
  latencyP95?: number;
  /** @deprecated Server returns a single latency value, not percentiles. */
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
  type?: string;
  timestamp?: string;
  message: string;
  severity: AlertSeverity;
  source?: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  resolved?: boolean;
  resolvedAt?: string;
  details?: Record<string, unknown>;
  /** @deprecated Server uses `message` for both title and body. Kept for UI convenience. */
  title?: string;
  /** @deprecated Mirror of `timestamp`. */
  at?: string;
}

export interface ApiAuditEvent {
  id: string;
  timestamp?: string;
  event_type?: string;
  severity?: 'info' | 'warning' | 'error';
  actor?: string;
  tenant_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  /** @deprecated Server does not return this field. Use `event_type` / `description`. */
  action?: string;
  /** @deprecated Server does not return this field. */
  resource?: string;
  /** @deprecated Server does not return this field. */
  target?: string;
  /** @deprecated Server does not return this field. Use `description` or `metadata`. */
  detail?: string;
  /** @deprecated Mirror of `timestamp`. */
  at?: string;
  /** @deprecated Use `ip_address`. */
  ip?: string;
}

export interface ApiTelemetryEvent {
  id?: string;
  timestamp?: string;
  level?: string;
  service?: string;
  message?: string;
  trace_id?: string | null;
  span_id?: string | null;
  duration?: number | null;
  metadata?: Record<string, unknown>;
  /** @deprecated Server does not return this field. Use `service` / `metadata` instead. */
  kind?: TelemetryKind;
  /** @deprecated Server does not return this field. Use `level` instead. */
  status?: TelemetryStatus;
  /** @deprecated Server does not return this field. Use `metadata.tenant_id`. */
  tenant?: string;
  /** @deprecated Server does not return this field. Use `metadata.model`. */
  model?: string;
  /** @deprecated Server does not return this field. Use `metadata.provider`. */
  provider?: string;
  /** @deprecated Server does not return this field. Use `duration`. */
  latencyMs?: number;
  /** @deprecated Server does not return this field. Use `metadata.token_count`. */
  tokens?: number;
  /** @deprecated Server does not return this field. Use `metadata.cost`. */
  cost?: number;
  /** @deprecated Mirror of `timestamp`. */
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

export interface ApiWorkerJob {
  id: string;
  workerId: string;
  jobType: string;
  payload?: string | null;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
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

export interface ApiConfidenceInterval {
  lower: number;
  upper: number;
  margin: number;
  games: number;
}

export interface ApiBenchmarkLeaderboardEntry {
  id: string;
  model_id: string;
  display_name: string;
  provider_name: string;
  elo_rating: number;
  quality_score: number;
  avg_latency_ms: number;
  capability_tier: string;
  battle_count: number;
  confidenceInterval: ApiConfidenceInterval;
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
  signupUrl?: string;
}

export interface ApiHealthResponse {
  status: Status;
  version?: string;
  uptime?: number;
  checks?: { name: string; status: 'ok' | 'fail'; latencyMs?: number; message?: string }[];
}

export interface ApiMcpTool {
  name: string;
  description?: string;
  /** Optional parameter schema (Zod-like shape) for the tool */
  params?: Record<string, unknown>;
}

export interface ApiMcpToolExecute {
  tool: string;
  parameters?: Record<string, unknown>;
}

export interface ApiMcpToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ApiMcpStatus {
  /**
   * Whether the MCP server is currently reachable. `null` means the
   * server runs in stdio mode (per-client child process) so the
   * gateway cannot probe it — render an "unknown / separate process"
   * indicator in that case.
   */
  available: boolean | null;
  transport: 'stdio' | 'sse' | 'http' | string;
  host: string;
  port: number;
  hasApiKey: boolean;
  uptime?: number;
  tools: ApiMcpTool[];
}

/**
 * Live status of the Needle tool pre-filter sidecar (services/needle-router).
 * `enabled` is the settings-backed runtime toggle; `reachable` is a live
 * probe of its `/health` endpoint; `lastAttempt` is telemetry from the most
 * recent real filter call the gateway made (if any since last restart).
 */
export interface ApiNeedleStatus {
  enabled: boolean;
  reachable: boolean;
  modelLoaded: boolean | null;
  probeLatencyMs: number;
  timeoutBudgetMs: number;
  lastAttempt: {
    at: string;
    outcome: 'disabled' | 'matched' | 'no_match' | 'timeout' | 'http_error' | 'network_error' | null;
    latencyMs: number | null;
    error: string | null;
    matchedCount: number | null;
    toolCount: number | null;
  } | null;
}

export interface ApiDashboardStats {
  // UI-friendly aliases (preferred for components)
  requests24h?: number;
  cost24h?: number;
  avgLatencyMs?: number;
  /** Signed % change, last 24h avg latency vs the preceding 24h. `null`/`undefined` when there is no prior-period data to compare against — the UI must hide the delta rather than treat it as 0. */
  latencyDelta?: number | null;
  totalProviders?: number;
  onlineProviders?: number;
  totalTokens24h?: number;
  totalCost24h?: number;
  successRate?: number;
  fallbackRate?: number;

  // Raw server fields (snake_case)
  total_requests?: number;
  success_rate?: number;
  avg_latency?: number;
  latency_delta_pct?: number | null;
  token_usage?: number;
  daily_spend?: number;
  quota_remaining?: number;
  active_models?: number;
  provider_health?: number;
  fallback_rate?: number;
  worker_utilization?: number;
  system_status?: string;
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

export interface ApiRerankResult {
  id?: string;
  model?: string;
  results: Array<{
    index: number;
    relevance_score: number;
    document?: string;
  }>;
  fallback?: boolean;
}

// ----------------------------------------------------------------------------
// Agentic / tool-loop event shapes
//
// `/v1/agentic/chat` and `/v1/tools/loop` both stream SSE responses with the
// shape `event: <name>\ndata: <json>\n\n`. These types document the event
// names the server emits so UI code can narrow on them safely. The Playground
// currently stores the raw parsed payload as `{ name, data }` — these shapes
// are exported for callers that want stricter typing.
// ----------------------------------------------------------------------------

/** Discriminated union of event names the Playground knows how to render. */
export type ApiAgenticEventName =
  | 'turn'
  | 'step'
  | 'tool_calls'
  | 'tool_results'
  | 'approval_required'
  | 'error'
  | 'done'
  | 'message';

/** Payload of an SSE event from the agentic or tool-loop endpoint. */
export interface ApiAgenticEvent {
  name: ApiAgenticEventName | string;
  data: Record<string, unknown>;
}

/** `/v1/agentic/chat` `turn` event payload. */
export interface ApiAgenticTurnEvent {
  turn: number;
  conversationId: string;
  message: { role: string; content?: string; tool_calls?: unknown[] };
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finish_reason?: string;
}

/** `/v1/tools/loop` `step` event payload (OpenAI-style chat.completion). */
export interface ApiToolLoopStepEvent {
  step: number;
  object: 'chat.completion';
  id: string;
  model?: string;
  choices: Array<{
    index: number;
    message: { role: string; content?: string; tool_calls?: unknown[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// ---------------------------------------------------------------------------
// MCP Configuration Types
// ---------------------------------------------------------------------------

export interface ApiMcpToolSearchConfig {
  enabled: boolean;
  bm25: { enabled: boolean; k1: number; b: number };
  semantic: { enabled: boolean; remoteUrl: string };
  hybrid: { enabled: boolean; rrfConstant: number };
}

export interface ApiMcpGuardrailsConfig {
  enabled: boolean;
  pii: { enabled: boolean; maskChar: string };
  contentFilter: { enabled: boolean; blockedPatterns: string[] };
}

export interface ApiMcpAuditConfig {
  enabled: boolean;
  backend: string;
  retentionDays: number;
  logBodies: boolean;
}

export interface ApiRbacPolicy {
  id: string;
  name: string;
  effect: 'allow' | 'deny';
  principals: string[];
  actions: string[];
  resources: string[];
}

export interface ApiMcpRbacConfig {
  enabled: boolean;
  policies: ApiRbacPolicy[];
}

export interface ApiMcpFederationPeer {
  id: string;
  name: string;
  endpoint: string;
  secretRef?: string;
  status?: string;
  lastSync?: string | null;
}

export interface ApiMcpFederationConfig {
  enabled: boolean;
  peers: ApiMcpFederationPeer[];
  discovery: { mdns: boolean; dns: { domain: string } };
  syncInterval: string;
}

export interface ApiMcpA2AConfig {
  enabled: boolean;
  agentCard: { name: string; description: string; url: string };
  taskTimeout: number;
}

export interface ApiMcpAggregatedServer {
  id: string;
  name: string;
  transport: string;
  url?: string;
  command?: string;
  args?: string[];
  status?: string;
  toolCount?: number;
}

export interface ApiMcpAggregationConfig {
  servers: ApiMcpAggregatedServer[];
}

export interface ApiMcpConfig {
  transport: string;
  host: string;
  port: number;
  hasApiKey: boolean;
  toolSearch: ApiMcpToolSearchConfig;
  guardrails: ApiMcpGuardrailsConfig;
  audit: ApiMcpAuditConfig;
  rbac: ApiMcpRbacConfig;
  federation: ApiMcpFederationConfig;
  a2a: ApiMcpA2AConfig;
  aggregation: ApiMcpAggregationConfig;
}
