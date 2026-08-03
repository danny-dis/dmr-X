import { Cpu, Pause, Play, Plus, RotateCw, Trash2, Eye, Clock } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/primitives/AlertDialog';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
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
import { interpretError } from '@/components/primitives/ErrorState';
import { Field, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { Progress } from '@/components/primitives/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill, type StatusKind } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, formatDuration, timeAgo } from '@/lib/formatters';
import type { ApiWorker, ApiWorkerJob } from '@/types/api';

type WorkerAction = 'start' | 'stop' | 'restart';

export function WorkersPage() {
  const workers = useApiData<ApiWorker[]>(
    () => Admin.listWorkers(),
    [],
    { refetchInterval: 5000 }
  );

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('generic');
  const [registering, setRegistering] = React.useState(false);
  const [selectedWorker, setSelectedWorker] = React.useState<ApiWorker | null>(null);
  const [jobsOpen, setJobsOpen] = React.useState(false);
  const [cleanupDialogOpen, setCleanupDialogOpen] = React.useState(false);
  const [cleanupDays, setCleanupDays] = React.useState(30);
  const [cleaningUp, setCleaningUp] = React.useState(false);
  const [stopTarget, setStopTarget] = React.useState<ApiWorker | null>(null);
  // Per-row pending action, keyed by worker id — so acting on one worker
  // never disables the buttons on any other row in the table.
  const [pending, setPending] = React.useState<Record<string, WorkerAction>>({});

  const jobs = useApiData<ApiWorkerJob[]>(
    () => selectedWorker ? Admin.listWorkerJobs(selectedWorker.id) : Promise.resolve([]),
    [selectedWorker?.id],
    { refetchInterval: jobsOpen ? 3000 : undefined, enabled: jobsOpen && selectedWorker !== null }
  );

  const setWorkerPending = (id: string, action: WorkerAction | null) => {
    setPending((p) => {
      const next = { ...p };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  };

  const handleRegister = async () => {
    setRegistering(true);
    try {
      await Admin.registerWorker({ name, type });
      toast.success('Worker registered', { description: `${name} was added as a ${type} worker.` });
      setOpen(false);
      setName('');
      setType('generic');
      void workers.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setRegistering(false);
    }
  };

  const handleCleanup = async () => {
    setCleaningUp(true);
    try {
      await Admin.cleanupWorkers(cleanupDays);
      toast.success('Cleanup completed', {
        description: `Jobs and terminated workers older than ${cleanupDays} days were removed.`,
      });
      setCleanupDialogOpen(false);
      void workers.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setCleaningUp(false);
    }
  };

  const handleStart = async (worker: ApiWorker) => {
    setWorkerPending(worker.id, 'start');
    try {
      await Admin.resumeWorker(worker.id);
      toast.success('Worker started', { description: worker.name ?? worker.id });
      void workers.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setWorkerPending(worker.id, null);
    }
  };

  const handleStop = async (worker: ApiWorker) => {
    setWorkerPending(worker.id, 'stop');
    try {
      await Admin.drainWorker(worker.id);
      toast.success('Worker stopped', {
        description: `${worker.name ?? worker.id} is draining and will finish in-flight jobs before going idle.`,
      });
      void workers.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setWorkerPending(worker.id, null);
    }
  };

  const handleRestart = async (worker: ApiWorker) => {
    setWorkerPending(worker.id, 'restart');
    try {
      await Admin.drainWorker(worker.id);
      await Admin.resumeWorker(worker.id);
      toast.success('Worker restarted', { description: worker.name ?? worker.id });
      void workers.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setWorkerPending(worker.id, null);
    }
  };

  const getJobStatusColor = (status: string): StatusKind => {
    switch (status) {
      case 'running':
        return 'active';
      case 'completed':
        return 'healthy';
      case 'failed':
        return 'offline';
      default:
        return 'pending';
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
              <Trash2 className="size-3" aria-hidden />
              Cleanup
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3" aria-hidden />
              Register worker
            </Button>
          </div>
        }
      />

      <div className="mt-5">
        <DataState
          data={workers.data}
          isLoading={workers.isLoading}
          error={workers.error}
          onRetry={workers.refetch}
          loading={
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full" />
              ))}
            </div>
          }
          empty={{
            icon: <Cpu className="size-8" />,
            title: 'No workers running',
            description:
              'Infrastructure workers are spawned automatically by the gateway for background tasks like quota tracking and telemetry.',
            action: (
              <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="size-3" />}>
                Register worker
              </Button>
            ),
          }}
        >
          {(list) => (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {list.map((w) => {
                const isPending = pending[w.id] != null;
                return (
                  <Card key={w.id} padding="md">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                          <Cpu className="size-4" aria-hidden />
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
                        <Eye className="size-3" aria-hidden />
                        View Jobs
                      </Button>

                      {w.draining ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending[w.id] === 'start'}
                          disabled={isPending && pending[w.id] !== 'start'}
                          onClick={() => void handleStart(w)}
                        >
                          <Play className="size-3" aria-hidden />
                          Start
                        </Button>
                      ) : w.alive ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={pending[w.id] === 'restart'}
                            disabled={isPending && pending[w.id] !== 'restart'}
                            onClick={() => void handleRestart(w)}
                          >
                            <RotateCw className="size-3" aria-hidden />
                            Restart
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={pending[w.id] === 'stop'}
                            disabled={isPending && pending[w.id] !== 'stop'}
                            onClick={() => setStopTarget(w)}
                          >
                            <Pause className="size-3" aria-hidden />
                            Stop
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending[w.id] === 'start'}
                          disabled={isPending && pending[w.id] !== 'start'}
                          onClick={() => void handleStart(w)}
                        >
                          <Play className="size-3" aria-hidden />
                          Start
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </DataState>
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
              <Field>
                <FieldLabel htmlFor="worker-name">Name</FieldLabel>
                <Input
                  id="worker-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. billing-worker-01"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="worker-type">Type</FieldLabel>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="worker-type">
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
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRegister} loading={registering} disabled={!name.trim()}>
              Register
            </Button>
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
              <Field>
                <FieldLabel htmlFor="cleanup-days">Keep data for (days)</FieldLabel>
                <Input
                  id="cleanup-days"
                  type="number"
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  min={1}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCleanup} loading={cleaningUp}>
              <Trash2 className="size-3" aria-hidden />
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
            <div className="max-h-96 overflow-y-auto">
              <DataState
                data={jobs.data}
                isLoading={jobs.isLoading}
                error={jobs.error}
                onRetry={jobs.refetch}
                skeletonRows={3}
                empty={{
                  icon: <Clock className="size-8" />,
                  title: 'No jobs found',
                  description: "This worker hasn't processed any jobs yet.",
                }}
              >
                {(list) => (
                  <div className="space-y-2">
                    {list.map((job) => (
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
                            <p className="text-xs text-danger mt-1">{job.error}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-fg-muted">
                            {job.startedAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" aria-hidden />
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
                    ))}
                  </div>
                )}
              </DataState>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stop confirmation */}
      <AlertDialog open={stopTarget != null} onOpenChange={(o) => { if (!o) setStopTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {stopTarget?.name ?? stopTarget?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This drains the worker so it stops accepting new jobs. It finishes any in-flight work
              before going idle — start it again from this page whenever you're ready.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (stopTarget) void handleStop(stopTarget); }}>
              Stop worker
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
