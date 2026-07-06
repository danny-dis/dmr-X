import { Cpu, Pause, Play, Plus, Trash2, Eye, Clock } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Progress } from '@/components/primitives/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Badge } from '@/components/primitives/Badge';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, formatDuration, timeAgo } from '@/lib/formatters';
import type { ApiWorker, ApiWorkerJob } from '@/types/api';

export function WorkersPage() {
  const workers = useApiData<ApiWorker[]>(
    () => Admin.listWorkers(),
    [],
    { refetchInterval: 5000 }
  );

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('generic');
  const [selectedWorker, setSelectedWorker] = React.useState<ApiWorker | null>(null);
  const [jobsOpen, setJobsOpen] = React.useState(false);
  const [cleanupDialogOpen, setCleanupDialogOpen] = React.useState(false);
  const [cleanupDays, setCleanupDays] = React.useState(30);

  const jobs = useApiData<ApiWorkerJob[]>(
    () => selectedWorker ? Admin.listWorkerJobs(selectedWorker.id) : Promise.resolve([]),
    [],
    { refetchInterval: jobsOpen ? 3000 : undefined, enabled: jobsOpen && selectedWorker !== null }
  );

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

  const handleCleanup = async () => {
    try {
      await Admin.cleanupWorkers(cleanupDays);
      toast.success('Cleanup completed successfully');
      setCleanupDialogOpen(false);
      workers.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to perform cleanup');
    }
  };

  const getJobStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'primary';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Infrastructure Workers"
        description="Background processes — quota tracking, telemetry, billing, garbage collection. These are distinct from the Intelligence Hierarchy's Worker layer which handles parallel subtask execution."
        icon={<Cpu className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setCleanupDialogOpen(true)}>
              <Trash2 className="size-3" />
              Cleanup
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3" />
              Register worker
            </Button>
          </div>
        }
      />

      <div className="mt-5">
        {workers.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
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
                      {w.type && (
                        <Badge size="sm" variant="outline" className="mt-1">
                          {w.type}
                        </Badge>
                      )}
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedWorker(w);
                      setJobsOpen(true);
                    }}
                  >
                    <Eye className="size-3" />
                    View Jobs
                  </Button>
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
              description="Infrastructure workers are spawned automatically by the gateway for background tasks like quota tracking and telemetry."
            />
          </Card>
        )}
      </div>

      {/* Register Worker Dialog */}
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
                    <SelectItem value="router-fanout">router-fanout</SelectItem>
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

      {/* Cleanup Dialog */}
      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Cleanup workers and jobs</DialogTitle>
            <DialogDescription>Remove old jobs and terminated workers from the database.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Keep data for (days)
                </label>
                <Input
                  type="number"
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  min={1}
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCleanup}>
              <Trash2 className="size-3" />
              Cleanup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Jobs Dialog */}
      <Dialog open={jobsOpen} onOpenChange={setJobsOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Worker Jobs</DialogTitle>
            <DialogDescription>
              Recent jobs for {selectedWorker?.name ?? selectedWorker?.id}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {jobs.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
              ) : jobs.data && jobs.data.length > 0 ? (
                jobs.data.map((job) => (
                  <Card key={job.id} padding="sm" className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-fg">{job.jobType}</h4>
                        <StatusPill
                          status={getJobStatusColor(job.status)}
                          label={job.status}
                          size="sm"
                        />
                      </div>
                      <p className="text-xs text-fg-muted font-mono">{job.id.slice(0, 16)}</p>
                      {job.error && (
                        <p className="text-xs text-red-500 mt-1">{job.error}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-fg-muted">
                        {job.startedAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {timeAgo(job.startedAt)}
                          </span>
                        )}
                        {job.payload && (
                          <span className="truncate flex-1 max-w-xs" title={job.payload}>
                            {job.payload.length > 50
                              ? job.payload.slice(0, 50) + '...'
                              : job.payload}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <EmptyState
                  title="No jobs found"
                  description="This worker hasn't processed any jobs yet."
                />
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
