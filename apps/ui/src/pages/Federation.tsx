import { Network, Plus, Globe, ArrowRight, ChevronRight, Trash2, Activity, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, timeAgo } from '@/lib/formatters';
import type { ApiFederationNode } from '@/types/api';

export function FederationPage() {
  const nodes = useApiData<ApiFederationNode[]>(
    () => Admin.listFederation(),
    [],
    { refetchInterval: 10000 }
  );

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [authToken, setAuthToken] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleRegister = async () => {
    setSubmitting(true);
    try {
      await Admin.registerFederation({ name, url, region: region || undefined, authToken: authToken || undefined });
      toast.success('Federation peer registered successfully');
      setDialogOpen(false);
      setName('');
      setUrl('');
      setRegion('');
      setAuthToken('');
      nodes.refetch();
    } catch {
      toast.error('Failed to register federation peer');
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (id: string, peerName: string) => {
    if (!window.confirm(`Remove federation peer "${peerName}"?`)) return;
    try {
      await Admin.unregisterFederation(id);
      toast.success('Federation peer removed');
      nodes.refetch();
    } catch {
      toast.error('Failed to remove federation peer');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Federation"
        description="Peer gateway nodes and cross-cluster routing"
        icon={<Network className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3" />
            Register peer
          </Button>
        }
      />

      <Card padding="md" className="mt-5">
        <CardHeader className="px-0 pt-0">
          <CardTitle>Cluster topology</CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Local + peer gateway nodes</p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <TopologyGraph
            nodes={[
              { id: 'local', label: 'Local', type: 'gateway', status: 'online' },
              ...(nodes.data ?? []).map((n) => ({
                id: n.id,
                label: n.name ?? n.id,
                type: 'gateway' as const,
                status: (n.status ?? 'unknown') as 'online' | 'degraded' | 'offline' | 'unknown',
              })),
            ]}
            edges={(nodes.data ?? []).map((n) => ({
              source: 'local',
              target: n.id,
              active: n.status === 'online',
              weight: 2,
            }))}
            height={300}
          />
        </CardContent>
      </Card>

      <div className="mt-3">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Peer nodes</h3>
            <Badge tone="muted" size="sm">{(nodes.data ?? []).length}</Badge>
          </div>
          {nodes.isLoading ? (
            <div className="p-3 flex flex-col gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : nodes.data && nodes.data.length > 0 ? (
            <div className="p-1">
              {nodes.data.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface-2"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                    <Globe className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{n.name ?? n.id}</p>
                    <p className="text-[10px] text-fg-muted font-mono truncate">{n.url}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-fg-muted">
                    {n.latencyMs != null && (
                      <span className="tabular-nums">{formatDuration(n.latencyMs)}</span>
                    )}
                    {n.lastSeenAt && <span>{timeAgo(n.lastSeenAt)}</span>}
                  </div>
                  <StatusPill
                    status={(n.status ?? 'unknown') as 'online' | 'degraded' | 'offline' | 'unknown'}
                    size="sm"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Health check"
                    onClick={async () => {
                      try {
                        await Admin.healthCheckFederation(n.id);
                        toast.success('Health check complete', { description: n.name ?? n.id });
                        nodes.refetch();
                      } catch (err) {
                        toast.error('Health check failed', {
                          description: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                  >
                    <Activity className="size-3" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Sync benchmark"
                    onClick={async () => {
                      try {
                        await Admin.syncFederationBenchmark(n.id);
                        toast.success('Benchmark sync started', { description: n.name ?? n.id });
                      } catch (err) {
                        toast.error('Sync failed', {
                          description: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => onRemove(n.id, n.name ?? n.id)}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No peer nodes"
              description="Register another DMR-X gateway to enable cross-cluster routing."
            />
          )}
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Register peer</DialogTitle>
            <DialogDescription>Connect another DMR-X gateway as a federation peer.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. us-east-peer" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">URL</label>
                <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gateway.example.com" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Region</label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us-east">us-east</SelectItem>
                    <SelectItem value="us-west">us-west</SelectItem>
                    <SelectItem value="eu-west">eu-west</SelectItem>
                    <SelectItem value="eu-central">eu-central</SelectItem>
                    <SelectItem value="ap-southeast">ap-southeast</SelectItem>
                    <SelectItem value="ap-northeast">ap-northeast</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Auth Token</label>
                <Input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="dmrx_..." />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRegister} loading={submitting}>
              Register peer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
