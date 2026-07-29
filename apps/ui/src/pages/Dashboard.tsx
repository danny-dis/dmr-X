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
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { DonutChart } from '@/components/charts/DonutChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load Observability tab content
const ObservabilityTab = React.lazy(() => import('@/pages/Observability').then(m => ({ default: m.ObservabilityPage })));
import { chartColor, categoricalColor, type ChartTone } from '@/lib/chartPalette';
import { useAlerts } from '@/lib/queries/observability';
import { useModels } from '@/lib/queries/models';
import { useProviders } from '@/lib/queries/providers';
import {
  formatNumber,
  formatDuration,
  formatCompactCurrency,
  timeAgo,
} from '@/lib/formatters';
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

  const availableModelCount = (models.data ?? []).length;

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
    ? { tone: 'muted', label: 'Checking…', icon: <Loader2 className="size-3 animate-spin" /> }
    : hasErrorAlert
      ? { tone: 'danger', label: 'Issues detected', icon: <AlertCircle className="size-3" /> }
      : hasWarningAlert
        ? { tone: 'warning', label: 'Warnings', icon: <AlertTriangle className="size-3" /> }
        : { tone: 'success', label: 'All systems operational', icon: <CheckCircle2 className="size-3" /> };

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

  const modalityData = (providers.data ?? []).reduce<Record<string, number>>((acc, p) => {
    p.capabilities?.forEach((c) => {
      acc[c] = (acc[c] ?? 0) + 1;
    });
    return acc;
  }, {});

  const modalityPie = Object.entries(modalityData).map(([k, v], i) => ({
    label: k,
    value: v,
    color: MODALITY_TONE[k] ? chartColor(MODALITY_TONE[k]) : categoricalColor(i),
  }));

  // Onboarding: show getting-started banner when no providers are configured
  const DISMISS_KEY = 'dmrx-onboarding-dismissed';
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  const hasProviders = (providers.data ?? []).length > 0;
  const showOnboarding = !onboardingDismissed && !hasProviders && !providers.isLoading;

  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* private browsing — ignore */ }
  };

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
            <Badge tone={connection === 'open' ? 'success' : 'muted'} size="md" icon={<Activity className="size-3" />}>
              {connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Polling'}
            </Badge>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/routing">
                View routing
                <ArrowRight className="size-3" />
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
              <Bell className="size-3" />
              Observability
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">

      {/* Getting Started onboarding banner */}
      {showOnboarding && (
        <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Get started with DMR-X</h3>
              <p className="text-xs text-fg-muted mt-1">
                Connect a provider, generate an API key, and send your first request.
              </p>
            </div>
            <button
              onClick={dismissOnboarding}
              className="text-fg-subtle hover:text-fg-muted transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                step: 1,
                icon: Boxes,
                title: 'Add a provider',
                description: 'Connect OpenAI, Anthropic, Ollama, or any compatible provider.',
                href: '/providers',
              },
              {
                step: 2,
                icon: Key,
                title: 'Create an API key',
                description: 'Set up a tenant and generate a key to authenticate requests.',
                href: '/tenants',
              },
              {
                step: 3,
                icon: FlaskConical,
                title: 'Test in Playground',
                description: 'Send a message through the gateway and see routing in action.',
                href: '/playground',
              },
            ].map((item) => (
              <Link
                key={item.step}
                to={item.href}
                className="group flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3 hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-primary">STEP {item.step}</span>
                    <h4 className="text-xs font-semibold text-fg">{item.title}</h4>
                  </div>
                  <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed">{item.description}</p>
                </div>
                <ChevronRight className="size-3.5 text-fg-subtle group-hover:text-primary transition-colors shrink-0 mt-1" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Requests (24h)"
          value={stats ? formatNumber(stats.requests24h ?? 0) : '—'}
          icon={<Zap className="size-3.5" />}
          sparkline={usageSeries.map((p) => p.requests)}
          loading={statsLoading}
        />
        <StatTile
          label="Cost (24h)"
          value={stats ? formatCompactCurrency(stats.cost24h ?? 0) : '—'}
          icon={<DollarSign className="size-3.5" />}
          tone="warning"
          sparkline={usageSeries.map((p) => p.cost)}
          loading={statsLoading}
        />
        <StatTile
          label="Avg latency"
          value={stats ? formatDuration(stats.avgLatencyMs ?? 0) : '—'}
          icon={<Clock className="size-3.5" />}
          tone="primary"
          delta={stats?.latencyDelta ?? 0}
          deltaLabel="vs yesterday"
          deltaTrend="down-good"
          sparkline={latencyData.map((p) => p.p95)}
          loading={statsLoading}
        />
        <StatTile
          label="Providers"
          value={`${providerStats.withKeys}/${providerStats.total}`}
          icon={<Globe className="size-3.5" />}
          tone="accent"
          hint={providerStats.free > 0 ? `${providerStats.free} free, ${providerStats.paid} paid` : '—'}
          loading={providers.isLoading}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Available Models"
          value={availableModelCount}
          icon={<Server className="size-3.5" />}
          tone="success"
          hint="from providers with active keys"
          loading={models.isLoading}
        />
        <StatTile
          label="Free Providers"
          value={providerStats.free}
          icon={<KeyRound className="size-3.5" />}
          tone="success"
          hint="zero-cost routing available"
          loading={providers.isLoading}
        />
        <StatTile
          label="Paid Providers"
          value={providerStats.paid}
          icon={<DollarSign className="size-3.5" />}
          tone="warning"
          hint="usage-based billing"
          loading={providers.isLoading}
        />
        <StatTile
          label="Mixed Providers"
          value={providerStats.mixed}
          icon={<Activity className="size-3.5" />}
          tone="primary"
          hint="free + paid keys"
          loading={providers.isLoading}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <CardTitle>Request volume</CardTitle>
              <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-primary" /> Requests
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-accent" /> Tokens (k)
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {usage.isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : usageSeries.length > 0 ? (
              <TimeSeriesChart
                data={usageSeries}
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
            ) : (
              <div className="h-[220px] flex items-center justify-center text-fg-subtle text-xs">
                No request data yet. Send a request to see volume trends.
              </div>
            )}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Capabilities</CardTitle>
            <p className="text-[10px] text-fg-muted">By provider capability</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!providers.isLoading && modalityPie.length > 0 ? (
              <DonutChart
                data={modalityPie}
                size={140}
                thickness={16}
                showLegend
                showLabels
              />
            ) : providers.isLoading ? (
              <div className="h-[140px] flex items-center justify-center text-fg-subtle text-xs">
                <Skeleton className="size-32 rounded-full" />
              </div>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-fg-subtle text-xs">
                No provider capabilities detected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <div>
              <CardTitle>Recent routing decisions</CardTitle>
              <p className="text-[10px] text-fg-muted mt-0.5">Live stream · last {decisions.data?.length ?? 0}</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/routing">
                All decisions
                <ChevronRight className="size-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {decisions.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : decisions.data && decisions.data.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {decisions.data.slice(0, 6).map((d) => (
                  <RouteDecisionRow key={d.id} decision={d} />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-fg-subtle text-xs">
                No decisions yet. Send a request to see live routing.
              </div>
            )}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0 flex-row items-center justify-between">
            <CardTitle>Active alerts</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/observability">
                All
                <ChevronRight className="size-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0 flex flex-col gap-2">
            {alerts.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : alerts.data && alerts.data.length > 0 ? (
              alerts.data.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
                >
                  <AlertCircle
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
              ))
            ) : (
              <div className="py-8 text-center text-fg-subtle text-xs">
                <CheckCircle2 className="size-5 text-success mx-auto mb-1" />
                No active alerts
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Latency p50 / p95 / p99</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">End-to-end request latency</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!usage.isLoading && latencyData.length > 0 ? (
              <LatencyChart data={latencyData} height={200} />
            ) : usage.isLoading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-fg-subtle text-xs">
                No latency data yet. Send a request to see metrics.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

          </TabsContent>

          <TabsContent value="observability">
            <React.Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
              <ObservabilityTab />
            </React.Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
