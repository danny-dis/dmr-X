import { Cpu, Pause, Play, Plus } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Progress } from '@/components/primitives/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, formatDuration, timeAgo } from '@/lib/formatters';
import type { ApiWorker } from '@/types/api';

export function WorkersPage() {
  const workers = useApiData<ApiWorker[]>(
    () => Admin.listWorkers(),
    [],
    { refetchInterval: 5000 }
  );

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('generic');

  const handleRegister = async () => {
    try {
      await Admin.registerWorker({ name, type });
      toast.success('Worker registered');
      setOpen(false);
      setName('');
      setType('generic');
      workers.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register worker');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Workers"
        description="Background job workers — quota, telemetry, billing, garbage collection"
        icon={<Cpu className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3" />
            Register worker
          </Button>
        }
      />

      <div className="mt-5">
        {workers.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : workers.data && workers.data.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workers.data.map((w) => (
              <Card key={w.id} padding="md">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                      <Cpu className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-fg">{w.name ?? w.id}</h3>
                      <p className="text-[10px] text-fg-muted font-mono">{w.id.slice(0, 12)}</p>
                    </div>
                  </div>
                  <StatusPill
                    status={w.draining ? 'warning' : w.alive ? 'online' : 'offline'}
                    label={w.draining ? 'Draining' : w.alive ? 'Active' : 'Down'}
                    size="sm"
                    showDot={!w.draining && w.alive}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] text-fg-muted uppercase tracking-wider">Jobs</p>
                    <p className="text-sm font-semibold text-fg tabular-nums">{formatNumber(w.jobsProcessed ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-fg-muted uppercase tracking-wider">Uptime</p>
                    <p className="text-sm font-semibold text-fg">{formatDuration(w.uptimeMs ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-fg-muted uppercase tracking-wider">Last seen</p>
                    <p className="text-sm text-fg">{w.lastHeartbeatAt ? timeAgo(w.lastHeartbeatAt) : '—'}</p>
                  </div>
                </div>

                {w.load != null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="text-fg-muted">Load</span>
                      <span className="text-fg tabular-nums">{(w.load * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={w.load * 100} size="sm" tone={w.load > 0.8 ? 'warning' : 'primary'} />
                  </div>
                )}

                <div className="mt-3 flex items-center gap-1.5 justify-end">
                  {w.draining ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await Admin.resumeWorker(w.id);
                          toast.success('Worker resumed', { description: w.name ?? w.id });
                          workers.refetch();
                        } catch (err) {
                          toast.error('Failed to resume worker', {
                            description: err instanceof Error ? err.message : String(err),
                          });
                        }
                      }}
                    >
                      <Play className="size-3" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await Admin.drainWorker(w.id);
                          toast.success('Worker draining', { description: w.name ?? w.id });
                          workers.refetch();
                        } catch (err) {
                          toast.error('Failed to drain worker', {
                            description: err instanceof Error ? err.message : String(err),
                          });
                        }
                      }}
                    >
                      <Pause className="size-3" />
                      Drain
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card padding="none" className="border-dashed">
            <EmptyState
              title="No workers running"
              description="Workers are spawned automatically by the gateway as needed."
            />
          </Card>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Register worker</DialogTitle>
            <DialogDescription>Add a new background worker to the cluster.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. billing-worker-01" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Type</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">generic</SelectItem>
                    <SelectItem value="quota">quota</SelectItem>
                    <SelectItem value="telemetry">telemetry</SelectItem>
                    <SelectItem value="billing">billing</SelectItem>
                    <SelectItem value="gc">gc</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRegister}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
