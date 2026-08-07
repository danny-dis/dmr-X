import { Network, Plus, Globe, Trash2, Activity, RefreshCw, Loader2 } from 'lucide-react';
import * as React from 'react';

import { TopologyGraph } from '@/components/charts/TopologyGraph';
import { PageHeader, PageContainer } from '@/components/layout';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/primitives/AlertDialog';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { interpretError } from '@/components/primitives/ErrorState';
import { Field, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { formatDuration, timeAgo } from '@/lib/formatters';
import {
  useFederationNodes,
  useHealthCheckFederationNode,
  useRegisterFederationNode,
  useSyncFederationBenchmark,
  useUnregisterFederationNode,
} from '@/lib/queries/federation';

/** What to check when a peer can't be reached, keyed by its reported status. */
const UNREACHABLE_HINT: Record<string, string> = {
  offline: 'Unreachable — check that the peer URL is correct and its gateway process is running.',
  degraded: 'Responding slowly — check the peer\'s own health and the network path to it.',
  unknown: 'Status not yet confirmed — run a health check to verify reachability.',
};

export function FederationPage() {
  const nodes = useFederationNodes({ refetchInterval: 10000 });
  const registerNode = useRegisterFederationNode();
  const unregisterNode = useUnregisterFederationNode();
  const healthCheckNode = useHealthCheckFederationNode();
  const syncBenchmark = useSyncFederationBenchmark();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [authToken, setAuthToken] = React.useState('');
  const submitting = registerNode.isPending;
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; name: string } | null>(null);
  const removing = unregisterNode.isPending;

  const handleRegister = async () => {
    try {
      await registerNode.mutateAsync({ name, url, region: region || undefined, authToken: authToken || undefined });
      toast.success('Federation peer registered', { description: `${name} was added and will be health-checked shortly.` });
      setDialogOpen(false);
      setName('');
      setUrl('');
      setRegion('');
      setAuthToken('');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await unregisterNode.mutateAsync(removeTarget.id);
      toast.success('Federation peer removed', { description: `${removeTarget.name} was disconnected from cross-cluster routing.` });
      setRemoveTarget(null);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Federation"
        description="Peer gateway nodes and cross-cluster routing"
        icon={<Network className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
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
          <DataState
            data={nodes.data}
            isLoading={nodes.isLoading}
            error={nodes.error}
            onRetry={nodes.refetch}
            skeletonRows={3}
            empty={{
              icon: <Globe className="size-8" aria-hidden />,
              title: 'No peer nodes',
              description: 'Register another DMR-X gateway to enable cross-cluster routing.',
              action: (
                <Button size="sm" onClick={() => setDialogOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
                  Register peer
                </Button>
              ),
            }}
          >
            {(peerNodes) => (
              <div className="p-1">
                {peerNodes.map((n) => {
                  const status = (n.status ?? 'unknown') as 'online' | 'degraded' | 'offline' | 'unknown';
                  const hint = UNREACHABLE_HINT[status];
                  return (
                    <div
                      key={n.id}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface-2"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted shrink-0">
                        <Globe className="size-4" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg truncate">{n.name ?? n.id}</p>
                        <p className="text-[10px] text-fg-muted font-mono truncate">{n.url}</p>
                        {hint && <p className="text-[10px] text-warning mt-0.5">{hint}</p>}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-fg-muted shrink-0">
                        {n.latencyMs != null && (
                          <span className="tabular-nums font-mono">{formatDuration(n.latencyMs)}</span>
                        )}
                        {n.lastSeenAt && <span>{timeAgo(n.lastSeenAt)}</span>}
                      </div>
                      <StatusPill status={status} size="sm" />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Run health check for ${n.name ?? n.id}`}
                        onClick={async () => {
                          try {
                            await healthCheckNode.mutateAsync(n.id);
                            toast.success('Health check complete', { description: n.name ?? n.id });
                          } catch (err) {
                            const e = interpretError(err);
                            toast.error(e.title, { description: e.description });
                          }
                        }}
                      >
                        <Activity className="size-3" aria-hidden />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Sync benchmark data for ${n.name ?? n.id}`}
                        onClick={async () => {
                          try {
                            await syncBenchmark.mutateAsync(n.id);
                            toast.success('Benchmark sync started', { description: n.name ?? n.id });
                          } catch (err) {
                            const e = interpretError(err);
                            toast.error(e.title, { description: e.description });
                          }
                        }}
                      >
                        <RefreshCw className="size-3" aria-hidden />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove peer ${n.name ?? n.id}`}
                        onClick={() => setRemoveTarget({ id: n.id, name: n.name ?? n.id })}
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </DataState>
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
              <Field>
                <FieldLabel htmlFor="fed-name">Name</FieldLabel>
                <Input id="fed-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. us-east-peer" />
              </Field>
              <Field>
                <FieldLabel htmlFor="fed-url">URL</FieldLabel>
                <Input id="fed-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gateway.example.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="fed-region">Region</FieldLabel>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id="fed-region" aria-label="Region">
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
              </Field>
              <Field>
                <FieldLabel htmlFor="fed-token">Auth token</FieldLabel>
                <Input id="fed-token" type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="dmrx_..." />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRegister} loading={submitting} disabled={!name.trim() || !url.trim()}>
              Register peer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget != null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove peer node</AlertDialogTitle>
            <AlertDialogDescription>
              This disconnects &quot;{removeTarget?.name}&quot; from cross-cluster routing. You can register it again later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()} disabled={removing}>
              {removing && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
