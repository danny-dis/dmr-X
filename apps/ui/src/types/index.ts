import type {
  ApiProvider, ApiModel, ApiTenant, ApiKey, ApiRouteDecision, ApiQuotaState,
  ApiBillingSummary, ApiAlert, ApiAuditEvent, ApiTelemetryEvent, ApiBenchmarkResult,
  ApiPolicyRule, ApiMemoryItem, ApiSandboxJob, ApiWorker, ApiFederationNode,
  ApiDashboardStats, Modality,
} from './api';

export type {
  ApiProvider, ApiModel, ApiTenant, ApiKey, ApiRouteDecision, ApiQuotaState,
  ApiBillingSummary, ApiAlert, ApiAuditEvent, ApiTelemetryEvent, ApiBenchmarkResult,
  ApiPolicyRule, ApiMemoryItem, ApiSandboxJob, ApiWorker, ApiFederationNode,
  ApiDashboardStats,
} from './api';

export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'premium';
export type ProviderHealth = 'healthy' | 'degraded' | 'unavailable' | 'maintenance';

export interface Provider extends Omit<ApiProvider, 'capabilities' | 'models'> {
  logo: string;
  baseUrl: string;
  region: string;
  costTier: CostTier;
  models: string[];
  rateLimit: { requests: number; window: string };
  failoverStatus: 'active' | 'standby' | 'failed';
  lastHealthCheck: string;
  avgLatency: number;
  successRate: number;
  isFree?: boolean;
  capabilities?: Modality[];
}

export interface Model extends ApiModel {
  name: string;
  provider: string;
  providerId: string;
  capabilities: { streaming: boolean; vision: boolean; tool_use: boolean; reasoning: boolean; function_call: boolean; json_mode: boolean };
  inputCost: number;
  outputCost: number;
  qualityScore: number;
  tags: string[];
}

export interface Tenant {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  users: number;
  monthlyLimit: number;
  currentSpend: number;
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
  region: string;
  keyCount?: number;
}

export interface RouteDecision {
  id: string;
  timestamp: string;
  taskType: string;
  selectedModel: string;
  selectedProvider: string;
  executionMode: 'sync' | 'async' | 'stream';
  decisionReason: string;
  fallbackChain: string[];
  latency: number;
  cost: number;
  confidence: number;
  inputTokens: number;
  outputTokens: number;
  status: 'success' | 'fallback' | 'error' | 'retry';
  userAgent?: string | null;
  tenantId?: string;
}

export interface QuotaState {
  id: string;
  providerId: string;
  providerName: string;
  apiKeyId?: string;
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  window: string;
  resetTime: string;
  burnRate: number;
  predictedExhaustion: string;
  alerts: string[];
  reroutingSuggestions: string[];
}

export interface BillingSummary {
  id: string;
  tenantId: string;
  tenantName: string;
  currentMonthSpend: number;
  estimatedEndOfMonth: number;
  previousMonthSpend: number;
  costByProvider: { provider: string; cost: number }[];
  costByModel: { model: string; cost: number }[];
  costByModality: { modality: string; cost: number }[];
  invoices: Invoice[];
  planLimits: { requests: number; tokens: number; spend: number };
  overageFlags: string[];
}

export interface Invoice {
  id: string;
  period: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  dueDate: string;
  paidDate?: string;
}

export interface Alert {
  id: string;
  timestamp: string;
  type: 'quota' | 'provider_outage' | 'spend_anomaly' | 'latency_spike' | 'benchmark_regression' | 'auth_failure' | 'sandbox_failure' | 'info';
  severity: 'warning' | 'critical' | 'info';
  message: string;
  source: string;
  acknowledged: boolean;
  resolved: boolean;
  details: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: 'routing' | 'policy' | 'quota' | 'provider_call' | 'fallback' | 'admin' | 'config' | 'key_rotation';
  severity: 'info' | 'warning' | 'error' | 'critical';
  actor: string;
  tenantId?: string;
  description: string;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  service: string;
  message: string;
  traceId?: string;
  spanId?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkResult {
  id: string;
  modelId: string;
  modelName: string;
  benchmarkName: string;
  score: number;
  latency: number;
  cost: number;
  taskType: string;
  runDate: string;
  regression: boolean;
  previousScore?: number;
  comparisonScores?: Record<string, number>;
}

export interface PolicyRule {
  id: string;
  name: string;
  tenantId?: string;
  tenantName?: string;
  type: 'provider_allow' | 'provider_deny' | 'model_allow' | 'model_deny' | 'cost_cap' | 'modality_restriction' | 'residency' | 'tool_permission';
  target: string[];
  action: 'allow' | 'deny' | 'redirect';
  conditions?: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  namespace: string;
  confidence: number;
  createdAt: string;
  retrievedAt?: string;
  source: string;
  metadata: Record<string, unknown>;
  redactionStatus: 'clean' | 'redacted' | 'flagged';
  retentionDays: number;
  embeddingModel: string;
}

export interface SandboxJob {
  id: string;
  name: string;
  type: 'code_execution' | 'tool_run' | 'sandbox_task';
  status: 'running' | 'completed' | 'failed' | 'queued' | 'quarantined';
  isolationLevel: 'container' | 'vm' | 'process';
  resourceUsage: { cpu: number; memory: number; io: number };
  startTime: string;
  endTime?: string;
  retries: number;
  maxRetries: number;
  output?: string;
  error?: string;
}

export interface TemporaryWorker {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'terminating' | 'terminated';
  uptime: number;
  idleTimeout: number;
  taskAssigned?: string;
  queueDepth: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
  cpuUsage: number;
  memoryUsage: number;
  autoTerminate: boolean;
  spawnTime: string;
}

export interface FederationNode {
  id: string;
  name: string;
  region: string;
  status: 'synced' | 'syncing' | 'stale' | 'offline';
  lastSync: string;
  benchmarkSummary: { globalScore: number; localScore: number; variance: number };
  anonymizedUpdates: number;
  privacyLevel: 'full' | 'anonymized' | 'aggregated';
}

export interface DashboardStats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  tokenUsage: number;
  dailySpend: number;
  quotaRemaining: number;
  activeModels: number;
  providerHealth: number;
  fallbackRate: number;
  workerUtilization: number;
  systemStatus: 'operational' | 'degraded' | 'maintenance' | 'outage' | 'no_providers';
}
