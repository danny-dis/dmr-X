import * as React from 'react';
import { Network, Plus, Globe, Trash2 } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { StatusPill } from '@/components/primitives/StatusPill';
import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, timeAgo } from '@/lib/formatters';
export function FederationPage() {
    const nodes = useApiData(() => Admin.listFederation(), [], { refetchInterval: 10000 });
    return (<PageContainer>
      <PageHeader title="Federation" description="Peer gateway nodes and cross-cluster routing" icon={<Network className="size-5"/>} actions={<Button size="sm">
            <Plus className="size-3"/>
            Register peer
          </Button>}/>

      <Card padding="md" className="mt-5">
        <CardHeader className="px-0 pt-0">
          <CardTitle>Cluster topology</CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Local + peer gateway nodes</p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <TopologyGraph nodes={[
            { id: 'local', label: 'Local', type: 'gateway', status: 'online' },
            ...(nodes.data ?? []).map((n) => ({
                id: n.id,
                label: n.name ?? n.id,
                type: 'gateway',
                status: (n.status ?? 'unknown'),
            })),
        ]} edges={(nodes.data ?? []).map((n) => ({
            source: 'local',
            target: n.id,
            active: n.status === 'online',
            weight: 2,
        }))} height={300}/>
        </CardContent>
      </Card>

      <div className="mt-3">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Peer nodes</h3>
            <Badge tone="muted" size="sm">{(nodes.data ?? []).length}</Badge>
          </div>
          {nodes.isLoading ? (<div className="p-3 flex flex-col gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-14 w-full"/>))}
            </div>) : nodes.data && nodes.data.length > 0 ? (<div className="p-1">
              {nodes.data.map((n) => (<div key={n.id} className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface-2">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                    <Globe className="size-4"/>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{n.name ?? n.id}</p>
                    <p className="text-[10px] text-fg-muted font-mono truncate">{n.url}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-fg-muted">
                    {n.latencyMs != null && (<span className="tabular-nums">{formatDuration(n.latencyMs)}</span>)}
                    {n.lastSeenAt && <span>{timeAgo(n.lastSeenAt)}</span>}
                  </div>
                  <StatusPill status={(n.status ?? 'unknown')} size="sm"/>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove">
                    <Trash2 className="size-3"/>
                  </Button>
                </div>))}
            </div>) : (<EmptyState title="No peer nodes" description="Register another DMR-X gateway to enable cross-cluster routing."/>)}
        </Card>
      </div>
    </PageContainer>);
}
//# sourceMappingURL=Federation.js.map