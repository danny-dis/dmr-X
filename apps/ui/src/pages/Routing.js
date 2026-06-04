import * as React from 'react';
import { Activity, GitBranch } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { StatTile } from '@/components/primitives/StatTile';
import { Skeleton } from '@/components/primitives/Skeleton';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { DonutChart, Sunburst } from '@/components/charts/DonutChart';
import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { RouteDecisionRow } from '@/components/domain/RouteDecisionRow';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
const TONE = {
    primary: '#7C5CFF',
    accent: '#22D3EE',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#F87171',
    pink: '#F472B6',
};
export function RoutingPage() {
    const decisions = useApiData(() => Admin.listRouteDecisions({ limit: 50 }), [], { refetchInterval: 3000 });
    const providers = useApiData(() => Admin.listProviders(), [], { refetchInterval: 30000 });
    const usage = useApiData(() => Admin.getUsage({ granularity: 'hour' }), [], { refetchInterval: 10000 });
    const byLayer = (decisions.data ?? []).reduce((acc, d) => {
        const l = d.intelligenceLayer ?? 'brain';
        acc[l] = (acc[l] ?? 0) + 1;
        return acc;
    }, {});
    const layerData = ['brain', 'thinker', 'executor', 'worker', 'temp_worker'].map((l) => ({
        name: l,
        value: byLayer[l] ?? 0,
        color: l === 'brain' ? TONE.primary : l === 'thinker' ? TONE.accent : l === 'executor' ? TONE.success : l === 'worker' ? TONE.warning : TONE.pink,
    }));
    const byReason = (decisions.data ?? []).reduce((acc, d) => {
        const r = d.reasoning ?? 'unknown';
        acc[r] = (acc[r] ?? 0) + 1;
        return acc;
    }, {});
    const sunburstData = Object.entries(byReason).map(([k, v], i) => ({
        label: k,
        value: v,
        color: Object.values(TONE)[i % Object.values(TONE).length],
    }));
    const series = (usage.data?.points ?? []).slice(-24).map((p) => ({
        t: p.t,
        routed: p.requests ?? 0,
        cache_hits: (p.cacheHits ?? 0),
        fallbacks: (p.fallbacks ?? 0),
    }));
    return (<PageContainer size="wide">
      <PageHeader title="Routing" description="Real-time routing decisions, layer distribution, and topology" icon={<Activity className="size-5"/>} actions={<Badge tone="primary" icon={<GitBranch className="size-3"/>}>
            {(decisions.data ?? []).length} decisions tracked
          </Badge>}/>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {['brain', 'thinker', 'executor', 'worker', 'temp_worker'].map((l) => (<StatTile key={l} label={l.replace('_', ' ')} value={byLayer[l] ?? 0} icon={<IntelligenceBadge layer={l} size="sm" showLabel={false}/>} tone={l === 'brain' ? 'primary' : l === 'thinker' ? 'default' : l === 'executor' ? 'success' : l === 'worker' ? 'warning' : 'danger'}/>))}
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
            {series.length > 0 ? (<TimeSeriesChart data={series} xKey="t" height={220} series={[
                { key: 'routed', name: 'Routed', color: TONE.primary, fillOpacity: 0.2 },
                { key: 'cache_hits', name: 'Cache hits', color: TONE.accent, fillOpacity: 0.15 },
                { key: 'fallbacks', name: 'Fallbacks', color: TONE.warning, fillOpacity: 0.15 },
            ]} stacked xFormatter={(v) => new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}/>) : (<Skeleton className="h-[220px] w-full"/>)}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Layer split</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {layerData.some((d) => d.value > 0) ? (<DonutChart data={layerData} size={140} thickness={16} showLegend showLabels/>) : (<Skeleton className="size-32 rounded-full mx-auto"/>)}
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
            <TopologyGraph nodes={[
            { id: 'gw', label: 'Gateway', type: 'gateway', status: 'online' },
            { id: 'rt', label: 'Router', type: 'router', status: 'online' },
            ...(providers.data ?? []).slice(0, 4).map((p) => ({
                id: p.id,
                label: p.name,
                type: 'provider',
                status: (p.health?.status ?? 'unknown'),
            })),
        ]} edges={[
            { source: 'gw', target: 'rt', active: true, weight: 3 },
            ...(providers.data ?? []).slice(0, 4).map((p) => ({
                source: 'rt',
                target: p.id,
                active: true,
                weight: 1.5,
            })),
        ]} height={260}/>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Routing reason distribution</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Why the router chose each provider</p>
          </CardHeader>
          <CardContent className="px-0 pb-0 flex justify-center">
            {sunburstData.length > 0 ? (<Sunburst data={sunburstData} size={260}/>) : (<Skeleton className="size-[260px] rounded-full"/>)}
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
            {decisions.isLoading ? (<div className="flex flex-col gap-1.5 p-2">
                {Array.from({ length: 8 }).map((_, i) => (<Skeleton key={i} className="h-10 w-full"/>))}
              </div>) : decisions.data && decisions.data.length > 0 ? (decisions.data.map((d) => (<RouteDecisionRow key={d.id} decision={d} expanded/>))) : (<div className="py-12 text-center text-fg-subtle text-xs">
                No routing decisions yet
              </div>)}
          </div>
        </Card>
      </div>
    </PageContainer>);
}
//# sourceMappingURL=Routing.js.map