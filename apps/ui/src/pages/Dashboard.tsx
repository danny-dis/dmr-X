import {
  Activity,
  Zap,
  DollarSign,
  Globe,
  ArrowRight,
  Clock,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  KeyRound,
  Server,
  X,
  Boxes,
  Key,
  FlaskConical,
  Bell,
  Bot,
  TrendingUp,
  Cpu,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Link } from 'react-router';

import { DonutChart } from '@/components/charts/DonutChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { LazyTab } from '@/components/primitives/LazyTab';
import { Progress } from '@/components/primitives/Progress';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile, type StatTileProps } from '@/components/primitives/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load Observability tab content
const ObservabilityTab = React.lazy(() => import('@/pages/Observability').then(m => ({ default: m.ObservabilityPage })));
import { chartColor, categoricalColor, type ChartTone } from '@/lib/chartPalette';
import { Admin } from '@/lib/admin';
import { useAlerts } from '@/lib/queries/observability';
import { useModels } from '@/lib/queries/models';
import { useProviders } from '@/lib/queries/providers';
import { useAgentInstances } from '@/lib/queries/agents';
import { useFreeTierSummary, useSavings } from '@/lib/queries/usage';
import {
  formatNumber,
  formatDuration,
  formatCompactCurrency,
  formatCurrency,
  timeAgo,
} from '@/lib/formatters';
import { keys } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { useLiveStore } from '@/store/useLiveStore';
import { useDashboardStats, useRouteDecisions, useUsageHistory } from '@/lib/queries/dashboard';
import type { ApiDashboardStats } from '@/types/api';

/** Known modality -> chart tone. Anything not listed falls back to the
 * categorical rotation so a new modality never renders unstyled. */
const MODALITY_TONE: Record<string, ChartTone> = {
  llm: 'primary',
  diffusion: 'pink',
  embedding: 'accent',
  audio_tts: 'warning',
  audio_stt: 'success',
  video: 'lime',
  music: 'danger',
  reranking: 'info',
  moderation: 'danger',
  code_completion: 'accent',
};

/** Placeholder tile rendered in a `DataState`'s `loading` slot — same box,
 * same label/icon, so a stat-tile row never reflows between loading and
 * loaded (StatTile's own `loading` flag swaps the value for a pulse bar). */
function StatTileSkeleton({
  label,
  icon,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: StatTileProps['tone'];
}) {
  return <StatTile label={label} icon={icon} tone={tone} value="" loading />;
}

export function DashboardPage() {
  // Slow-poll fallback — paints real numbers before the SSE stream connects
  // and keeps the page correct if it drops. The live stream (mounted once in
  // Shell via useLiveStream) is the primary path, read from the store below.
  const statsQuery = useDashboardStats();
  const liveStats = useLiveStore((s) => s.stats);
  const connection = useLiveStore((s) => s.connection);

  const decisions = useRouteDecisions(8);
  const usage = useUsageHistory('hour');
  const providers = useProviders();
  const alerts = useAlerts();
  const models = useModels({ available_only: 'true' });
  const agentInstances = useAgentInstances();
  const freeTierSummary = useFreeTierSummary();
  const savings = useSavings(30);
  // No dedicated query hook exists for API keys yet (only `Admin.listApiKeys`
  // in lib/admin.ts) — queried inline here rather than adding a new hook file
  // while another migration touches lib/queries/tenants.ts concurrently.
  const apiKeysQuery = useQuery({
    queryKey: keys.apiKeys.list(),
    queryFn: () => Admin.listApiKeys(),
  });

  // The live SSE frame is snake_case and doesn't carry every field the poll
  // response does (no `latencyDelta`, for instance) — merge rather than
  // replace so a connected stream doesn't blank out fields it never sends.
  const stats: ApiDashboardStats | null = React.useMemo(() => {
    if (!liveStats) return statsQuery.data ?? null;
    return {
      ...statsQuery.data,
      requests24h: liveStats.total_requests,
      cost24h: liveStats.daily_spend,
      avgLatencyMs: liveStats.avg_latency,
      totalTokens24h: liveStats.token_usage,
      totalCost24h: liveStats.daily_spend,
      successRate: liveStats.success_rate,
      fallbackRate: liveStats.fallback_rate,
      activeModels: liveStats.active_models,
      providerHealth: liveStats.provider_health,
      quotaRemaining: liveStats.quota_remaining,
      systemStatus: liveStats.system_status,
    };
  }, [liveStats, statsQuery.data]);
  const statsLoading = statsQuery.isLoading && !liveStats;

  // Compute provider key status stats
  const providerStats = React.useMemo(() => {
    const all = providers.data ?? [];
    const withKeys = all.filter(p => p.tier !== 'inactive');
    const freeProviders = all.filter(p => p.tier === 'free');
    const paidProviders = all.filter(p => p.tier === 'paid');
    const mixedProviders = all.filter(p => p.tier === 'mixed');
    return {
      total: all.length,
      withKeys: withKeys.length,
      free: freeProviders.length,
      paid: paidProviders.length,
      mixed: mixedProviders.length,
    };
  }, [providers.data]);

  // Compute active agent instance stats
  const agentStats = React.useMemo(() => {
    const items = agentInstances.data?.items ?? [];
    const active = items.filter(i => i.status === 'active');
    return {
      total: agentInstances.data?.total ?? items.length,
      active: active.length,
      paused: items.filter(i => i.status === 'paused').length,
    };
  }, [agentInstances.data]);

  // Derive the top-of-page system status from real alert severities so the
  // badge reflects what's actually broken, not a hardcoded "all good" line.
  // Loading state intentionally renders a muted "Checking…" badge so we don't
  // show a false success before the first fetch resolves.
  const alertList = alerts.data ?? [];
  const hasErrorAlert = alertList.some((a) => a.severity === 'error');
  const hasWarningAlert = alertList.some((a) => a.severity === 'warning');
  const systemStatus: {
    tone: 'success' | 'warning' | 'danger' | 'muted';
    label: string;
    icon: React.ReactNode;
  } = alerts.data === undefined
    ? { tone: 'muted', label: 'Checking…', icon: <Loader2 className="size-3 animate-spin" aria-hidden /> }
    : hasErrorAlert
      ? { tone: 'danger', label: 'Issues detected', icon: <AlertCircle className="size-3" aria-hidden /> }
      : hasWarningAlert
        ? { tone: 'warning', label: 'Warnings', icon: <AlertTriangle className="size-3" aria-hidden /> }
        : { tone: 'success', label: 'All systems operational', icon: <CheckCircle2 className="size-3" aria-hidden /> };

  const usageSeries = (usage.data?.points ?? []).slice(-24).map((p) => ({
    t: p.t ?? p.time ?? 0,
    requests: p.requests ?? 0,
    tokens: (p.tokens ?? 0) / 1000,
    cost: (p.cost ?? 0) * 1000,
  }));

  const latencyData = (usage.data?.points ?? []).slice(-24).map((p) => ({
    t: Number(p.t ?? p.time ?? 0),
    p50: p.latencyP50 ?? 0,
    p95: p.latencyP95 ?? 0,
    p99: p.latencyP99 ?? 0,
  }));

  // `ApiProvider` has never carried a `capabilities` array (providers don't
  // declare capabilities — models do, via `model_profiles.modality`), so this
  // used to reduce over `undefined` on every provider and always produce an
  // empty object — the panel below permanently rendered "No capabilities
  // detected" no matter how many providers or models existed. `models` (the
  // same `available_only=true` list the "Available Models" tile already
  // fetches) carries a real `modality` per row, which is also exactly what
  // `MODALITY_TONE` above keys off of.
  const modalityData = (models.data ?? []).reduce<Record<string, number>>((acc, m) => {
    const modality = m.modality ?? 'unknown';
    acc[modality] = (acc[modality] ?? 0) + 1;
    return acc;
  }, {});

  const modalityPie = Object.entries(modalityData).map(([k, v], i) => ({
    label: k,
    value: v,
    color: MODALITY_TONE[k] ? chartColor(MODALITY_TONE[k]) : categoricalColor(i),
  }));

  // These three are derived from queries that can legitimately resolve to an
  // empty array (`?? []`), which is never `null`/`undefined` — so gate them
  // on the source query's `isLoading` before handing them to `DataState`,
  // otherwise an empty-but-still-loading array would render the empty state
  // a beat before the real one ever gets a chance to load.
  const usageSeriesData = usage.isLoading ? undefined : usageSeries;
  const latencyChartData = usage.isLoading ? undefined : latencyData;
  const modalityPieData = models.isLoading ? undefined : modalityPie;

  // Routing quality: model selection distribution from recent decisions
  const modelDistribution = React.useMemo(() => {
    const list = decisions.data ?? [];
    const counts: Record<string, number> = {};
    for (const d of list) {
      const key = d.selected_model ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, count], i) => ({
      name,
      count,
      color: categoricalColor(i),
    }));
  }, [decisions.data]);

  // Onboarding: a state-aware getting-started checklist, not a one-shot
  // dismissible banner. Three signals, each cheaply available from data the
  // Dashboard already fetches (or one extra lightweight query above):
  //   1. hasProviders  — providers.data non-empty (existing signal)
  //   2. hasApiKey     — apiKeysQuery.data non-empty (Admin.listApiKeys)
  //   3. hasSentRequest — requests24h > 0 from the dashboard stats/live stream
  // (3) is a 24h-window proxy, not a lifetime "ever sent a request" count —
  // no lifetime total-requests field is wired into any query the Dashboard
  // holds today, so this is the cheapest available stand-in. A user whose
  // most recent request was >24h ago would see step 3 re-open.
  const hasProviders = (providers.data ?? []).length > 0;
  const hasApiKey = (apiKeysQuery.data ?? []).length > 0;
  const hasSentRequest = (stats?.requests24h ?? 0) > 0;
  const onboardingSignalsLoading = providers.isLoading || apiKeysQuery.isLoading || statsLoading;
  const completedStepCount = [hasProviders, hasApiKey, hasSentRequest].filter(Boolean).length;
  const setupComplete = completedStepCount === 3;

  // Collapsing keeps the checklist reachable as a compact chip instead of
  // permanently discarding it — it only ever disappears once setup is
  // actually complete, regardless of collapse state.
  const COLLAPSE_KEY = 'dmrx-onboarding-collapsed';
  const [onboardingCollapsed, setOnboardingCollapsed] = React.useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch { return false; }
  });
  const showOnboardingSection = !setupComplete && !onboardingSignalsLoading;

  const collapseOnboarding = () => {
    setOnboardingCollapsed(true);
    try { localStorage.setItem(COLLAPSE_KEY, 'true'); } catch { /* private browsing — ignore */ }
  };
  const expandOnboarding = () => {
    setOnboardingCollapsed(false);
    try { localStorage.setItem(COLLAPSE_KEY, 'false'); } catch { /* private browsing — ignore */ }
  };

  const onboardingSteps = [
    {
      step: 1,
      icon: Boxes,
      title: 'Add a provider',
      done: hasProviders,
      description: hasProviders
        ? 'A provider is connected.'
        : 'Start free with no key required, or connect your own OpenAI, Anthropic, Ollama, etc.',
      links: hasProviders
        ? [{ label: 'Manage providers', href: '/providers' }]
        : [
            { label: 'Start free — no key required', href: '/free-tier' },
            { label: 'Add your own provider', href: '/providers' },
          ],
    },
    {
      step: 2,
      icon: Key,
      title: 'Create an API key',
      done: hasApiKey,
      description: hasApiKey
        ? 'An API key has been created.'
        : 'Set up a tenant and generate a key to authenticate requests.',
      links: [{ label: hasApiKey ? 'Manage keys' : 'Create a key', href: '/tenants' }],
    },
    {
      step: 3,
      icon: FlaskConical,
      title: 'Test in Playground',
      done: hasSentRequest,
      description: hasSentRequest
        ? 'A request has been routed in the last 24h.'
        : 'Send a message through the gateway and see routing in action.',
      links: [{ label: hasSentRequest ? 'Open Playground' : 'Test in Playground', href: '/playground' }],
    },
  ];

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Dashboard"
        description="Real-time view of routing, cost, and provider health"
        icon={<Activity className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={systemStatus.tone} size="md" icon={systemStatus.icon}>
              {systemStatus.label}
            </Badge>
            <Badge tone={connection === 'open' ? 'success' : 'muted'} size="md" icon={<Activity className="size-3" aria-hidden />}>
              {connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Polling'}
            </Badge>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/routing">
                View routing
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mt-5">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="observability">
              <Bell className="size-3" aria-hidden />
              Observability
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">

      {/* Getting Started onboarding — collapses to a compact progress chip
          instead of being permanently dismissible, and hides itself only
          once every step is genuinely complete. */}
      {showOnboardingSection && (
        onboardingCollapsed ? (
          <button
            type="button"
            onClick={expandOnboarding}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-fg hover:border-primary/30 hover:bg-primary/10 transition-colors"
            aria-label={`Setup ${completedStepCount} of 3 steps complete — expand checklist`}
          >
            <Boxes className="size-3.5 text-primary" aria-hidden />
            Setup {completedStepCount}/3
            <ChevronRight className="size-3 text-fg-subtle" aria-hidden />
          </button>
        ) : (
          <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">Get started with DMR-X</h3>
                <p className="text-xs text-fg-muted mt-1">
                  Connect a provider, generate an API key, and send your first request.
                </p>
              </div>
              <button
                onClick={collapseOnboarding}
                className="text-fg-subtle hover:text-fg-muted transition-colors shrink-0"
                aria-label="Collapse setup checklist"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {onboardingSteps.map((item) => (
                <div
                  key={item.step}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
                    item.done ? 'border-success/20 bg-success/5' : 'border-border bg-surface-1'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                        item.done ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : (
                        <item.icon className="size-4" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-bold', item.done ? 'text-success' : 'text-primary')}>
                          {item.done ? 'DONE' : `STEP ${item.step}`}
                        </span>
                        <h4 className="text-xs font-semibold text-fg">{item.title}</h4>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                  {!item.done && (
                    <div className="flex flex-col items-start gap-1 pl-11">
                      {item.links.map((l) => (
                        <Link
                          key={l.href}
                          to={l.href}
                          className="group inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          {l.label}
                          <ChevronRight className="size-3 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Above the fold: primary KPIs ── */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DataState
          data={stats}
          isLoading={statsLoading}
          error={statsQuery.error}
          onRetry={() => void statsQuery.refetch()}
          loading={
            <>
              <StatTileSkeleton label="Requests (24h)" icon={<Zap className="size-3.5" />} />
              <StatTileSkeleton label="Cost (24h)" icon={<DollarSign className="size-3.5" />} tone="warning" />
              <StatTileSkeleton label="Avg latency" icon={<Clock className="size-3.5" />} tone="primary" />
            </>
          }
        >
          {(s) => (
            <>
              <StatTile
                label="Requests (24h)"
                value={formatNumber(s.requests24h ?? 0)}
                icon={<Zap className="size-3.5" />}
                sparkline={usageSeries.map((p) => p.requests)}
              />
              <StatTile
                label="Cost (24h)"
                value={formatCompactCurrency(s.cost24h ?? 0)}
                icon={<DollarSign className="size-3.5" />}
                tone="warning"
                sparkline={usageSeries.map((p) => p.cost)}
              />
              <StatTile
                label="Avg latency"
                value={formatDuration(s.avgLatencyMs ?? 0)}
                icon={<Clock className="size-3.5" />}
                tone="primary"
                delta={s.latencyDelta ?? undefined}
                deltaLabel="vs yesterday"
                deltaTrend="down-good"
                sparkline={latencyData.map((p) => p.p95)}
              />
            </>
          )}
        </DataState>
        <DataState
          data={providers.data}
          isLoading={providers.isLoading}
          error={providers.error}
          onRetry={() => void providers.refetch()}
          loading={<StatTileSkeleton label="Providers" icon={<Globe className="size-3.5" />} tone="accent" />}
        >
          {() => (
            <StatTile
              label="Providers"
              value={`${providerStats.withKeys}/${providerStats.total}`}
              icon={<Globe className="size-3.5" />}
              tone="accent"
              hint={providerStats.free > 0 ? `${providerStats.free} free, ${providerStats.paid} paid` : '—'}
            />
          )}
        </DataState>
      </div>

      {/* ── Second row: active agents, free savings, provider health ── */}
      <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DataState
          data={agentInstances.data?.items}
          isLoading={agentInstances.isLoading}
          error={agentInstances.error}
          onRetry={() => void agentInstances.refetch()}
          loading={<StatTileSkeleton label="Active Agents" icon={<Bot className="size-3.5" />} tone="success" />}
        >
          {() => (
            <StatTile
              label="Active Agents"
              value={agentStats.active}
              icon={<Bot className="size-3.5" />}
              tone="success"
              hint={`${agentStats.total} total · ${agentStats.paused} paused`}
            />
          )}
        </DataState>
        <DataState
          data={freeTierSummary.data?.summary}
          isLoading={freeTierSummary.isLoading}
          error={freeTierSummary.error}
          onRetry={() => void freeTierSummary.refetch()}
          loading={<StatTileSkeleton label="Free Savings" icon={<TrendingUp className="size-3.5" />} tone="success" />}
        >
          {(s) => (
            <StatTile
              label="Free Savings"
              value={formatCurrency(s.cost_avoided_usd ?? 0)}
              icon={<TrendingUp className="size-3.5" />}
              tone="success"
              hint={`${formatNumber(s.total_free_models ?? 0)} free models`}
            />
          )}
        </DataState>
        <DataState
          data={stats}
          isLoading={statsLoading}
          error={statsQuery.error}
          onRetry={() => void statsQuery.refetch()}
          loading={<StatTileSkeleton label="Provider Health" icon={<Activity className="size-3.5" />} tone="primary" />}
        >
          {(s) => (
            <StatTile
              label="Provider Health"
              value={`${Math.round((s.provider_health ?? 0) * 100)}%`}
              icon={<Activity className="size-3.5" />}
              tone="primary"
              hint={`${providerStats.withKeys} active keys`}
            />
          )}
        </DataState>
        <DataState
          data={models.data}
          isLoading={models.isLoading}
          error={models.error}
          onRetry={() => void models.refetch()}
          loading={<StatTileSkeleton label="Available Models" icon={<Server className="size-3.5" />} tone="success" />}
        >
          {(list) => (
            <StatTile
              label="Available Models"
              value={list.length}
              icon={<Server className="size-3.5" />}
              tone="success"
              hint="from providers with active keys"
            />
          )}
        </DataState>
      </div>

      {/* ── Main panels: live routing activity + routing quality ── */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Live routing activity</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Live stream · last {decisions.data?.length ?? 0} decisions</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/requests">
                All requests
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={decisions.data}
              isLoading={decisions.isLoading}
              error={decisions.error}
              onRetry={() => void decisions.refetch()}
              skeletonRows={5}
              empty={{
                icon: <Activity className="size-8" />,
                title: 'No routing decisions yet',
                description: 'Send a request to see live routing decisions.',
              }}
            >
              {(list) => (
                <div className="flex flex-col gap-0.5">
                  {list.slice(0, 6).map((d) => (
                    <RouteDecisionRow key={d.id} decision={d} />
                  ))}
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Routing quality</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Success & fallback rate</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/routing">
                Details
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0 flex flex-col gap-3">
            <DataState
              data={stats}
              isLoading={statsLoading}
              error={statsQuery.error}
              onRetry={() => void statsQuery.refetch()}
              loading={
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              }
            >
              {(s) => (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-[10px] text-fg-muted">Success rate</div>
                    <div className="text-lg font-semibold text-success tabular-nums">
                      {((s.successRate ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-[10px] text-fg-muted">Fallback rate</div>
                    <div className="text-lg font-semibold text-warning tabular-nums">
                      {((s.fallbackRate ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}
            </DataState>
            <div>
              <div className="text-[10px] text-fg-muted mb-2">Model selection distribution</div>
              <DataState
                data={modelDistribution}
                isLoading={decisions.isLoading}
                error={decisions.error}
                onRetry={() => void decisions.refetch()}
                loading={<Skeleton className="h-[100px] w-full" />}
                empty={{
                  title: 'No data',
                  description: 'Model distribution appears after requests are routed.',
                }}
              >
                {(data) => (
                  <BarSeriesChart
                    data={data}
                    xKey="name"
                    height={100}
                    bars={[{ key: 'count', name: 'Selections', color: chartColor('primary') }]}
                  />
                )}
              </DataState>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Free inference + Savings panels ── */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Free inference</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Free capacity used & remaining</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/free-tier">
                Free tier
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={freeTierSummary.data?.summary}
              isLoading={freeTierSummary.isLoading}
              error={freeTierSummary.error}
              onRetry={() => void freeTierSummary.refetch()}
              loading={
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              }
            >
              {(s) => (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-[10px] text-fg-muted">Free models</div>
                    <div className="text-lg font-semibold text-fg tabular-nums">
                      {formatNumber(s.total_free_models ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-[10px] text-fg-muted">Healthy providers</div>
                    <div className="text-lg font-semibold text-success tabular-nums">
                      {formatNumber(s.healthy_free_providers ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-[10px] text-fg-muted">Monthly budget</div>
                    <div className="text-lg font-semibold text-fg tabular-nums">
                      {formatNumber(s.total_monthly_budget ?? 0, true)}
                    </div>
                    <div className="text-[10px] text-fg-subtle">tokens</div>
                  </div>
                </div>
              )}
            </DataState>
            <div className="mt-3">
              <div className="text-[10px] text-fg-muted mb-2">Free providers & limits</div>
              <DataState
                data={freeTierSummary.data?.providers}
                isLoading={freeTierSummary.isLoading}
                error={freeTierSummary.error}
                onRetry={() => void freeTierSummary.refetch()}
                loading={<Skeleton className="h-[60px] w-full" />}
                empty={{
                  title: 'No free providers',
                  description: 'Add a free key to see capacity.',
                  action: (
                    <Button size="sm" variant="secondary" asChild>
                      <Link to="/free-tier">Add free key</Link>
                    </Button>
                  ),
                }}
              >
                {(list) => (
                  <div className="space-y-2">
                    {list.slice(0, 3).map((p) => (
                      <div key={p.provider_name} className="flex items-center gap-2 text-xs">
                        <span className={cn('size-2 rounded-full', p.is_healthy ? 'bg-success' : 'bg-danger')} aria-hidden />
                        <span className="truncate text-fg">{p.provider_name}</span>
                        <span className="ml-auto text-fg-subtle tabular-nums">
                          {formatNumber(p.total_monthly_budget, true)} tokens/mo
                        </span>
                      </div>
                    ))}
                    {list.length > 3 && (
                      <p className="text-[10px] text-fg-subtle">+{list.length - 3} more providers</p>
                    )}
                  </div>
                )}
              </DataState>
            </div>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Savings</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Free vs paid avoided spend</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/cost">
                Cost dashboard
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={savings.data}
              isLoading={savings.isLoading}
              error={savings.error}
              onRetry={() => void savings.refetch()}
              loading={<Skeleton className="h-[200px] w-full" />}
              empty={{
                icon: <TrendingUp className="size-8" />,
                title: 'No savings yet',
                description: 'Savings appear once requests route to free models.',
              }}
            >
              {(data) => (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                      <div className="text-[10px] text-fg-muted">Total avoided</div>
                      <div className="text-lg font-semibold text-success tabular-nums">
                        {formatCurrency(data.costAvoidedUsd)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-2 p-3">
                      <div className="text-[10px] text-fg-muted">Free requests</div>
                      <div className="text-lg font-semibold text-fg tabular-nums">
                        {formatNumber(data.freeRequests, true)}
                      </div>
                    </div>
                  </div>
                  <TimeSeriesChart
                    data={data.daily}
                    xKey="date"
                    height={120}
                    series={[
                      { key: 'costAvoidedUsd', name: 'Cost avoided (USD)', color: chartColor('success'), fillOpacity: 0.15 },
                    ]}
                    yFormatter={(v) => formatCurrency(Number(v))}
                  />
                </>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      {/* ── Active agents panel ── */}
      <div className="mt-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Active agents</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Currently running agent instances</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/runtime">
                Runtime
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={agentInstances.data?.items}
              isLoading={agentInstances.isLoading}
              error={agentInstances.error}
              onRetry={() => void agentInstances.refetch()}
              skeletonRows={3}
              empty={{
                icon: <Cpu className="size-8" />,
                title: 'No active agents',
                description: 'Deploy an agent to see it running here.',
                action: (
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/agents">Go to agents</Link>
                  </Button>
                ),
              }}
            >
              {(list) => (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {list.slice(0, 6).map((instance) => (
                    <div
                      key={instance.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3"
                    >
                      <div className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                        instance.status === 'active' ? 'bg-success/10 text-success' : 'bg-surface-1 text-fg-muted'
                      )}>
                        <Bot className="size-4" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-fg truncate">
                            {instance.definitionHumanName ?? instance.definitionName ?? 'Unnamed'}
                          </span>
                          <span className={cn(
                            'text-[10px] font-medium',
                            instance.status === 'active' ? 'text-success' : 'text-fg-muted'
                          )}>
                            {instance.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-fg-subtle">
                          {instance.definitionModelTier ?? 'default'} tier · {instance.executionCount} runs
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      {/* ── Existing panels: request volume, capabilities, alerts, latency ── */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <CardTitle>Request volume</CardTitle>
              <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden /> Requests
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Tokens (k)
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={usageSeriesData}
              isLoading={usage.isLoading}
              error={usage.error}
              onRetry={() => void usage.refetch()}
              loading={<Skeleton className="h-[220px] w-full" />}
              empty={{
                title: 'No request volume yet',
                description: 'Send a request through the gateway to see volume trends.',
              }}
            >
              {(series) => (
                <TimeSeriesChart
                  data={series}
                  xKey="t"
                  height={220}
                  series={[
                    { key: 'requests', name: 'Requests', color: chartColor('primary') },
                    { key: 'tokens', name: 'Tokens (k)', color: chartColor('accent') },
                  ]}
                  xFormatter={(v) =>
                    new Date(v as number).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                  }
                />
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Capabilities</CardTitle>
            <p className="text-[10px] text-fg-muted">By model modality</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={modalityPieData}
              isLoading={models.isLoading}
              error={models.error}
              onRetry={() => void models.refetch()}
              loading={
                <div className="h-[140px] flex items-center justify-center">
                  <Skeleton className="size-32 rounded-full" />
                </div>
              }
              empty={{
                title: 'No capabilities detected',
                description: 'Connect a provider to see its capability breakdown.',
              }}
            >
              {(pie) => (
                <DonutChart
                  data={pie}
                  size={140}
                  thickness={16}
                  showLegend
                  showLabels
                />
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <CardTitle>Active alerts</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/observability">
                All
                <ChevronRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0 flex flex-col gap-2">
            <DataState
              data={alerts.data}
              isLoading={alerts.isLoading}
              error={alerts.error}
              onRetry={() => void alerts.refetch()}
              skeletonRows={3}
              empty={{
                icon: <CheckCircle2 className="size-8 text-success" />,
                title: 'No active alerts',
                description: 'Everything is operating normally.',
              }}
            >
              {(list) => (
                <>
                  {list.slice(0, 4).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
                    >
                      <AlertCircle
                        aria-hidden
                        className={
                          a.severity === 'error'
                            ? 'size-3.5 text-danger shrink-0 mt-0.5'
                            : a.severity === 'warning'
                              ? 'size-3.5 text-warning shrink-0 mt-0.5'
                              : 'size-3.5 text-info shrink-0 mt-0.5'
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-fg truncate">{a.title}</p>
                        <p className="text-[10px] text-fg-subtle">{a.at ? timeAgo(a.at) : ''}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Latency p50 / p95 / p99</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">End-to-end request latency</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={latencyChartData}
              isLoading={usage.isLoading}
              error={usage.error}
              onRetry={() => void usage.refetch()}
              loading={<Skeleton className="h-[200px] w-full" />}
              empty={{
                title: 'No latency data yet',
                description: 'Send a request to see end-to-end latency metrics.',
              }}
            >
              {(series) => <LatencyChart data={series} height={200} />}
            </DataState>
          </CardContent>
        </Card>
      </div>

          </TabsContent>

          <TabsContent value="observability">
            <LazyTab>
              <ObservabilityTab />
            </LazyTab>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
