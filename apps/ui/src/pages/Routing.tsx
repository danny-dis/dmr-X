import { Activity, GitBranch } from 'lucide-react';
import * as React from 'react';

import { DonutChart, Sunburst } from '@/components/charts/DonutChart';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { useApiData } from '@/hooks/useApiData';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { Admin } from '@/lib/admin';
import { categoricalColor, chartColor } from '@/lib/chartPalette';
import type { ApiRouteDecision, ApiProvider, ApiUsagePoint } from '@/types/api';

const LAYER_ORDER = ['brain', 'thinker', 'executor', 'worker', 'temp_worker'] as const;

const LAYER_TONE: Record<(typeof LAYER_ORDER)[number], 'primary' | 'default' | 'success' | 'warning' | 'danger'> = {
  brain: 'primary',
  thinker: 'default',
  executor: 'success',
  worker: 'warning',
  temp_worker: 'danger',
};

function layerChartColor(layer: (typeof LAYER_ORDER)[number]): string {
  switch (layer) {
    case 'brain':
      return chartColor('primary');
    case 'thinker':
      return chartColor('accent');
    case 'executor':
      return chartColor('success');
    case 'worker':
      return chartColor('warning');
    case 'temp_worker':
      return chartColor('pink');
  }
}

export function RoutingPage() {
  const decisions = useApiData<ApiRouteDecision[]>(
    () => Admin.listRouteDecisions({ limit: 50 }),
    [],
    { refetchInterval: 3000 }
  );
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const usage = useApiData<{ points: ApiUsagePoint[] }>(
    () => Admin.getUsage('hour'),
    [],
    { refetchInterval: 10000 }
  );

  const byLayer = (decisions.data ?? []).reduce<Record<string, number>>((acc, d) => {
    const l = d.task_type ?? 'brain';
    acc[l] = (acc[l] ?? 0) + 1;
    return acc;
  }, {});

  const layerData = LAYER_ORDER.map((l) => ({
    label: l,
    value: byLayer[l] ?? 0,
    color: layerChartColor(l),
  }));

  const byReason = (decisions.data ?? []).reduce<Record<string, number>>((acc, d) => {
    const r = d.decision_reason ?? 'unknown';
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});

  const sunburstData = Object.entries(byReason).map(([k, v], i) => ({
    label: k,
    value: v,
    color: categoricalColor(i),
  }));

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Routing"
        description="Real-time routing decisions, layer distribution, and topology"
        icon={<Activity className="size-5" />}
        actions={
          <Badge tone="primary" icon={<GitBranch className="size-3" aria-hidden />}>
            {(decisions.data ?? []).length} decisions tracked
          </Badge>
        }
      />

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {LAYER_ORDER.map((l) => (
          <StatTile
            key={l}
            label={l.replace('_', ' ')}
            value={byLayer[l] ?? 0}
            icon={<span aria-hidden="true"><IntelligenceBadge layer={l} size={16} showLabel={false} /></span>}
            tone={LAYER_TONE[l]}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="px-0 pt-0">
            <div className="flex items-center justify-between">
              <CardTitle>Traffic composition</CardTitle>
              <Badge tone="muted" size="sm">last {decisions.data?.length ?? 0} requests</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={usage.data}
              isLoading={usage.isLoading}
              error={usage.error}
              onRetry={usage.refetch}
              loading={<Skeleton className="h-[220px] w-full" />}
              isEmpty={(d) => (d.points ?? []).length === 0}
              empty={{
                title: 'No traffic data yet',
                description: 'Traffic composition appears once requests start flowing through the router.',
              }}
            >
              {(u) => {
                const series = (u.points ?? []).slice(-24).map((p) => ({
                  t: p.t ?? 0,
                  routed: p.requests ?? 0,
                  cache_hits: p.cacheHits ?? 0,
                  fallbacks: p.fallbacks ?? 0,
                }));
                return (
                  <TimeSeriesChart
                    data={series}
                    xKey="t"
                    height={220}
                    series={[
                      { key: 'routed', name: 'Routed', color: chartColor('primary'), fillOpacity: 0.2 },
                      { key: 'cache_hits', name: 'Cache hits', color: chartColor('accent'), fillOpacity: 0.15 },
                      { key: 'fallbacks', name: 'Fallbacks', color: chartColor('warning'), fillOpacity: 0.15 },
                    ]}
                    stacked
                    xFormatter={(v) => new Date(v as number).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  />
                );
              }}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Layer split</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={decisions.data}
              isLoading={decisions.isLoading}
              error={decisions.error}
              onRetry={decisions.refetch}
              loading={<Skeleton className="size-32 rounded-full mx-auto" />}
              empty={{
                title: 'No decisions yet',
                description: 'The layer split renders once routing decisions start coming in.',
              }}
            >
              {() => <DonutChart data={layerData} size={140} thickness={16} showLegend showLabels />}
            </DataState>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Routing topology</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Live gateway → router → providers → models</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={providers.data}
              isLoading={providers.isLoading}
              error={providers.error}
              onRetry={providers.refetch}
              loading={<Skeleton className="h-[260px] w-full" />}
            >
              {(providerList) => (
                <TopologyGraph
                  nodes={[
                    { id: 'gw', label: 'Gateway', type: 'gateway', status: 'online' },
                    { id: 'rt', label: 'Router', type: 'router', status: 'online' },
                    ...providerList.slice(0, 4).map((p) => ({
                      id: p.id,
                      label: p.name,
                      type: 'provider' as const,
                      status: (p.health?.status ?? 'unknown') as 'online' | 'degraded' | 'offline' | 'unknown',
                    })),
                  ]}
                  edges={[
                    { source: 'gw', target: 'rt', active: true, weight: 3 },
                    ...providerList.slice(0, 4).map((p) => ({
                      source: 'rt',
                      target: p.id,
                      active: true,
                      weight: 1.5,
                    })),
                  ]}
                  height={260}
                />
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Routing reason distribution</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Why the router chose each provider</p>
          </CardHeader>
          <CardContent className="px-0 pb-0 flex justify-center">
            <DataState
              data={decisions.data}
              isLoading={decisions.isLoading}
              error={decisions.error}
              onRetry={decisions.refetch}
              loading={<Skeleton className="size-[260px] rounded-full" />}
              empty={{
                title: 'No decisions yet',
                description: 'Reason distribution renders once routing decisions start coming in.',
              }}
            >
              {() => <Sunburst data={sunburstData} size={260} />}
            </DataState>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Recent decisions</h3>
            <Badge tone="muted" size="sm">{(decisions.data ?? []).length} entries</Badge>
          </div>
          <div className="p-2 max-h-[500px] overflow-y-auto">
            <DataState
              data={decisions.data}
              isLoading={decisions.isLoading}
              error={decisions.error}
              onRetry={decisions.refetch}
              loading={
                <div className="flex flex-col gap-1.5 p-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              }
              empty={{
                icon: <GitBranch className="size-8" aria-hidden />,
                title: 'No routing decisions yet',
                description: 'Decisions will appear here once requests start flowing through the gateway.',
              }}
            >
              {(rows) => rows.map((d) => <RouteDecisionRow key={d.id} decision={d} expanded />)}
            </DataState>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
