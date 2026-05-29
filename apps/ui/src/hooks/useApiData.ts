import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';

import type {
  Provider, Model, Tenant, APIKey, RouteDecision, QuotaState,
  BillingSummary, Alert, AuditEvent, TelemetryEvent, BenchmarkResult,
  PolicyRule, MemoryItem, SandboxJob, TemporaryWorker, FederationNode,
  DashboardStats,
} from '@/types';

// Default empty dashboard stats
const emptyDashboardStats: DashboardStats = {
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

// Default empty billing summary
const emptyBillingSummary: BillingSummary = {
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

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiProviders = await api.fetchProviders();
      const mapped: Provider[] = apiProviders.map((ap) => ({
        id: ap.id,
        name: ap.name,
        logo: ap.adapter_type,
        baseUrl: ap.base_url || '',
        region: (ap.config?.region as string) || 'unknown',
        costTier: (ap.config?.costTier as Provider['costTier']) || 'medium',
        status: ap.config?.isHealthy === false ? 'unavailable' as const : 'healthy' as const,
        models: (ap.config?.models as string[]) || [],
        rateLimit: { requests: (ap.config?.rateLimitRpm as number) || 0, window: '1m' },
        failoverStatus: 'active' as const,
        lastHealthCheck: ap.created_at,
        avgLatency: (ap.config?.avgLatencyMs as number) || 0,
        successRate: (ap.config?.successRate as number) || 100,
        signupUrl: (ap.config?.signupUrl as string) || undefined,
        apiKey: (ap.config?.apiKey as string) || undefined,
      }));
      setProviders(mapped);
    } catch (err) {
      setProviders([]);
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { providers, loading, source, error, refetch: load };
}

export function useCatalog() {
  const [catalog, setCatalog] = useState<api.ProviderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.fetchCatalog();
      setCatalog(data);
    } catch (err) {
      setCatalog([]);
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { catalog, loading, error, refetch: load };
}

export function useModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiModels = await api.fetchModels();
      const mapped: Model[] = apiModels.map((am) => ({
        id: am.id,
        name: am.display_name || am.model_id,
        provider: am.provider_name,
        providerId: am.provider_id,
        modality: [am.modality],
        contextWindow: am.context_window || 0,
        inputCost: am.input_cost_per_1k || 0,
        outputCost: am.output_cost_per_1k || 0,
        qualityScore: 0,
        speedClass: 'balanced' as const,
        reliability: 100,
        toolSupport: am.supports_tool_use ?? false,
        streamingSupport: am.supports_streaming ?? false,
        status: 'enabled' as const,
        tags: [am.intelligence_layer].filter(Boolean),
        benchmarkTrend: [],
        description: `${am.model_id} from ${am.provider_name}`,
      }));
      setModels(mapped);
    } catch (err) {
      setModels([]);
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { models, loading, source, error, refetch: load };
}

// --- Tenants ---
export function useTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiTenants = await api.fetchTenants();
      const mapped: Tenant[] = apiTenants.map((at) => ({
        id: at.id,
        name: at.name,
        plan: 'pro' as const,
        users: 0,
        monthlyLimit: 0,
        currentSpend: 0,
        status: 'active' as const,
        createdAt: at.created_at,
        region: 'unknown',
      }));
      setTenants(mapped);
    } catch (err) {
      setTenants([]);
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { tenants, loading, source, error, refetch: load };
}

// --- API Keys ---
export function useApiKeys() {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiKeys = await api.fetchApiKeys();
      const mapped: APIKey[] = apiKeys.map((ak) => ({
        id: ak.id,
        name: ak.name || 'Unnamed Key',
        key: ak.key || '****',
        tenantId: ak.tenant_id,
        providerId: undefined,
        scopes: [],
        lastUsed: ak.created_at,
        createdAt: ak.created_at,
        status: 'active' as const,
        usageThisMonth: 0,
      }));
      setKeys(mapped);
    } catch (err) {
      setKeys([]);
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { keys, loading, source, error, refetch: load };
}

// --- Route Decisions ---
export function useRouteDecisions() {
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiDecisions = await api.fetchRouteDecisions();
      const mapped: RouteDecision[] = apiDecisions.map((d) => ({
        id: d.id,
        timestamp: d.timestamp,
        taskType: d.task_type,
        selectedModel: d.selected_model,
        selectedProvider: d.selected_provider,
        executionMode: d.execution_mode as RouteDecision['executionMode'],
        decisionReason: d.decision_reason,
        fallbackChain: d.fallback_chain,
        latency: d.latency,
        cost: d.cost,
        confidence: d.confidence,
        inputTokens: d.input_tokens,
        outputTokens: d.output_tokens,
        status: d.status as RouteDecision['status'],
      }));
      setDecisions(mapped);
    } catch (err) {
      setDecisions([]);
      setError(err instanceof Error ? err.message : 'Failed to load routing decisions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { decisions, loading, source, error, refetch: load };
}

// --- Quota States ---
export function useQuotaStates() {
  const [quotas, setQuotas] = useState<QuotaState[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiQuotas = await api.fetchQuotaStates();
      const mapped: QuotaState[] = apiQuotas.map((q) => ({
        id: q.id,
        providerId: q.provider_id,
        providerName: q.provider_name,
        totalQuota: q.total_quota,
        usedQuota: q.used_quota,
        remainingQuota: q.remaining_quota,
        window: q.window,
        resetTime: q.reset_time,
        burnRate: q.burn_rate,
        predictedExhaustion: q.predicted_exhaustion,
        alerts: q.alerts,
        reroutingSuggestions: q.rerouting_suggestions,
      }));
      setQuotas(mapped);
    } catch (err) {
      setQuotas([]);
      setError(err instanceof Error ? err.message : 'Failed to load quota states');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { quotas, loading, source, error, refetch: load };
}

// --- Billing Summary ---
export function useBillingSummary() {
  const [billing, setBilling] = useState<BillingSummary>(emptyBillingSummary);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const ab = await api.fetchBillingSummary();
      setBilling({
        id: ab.id,
        tenantId: ab.tenant_id,
        tenantName: ab.tenant_name,
        currentMonthSpend: ab.current_month_spend,
        estimatedEndOfMonth: ab.estimated_end_of_month,
        previousMonthSpend: ab.previous_month_spend,
        costByProvider: ab.cost_by_provider,
        costByModel: ab.cost_by_model,
        costByModality: ab.cost_by_modality,
        invoices: (ab.invoices || []).map((inv) => ({
          id: inv.id,
          period: inv.period,
          amount: inv.amount,
          status: inv.status as BillingSummary['invoices'][0]['status'],
          dueDate: inv.due_date,
          paidDate: inv.paid_date,
        })),
        planLimits: ab.plan_limits,
        overageFlags: ab.overage_flags,
      });
    } catch (err) {
      setBilling(emptyBillingSummary);
      setError(err instanceof Error ? err.message : 'Failed to load billing summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { billing, loading, source, error, refetch: load };
}

// --- Alerts ---
export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiAlerts = await api.fetchAlerts();
      const mapped: Alert[] = apiAlerts.map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
        type: a.type as Alert['type'],
        severity: a.severity as Alert['severity'],
        message: a.message,
        source: a.source,
        acknowledged: a.acknowledged,
        resolved: a.resolved,
        details: a.details,
      }));
      setAlerts(mapped);
    } catch (err) {
      setAlerts([]);
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { alerts, loading, source, error, refetch: load };
}

// --- Audit Events ---
export function useAuditEvents() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiEvents = await api.fetchAuditEvents();
      const mapped: AuditEvent[] = apiEvents.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        eventType: e.event_type as AuditEvent['eventType'],
        severity: e.severity as AuditEvent['severity'],
        actor: e.actor,
        tenantId: e.tenant_id,
        description: e.description,
        metadata: e.metadata,
        ipAddress: e.ip_address,
      }));
      setEvents(mapped);
    } catch (err) {
      setEvents([]);
      setError(err instanceof Error ? err.message : 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { events, loading, source, error, refetch: load };
}

// --- Telemetry Events ---
export function useTelemetryEvents() {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiEvents = await api.fetchTelemetryEvents();
      const mapped: TelemetryEvent[] = apiEvents.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        level: e.level as TelemetryEvent['level'],
        service: e.service,
        message: e.message,
        traceId: e.trace_id,
        spanId: e.span_id,
        duration: e.duration,
        metadata: e.metadata,
      }));
      setEvents(mapped);
    } catch (err) {
      setEvents([]);
      setError(err instanceof Error ? err.message : 'Failed to load telemetry events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { events, loading, source, error, refetch: load };
}

// --- Benchmark Results ---
export function useBenchmarkResults() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiBenchmarks = await api.fetchBenchmarkResults();
      const mapped: BenchmarkResult[] = apiBenchmarks.map((b) => ({
        id: b.id,
        modelId: b.model_id,
        modelName: b.model_name,
        benchmarkName: b.benchmark_name,
        score: b.score,
        latency: b.latency,
        cost: b.cost,
        taskType: b.task_type,
        runDate: b.run_date,
        regression: b.regression,
        previousScore: b.previous_score,
        comparisonScores: b.comparison_scores,
      }));
      setBenchmarks(mapped);
    } catch (err) {
      setBenchmarks([]);
      setError(err instanceof Error ? err.message : 'Failed to load benchmark results');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { benchmarks, loading, source, error, refetch: load };
}

// --- Policy Rules ---
export function usePolicyRules() {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiPolicies = await api.fetchPolicyRules();
      const mapped: PolicyRule[] = apiPolicies.map((p) => ({
        id: p.id,
        name: p.name,
        tenantId: p.tenant_id,
        type: p.type as PolicyRule['type'],
        target: p.target,
        action: p.action as PolicyRule['action'],
        conditions: p.conditions,
        priority: p.priority,
        enabled: p.enabled,
        createdAt: p.created_at,
      }));
      setPolicies(mapped);
    } catch (err) {
      setPolicies([]);
      setError(err instanceof Error ? err.message : 'Failed to load policy rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { policies, loading, source, error, refetch: load };
}

// --- Memory Items ---
export function useMemoryItems() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiItems = await api.fetchMemoryItems();
      const mapped: MemoryItem[] = apiItems.map((m) => ({
        id: m.id,
        content: m.content,
        namespace: m.namespace,
        confidence: m.confidence,
        createdAt: m.created_at,
        retrievedAt: m.retrieved_at,
        source: m.source,
        metadata: m.metadata,
        redactionStatus: m.redaction_status as MemoryItem['redactionStatus'],
        retentionDays: m.retention_days,
        embeddingModel: m.embedding_model,
      }));
      setItems(mapped);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : 'Failed to load memory items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { items, loading, source, error, refetch: load };
}

// --- Sandbox Jobs ---
export function useSandboxJobs() {
  const [jobs, setJobs] = useState<SandboxJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiJobs = await api.fetchSandboxJobs();
      const mapped: SandboxJob[] = apiJobs.map((j) => ({
        id: j.id,
        name: j.name,
        type: j.type as SandboxJob['type'],
        status: j.status as SandboxJob['status'],
        isolationLevel: j.isolation_level as SandboxJob['isolationLevel'],
        resourceUsage: j.resource_usage,
        startTime: j.start_time,
        endTime: j.end_time,
        retries: j.retries,
        maxRetries: j.max_retries,
        output: j.output,
        error: j.error,
      }));
      setJobs(mapped);
    } catch (err) {
      setJobs([]);
      setError(err instanceof Error ? err.message : 'Failed to load sandbox jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { jobs, loading, source, error, refetch: load };
}

// --- Workers ---
export function useWorkers() {
  const [workers, setWorkers] = useState<TemporaryWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiWorkers = await api.fetchWorkers();
      const mapped: TemporaryWorker[] = apiWorkers.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status as TemporaryWorker['status'],
        uptime: w.uptime,
        idleTimeout: w.idle_timeout,
        taskAssigned: w.task_assigned,
        queueDepth: w.queue_depth,
        health: w.health as TemporaryWorker['health'],
        cpuUsage: w.cpu_usage,
        memoryUsage: w.memory_usage,
        autoTerminate: w.auto_terminate,
        spawnTime: w.spawn_time,
      }));
      setWorkers(mapped);
    } catch (err) {
      setWorkers([]);
      setError(err instanceof Error ? err.message : 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { workers, loading, source, error, refetch: load };
}

// --- Federation Nodes ---
export function useFederationNodes() {
  const [nodes, setNodes] = useState<FederationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const apiNodes = await api.fetchFederationNodes();
      const mapped: FederationNode[] = apiNodes.map((n) => ({
        id: n.id,
        name: n.name,
        region: n.region,
        status: n.status as FederationNode['status'],
        lastSync: n.last_sync,
        benchmarkSummary: {
          globalScore: n.benchmark_summary.global_score,
          localScore: n.benchmark_summary.local_score,
          variance: n.benchmark_summary.variance,
        },
        anonymizedUpdates: n.anonymized_updates,
        privacyLevel: n.privacy_level as FederationNode['privacyLevel'],
      }));
      setNodes(mapped);
    } catch (err) {
      setNodes([]);
      setError(err instanceof Error ? err.message : 'Failed to load federation nodes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { nodes, loading, source, error, refetch: load };
}

// --- Dashboard Stats ---
export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats>(emptyDashboardStats);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const ds = await api.fetchDashboardStats();
      setStats({
        totalRequests: ds.total_requests,
        successRate: ds.success_rate,
        avgLatency: ds.avg_latency,
        tokenUsage: ds.token_usage,
        dailySpend: ds.daily_spend,
        quotaRemaining: ds.quota_remaining,
        activeModels: ds.active_models,
        providerHealth: ds.provider_health,
        fallbackRate: ds.fallback_rate,
        workerUtilization: ds.worker_utilization,
        systemStatus: ds.system_status as DashboardStats['systemStatus'],
      });
    } catch (err) {
      setStats(emptyDashboardStats);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { stats, loading, source, error, refetch: load };
}

// --- Settings ---
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await api.fetchSettings();
      setSettings(s);
    } catch (err) {
      setSettings({});
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (newSettings: Record<string, unknown>) => {
    await api.saveSettings(newSettings);
    setSettings(newSettings);
  }, []);

  return { settings, loading, source, error, refetch: load, save };
}

// --- Usage History ---
export function useUsageHistory() {
  const [history, setHistory] = useState<{ time: string; requests: number; latency: number; cost: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [source] = useState<'api'>('api');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const uh = await api.fetchUsageHistory();
      setHistory(uh);
    } catch (err) {
      setHistory([]);
      setError(err instanceof Error ? err.message : 'Failed to load usage history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { history, loading, source, error, refetch: load };
}
