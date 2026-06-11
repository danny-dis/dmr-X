import * as React from 'react';
import { Link } from 'react-router';
import {
  Activity,
  Zap,
  DollarSign,
  Globe,
  ArrowRight,
  TrendingUp,
  Brain,
  Bot,
  Wrench,
  Cog,
  Clock,
  Hash,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Skeleton } from '@/components/primitives/Skeleton';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { DonutChart, Sunburst } from '@/components/charts/DonutChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { ModalityBadge } from '@/icons/Modality';
import { ProviderHub } from '@/icons/Provider';
import { HealthDot } from '@/icons/Status';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import {
  formatNumber,
  formatDuration,
  formatCurrency,
  formatCompactCurrency,
  timeAgo,
} from '@/lib/formatters';
import type {
  ApiDashboardStats,
  ApiRouteDecision,
  ApiUsagePoint,
  ApiProvider,
  ApiAlert,
} from '@/types/api';

const TONE_COLORS = {
  primary: '#7C5CFF',
  accent: '#22D3EE',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  pink: '#F472B6',
  lime: '#A3E635',
};

export function DashboardPage() {
  const stats = useApiData<ApiDashboardStats>(() => Admin.dashboard(), [], { refetchInterval: 5000 });
  const decisions = useApiData<ApiRouteDecision[]>(
    () => Admin.listRouteDecisions({ limit: 8 }),
    [],
    { refetchInterval: 4000 }
  );
  const usage = useApiData<{ points: ApiUsagePoint[]; total: number }>(
    () => Admin.getUsage('hour'),
    [],
    { refetchInterval: 10000 }
  );
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const alerts = useApiData<ApiAlert[]>(() => Admin.listAlerts(), [], { refetchInterval: 15000 });

  const usageSeries = (usage.data?.points ?? []).slice(-24).map((p) => ({
    t: p.t,
    requests: p.requests ?? 0,
    tokens: (p.tokens ?? 0) / 1000,
    cost: (p.cost ?? 0) * 1000,
  }));

  const latencyData = (usage.data?.points ?? []).slice(-24).map((p) => ({
    t: p.t,
    p50: p.latencyP50 ?? 0,
    p95: p.latencyP95 ?? 0,
    p99: p.latencyP99 ?? 0,
  }));

  const online = (providers.data ?? []).filter((p) => p.health?.status !== 'down').length;
  const total = (providers.data ?? []).length;

  const modalityData = (providers.data ?? []).reduce<Record<string, number>>((acc, p) => {
    p.capabilities?.forEach((c) => {
      acc[c] = (acc[c] ?? 0) + 1;
    });
    return acc;
  }, {});

  const modalityPie = Object.entries(modalityData).map(([k, v]) => ({
    name: k,
    value: v,
    color: MODALITY_COLOR[k] ?? TONE_COLORS.primary,
  }));

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Dashboard"
        description="Real-time view of routing, cost, and provider health"
        icon={<Activity className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="success" size="md" icon={<CheckCircle2 className="size-3" />}>
              All systems operational
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

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Requests (24h)"
          value={stats.data ? formatNumber(stats.data.requests24h ?? 0) : '—'}
          icon={<Zap className="size-3.5" />}
          delta={stats.data?.requestsDelta ?? 0}
          deltaLabel="vs yesterday"
          deltaTrend="up-good"
          sparkline={usageSeries.map((p) => p.requests)}
          loading={stats.isLoading}
        />
        <StatTile
          label="Cost (24h)"
          value={stats.data ? formatCompactCurrency(stats.data.cost24h ?? 0) : '—'}
          icon={<DollarSign className="size-3.5" />}
          tone="warning"
          delta={stats.data?.costDelta ?? 0}
          deltaLabel="vs yesterday"
          deltaTrend="down-good"
          sparkline={usageSeries.map((p) => p.cost)}
          loading={stats.isLoading}
        />
        <StatTile
          label="Avg latency"
          value={stats.data ? formatDuration(stats.data.avgLatencyMs ?? 0) : '—'}
          icon={<Clock className="size-3.5" />}
          tone="primary"
          delta={stats.data?.latencyDelta ?? 0}
          deltaLabel="vs yesterday"
          deltaTrend="down-good"
          sparkline={latencyData.map((p) => p.p95)}
          loading={stats.isLoading}
        />
        <StatTile
          label="Providers"
          value={`${online}/${total}`}
          icon={<Globe className="size-3.5" />}
          tone="accent"
          hint={total > 0 ? `${Math.round((online / total) * 100)}% online` : '—'}
          loading={stats.isLoading}
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
            ) : (
              <TimeSeriesChart
                data={usageSeries}
                xKey="t"
                height={220}
                series={[
                  { key: 'requests', name: 'Requests', color: TONE_COLORS.primary },
                  { key: 'tokens', name: 'Tokens (k)', color: TONE_COLORS.accent },
                ]}
                xFormatter={(v) =>
                  new Date(v as number).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }
              />
            )}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Capabilities</CardTitle>
            <p className="text-[10px] text-fg-muted">By provider capability</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {modalityPie.length > 0 ? (
              <DonutChart
                data={modalityPie}
                size={140}
                thickness={16}
                showLegend
                showLabels
              />
            ) : (
              <div className="h-[140px] flex items-center justify-center text-fg-subtle text-xs">
                <Skeleton className="size-32 rounded-full" />
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

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Latency p50 / p95 / p99</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">End-to-end request latency</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {latencyData.length > 0 ? (
              <LatencyChart data={latencyData} height={200} />
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Intelligence layers</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Distribution of recent traffic</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="grid grid-cols-5 gap-1.5">
              {(['brain', 'thinker', 'executor', 'worker', 'temp_worker'] as const).map((l) => (
                <IntelligenceBadge key={l} layer={l} size="md" showLabel />
              ))}
            </div>
            <p className="text-[10px] text-fg-subtle mt-3">
              Each layer represents a different request complexity. The router picks a layer based on the
              request and routes to the optimal provider.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

const MODALITY_COLOR: Record<string, string> = {
  llm: TONE_COLORS.primary,
  diffusion: TONE_COLORS.pink,
  embedding: TONE_COLORS.accent,
  audio_tts: TONE_COLORS.warning,
  audio_stt: TONE_COLORS.success,
  video: TONE_COLORS.lime,
  music: TONE_COLORS.danger,
  reranking: '#A78BFA',
  moderation: '#FB7185',
  code_completion: TONE_COLORS.accent,
};
