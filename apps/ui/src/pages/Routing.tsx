import { Activity, ChevronRight, GitBranch, Info, X } from 'lucide-react';
import * as React from 'react';

import { DonutChart } from '@/components/charts/DonutChart';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/primitives/Drawer';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { categoricalColor, chartColor } from '@/lib/chartPalette';
import { useRouteDecisions, useUsageHistory } from '@/lib/queries/dashboard';
import { usePolicies } from '@/lib/queries/policies';
import { useProviders } from '@/lib/queries/providers';
import { formatCurrency, formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiPolicyRule, ApiRouteDecision } from '@/types/api';

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
    case 'brain': return chartColor('primary');
    case 'thinker': return chartColor('accent');
    case 'executor': return chartColor('success');
    case 'worker': return chartColor('warning');
    case 'temp_worker': return chartColor('pink');
  }
}

export function RoutingPage() {
  const decisions = useRouteDecisions(50, { refetchInterval: 3000 });
  const providers = useProviders({ refetchInterval: 30000 });
  const usage = useUsageHistory('hour', { refetchInterval: 10000 });
  const policies = usePolicies({ refetchInterval: 30000 });
  const [selectedDecision, setSelectedDecision] = React.useState<ApiRouteDecision | null>(null);

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

  // Compute fallback rate from decisions
  const fallbackRate = React.useMemo(() => {
    const list = decisions.data ?? [];
    if (list.length === 0) return 0;
    const fallbacks = list.filter((d) => d.status === 'fallback').length;
    return (fallbacks / list.length) * 100;
  }, [decisions.data]);

  // Compute average routing latency
  const avgLatency = React.useMemo(() => {
    const list = decisions.data ?? [];
    if (list.length === 0) return 0;
    const withLatency = list.filter((d) => d.latency != null);
    if (withLatency.length === 0) return 0;
    return withLatency.reduce((sum, d) => sum + (d.latency ?? 0), 0) / withLatency.length;
  }, [decisions.data]);

  const activePolicies = policies.data ?? [];

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Router"
        description="Routing strategy, active policies, and decision explainability"
        icon={<Activity className="size-5" />}
        actions={
          <Badge tone="primary" icon={<GitBranch className="size-3" aria-hidden />}>
            {(decisions.data ?? []).length} decisions tracked
          </Badge>
        }
      />

      {/* ── KPI row ── */}
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
        <StatTile
          label="Fallback rate"
          value={`${fallbackRate.toFixed(1)}%`}
          icon={<Activity className="size-3.5" />}
          tone={fallbackRate > 10 ? 'warning' : 'success'}
        />
        <StatTile
          label="Avg latency"
          value={formatDuration(avgLatency)}
          icon={<Activity className="size-3.5" />}
          tone="primary"
        />
        <StatTile
          label="Active policies"
          value={activePolicies.length}
          icon={<GitBranch className="size-3.5" />}
          tone="accent"
        />
      </div>

      {/* ── Active policies ── */}
      <div className="mt-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Active routing policies</CardTitle>
            <p className="text-[10px] text-fg-muted">Rules that determine how requests are routed to providers</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={policies.data}
              isLoading={policies.isLoading}
              error={policies.error}
              onRetry={() => policies.refetch()}
              skeletonRows={2}
              empty={{
                title: 'No policies configured',
                description: 'Routing uses default policies. Add custom rules to control routing behavior.',
              }}
            >
              {(list) => (
                <div className="space-y-2">
                  {list.map((policy) => (
                    <div key={policy.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
                      <Badge tone={policy.enabled !== false ? 'success' : 'muted'} variant="soft" size="sm">
                        {policy.enabled !== false ? 'Active' : 'Disabled'}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg">{policy.name}</div>
                        {policy.description && (
                          <div className="text-xs text-fg-muted truncate">{policy.description}</div>
                        )}
                      </div>
                      <Badge tone="neutral" variant="outline" size="sm">{policy.action}</Badge>
                      {policy.priority != null && (
                        <span className="text-xs text-fg-subtle tabular-nums">P{policy.priority}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts row ── */}
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
              onRetry={() => usage.refetch()}
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
              onRetry={() => decisions.refetch()}
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

      {/* ── Topology + Reason ── */}
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
              onRetry={() => providers.refetch()}
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
                      status: (p.status ?? 'unknown') as 'online' | 'degraded' | 'offline' | 'unknown',
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
            <CardTitle>Provider health</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Configured providers and their status</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataState
              data={providers.data}
              isLoading={providers.isLoading}
              error={providers.error}
              onRetry={() => providers.refetch()}
              skeletonRows={4}
              empty={{
                title: 'No providers configured',
                description: 'Add a provider to see health status.',
              }}
            >
              {(list) => (
                <div className="space-y-2">
                  {list.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
                      <div className={`size-2 rounded-full ${
                        p.status === 'online' || p.status === 'healthy' ? 'bg-success' :
                        p.status === 'degraded' ? 'bg-warning' : 'bg-danger'
                      }`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg">{p.name}</div>
                        <div className="text-xs text-fg-muted">{p.adapter_type ?? p.adapterType ?? 'Unknown adapter'}</div>
                      </div>
                      <Badge
                        tone={p.status === 'online' || p.status === 'healthy' ? 'success' : p.status === 'degraded' ? 'warning' : 'danger'}
                        variant="soft"
                        size="sm"
                      >
                        {p.status ?? 'unknown'}
                      </Badge>
                      {p.tier && (
                        <Badge tone="neutral" variant="outline" size="sm">{p.tier}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent decisions with drawer ── */}
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
              onRetry={() => decisions.refetch()}
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
              {(rows) => rows.map((d) => (
                <Drawer key={d.id}>
                  <DrawerTrigger asChild>
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelectedDecision(d)}
                    >
                      <RouteDecisionRow decision={d} expanded />
                    </button>
                  </DrawerTrigger>
                  <DrawerContent side="right" size="lg">
                    <DrawerHeader>
                      <DrawerTitle>Routing decision</DrawerTitle>
                      <DrawerDescription>
                        Full decision path for this request
                      </DrawerDescription>
                    </DrawerHeader>
                    <DrawerBody>
                      {selectedDecision && <DecisionTrace decision={selectedDecision} />}
                    </DrawerBody>
                    <DrawerFooter>
                      <DrawerClose asChild>
                        <Button variant="secondary">Close</Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              ))}
            </DataState>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

// ── Decision Trace (drawer content) ────────────────────────────────────────

function DecisionTrace({ decision }: { decision: ApiRouteDecision }) {
  return (
    <div className="space-y-4">
      {/* Request info */}
      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <div className="text-xs font-medium text-fg-muted mb-2">Request</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-fg-muted text-xs">Task type</div>
            <div className="text-fg">{decision.task_type ?? '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Status</div>
            <Badge
              tone={decision.status === 'success' ? 'success' : decision.status === 'fallback' ? 'warning' : 'danger'}
              variant="soft"
              size="sm"
            >
              {decision.status}
            </Badge>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Latency</div>
            <div className="text-fg tabular-nums">{decision.latency != null ? formatDuration(decision.latency) : '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Cost</div>
            <div className="text-fg tabular-nums">{decision.cost != null ? formatCurrency(decision.cost) : '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Input tokens</div>
            <div className="text-fg tabular-nums">{decision.input_tokens != null ? formatNumber(decision.input_tokens, true) : '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Output tokens</div>
            <div className="text-fg tabular-nums">{decision.output_tokens != null ? formatNumber(decision.output_tokens, true) : '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Confidence</div>
            <div className="text-fg tabular-nums">{decision.confidence != null ? `${(decision.confidence * 100).toFixed(0)}%` : '—'}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">Time</div>
            <div className="text-fg">{decision.timestamp ? timeAgo(decision.timestamp) : '—'}</div>
          </div>
        </div>
      </div>

      {/* Decision path */}
      <div>
        <div className="text-xs font-medium text-fg-muted mb-3">Decision path</div>
        <div className="space-y-2">
          <PathStep number={1} title="Policy match" description={decision.decision_reason ?? 'Default routing'} />
          <PathStep number={2} title="Selected provider" description={decision.selected_provider} />
          <PathStep number={3} title="Selected model" description={decision.selected_model} />
          {decision.fallback_chain && decision.fallback_chain.length > 0 && (
            <PathStep number={4} title="Fallback chain" description={decision.fallback_chain.join(' → ')} />
          )}
        </div>
      </div>

      {/* Routing evidence */}
      <div>
        <div className="text-xs font-medium text-fg-muted mb-2">Routing evidence</div>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-start gap-2">
            <Info className="size-4 text-info shrink-0 mt-0.5" aria-hidden />
            <div className="text-xs text-fg-muted">
              {decision.decision_reason === 'cost_optimize' && 'Selected to minimize cost while meeting capability requirements.'}
              {decision.decision_reason === 'fallback' && 'Primary provider unavailable, fell back to alternative.'}
              {decision.decision_reason === 'performance' && 'Selected for lowest latency based on recent health checks.'}
              {decision.decision_reason === 'free_tier' && 'Routed to free-tier provider to conserve paid quota.'}
              {!decision.decision_reason && 'Routing decision made by default policy.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PathStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
        {number}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="text-xs text-fg-muted truncate">{description}</div>
      </div>
    </div>
  );
}
