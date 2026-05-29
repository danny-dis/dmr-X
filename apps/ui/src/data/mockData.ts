// Mock data removed - live data only
// All data now comes from the API

import type {
  Tenant, User, APIKey, Provider, Model, RouteDecision,
  MemoryItem, BenchmarkResult, QuotaState,
  BillingSummary, AuditEvent, Alert, SandboxJob, TemporaryWorker,
  PolicyRule, TelemetryEvent, FederationNode, DashboardStats
} from '@/types';

export const dashboardStats: DashboardStats = {
  totalRequests: 0,
  successRate: 0,
  avgLatency: 0,
  tokenUsage: 0,
  dailySpend: 0,
  quotaRemaining: 0,
  activeModels: 0,
  providerHealth: 0,
  fallbackRate: 0,
  workerUtilization: 0,
  systemStatus: 'operational',
};

export const providers: Provider[] = [];
export const models: Model[] = [];
export const tenants: Tenant[] = [];
export const apiKeys: APIKey[] = [];
export const routeDecisions: RouteDecision[] = [];
export const quotaStates: QuotaState[] = [];
export const billingSummary: BillingSummary = {
  id: '',
  tenantId: '',
  tenantName: '',
  currentMonthSpend: 0,
  estimatedEndOfMonth: 0,
  previousMonthSpend: 0,
  costByProvider: [],
  costByModel: [],
  costByModality: [],
  invoices: [],
  planLimits: { requests: 0, tokens: 0, spend: 0 },
  overageFlags: [],
};
export const alerts: Alert[] = [];
export const auditEvents: AuditEvent[] = [];
export const telemetryEvents: TelemetryEvent[] = [];
export const benchmarkResults: BenchmarkResult[] = [];
export const policyRules: PolicyRule[] = [];
export const memoryItems: MemoryItem[] = [];
export const sandboxJobs: SandboxJob[] = [];
export const temporaryWorkers: TemporaryWorker[] = [];
export const federationNodes: FederationNode[] = [];
export const usageHistory: { time: string; requests: number; tokens: number; cost: number }[] = [];
export const users: User[] = [];
