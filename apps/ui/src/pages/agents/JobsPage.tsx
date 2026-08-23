import { Briefcase, Plus, X, ChevronDown, Play, UserCheck } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { interpretError } from '@/components/primitives/ErrorState';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { formatNumber, timeAgo } from '@/lib/formatters';
import {
  useCancelJob, useCreateJob, useJobTasks, useJobs, usePlanJob, useRunJob,
  type Job,
} from '@/lib/queries/jobs';

const STATUS_PILL: Record<string, 'healthy' | 'offline' | 'pending' | 'unknown'> = {
  delivered: 'healthy',
  running: 'pending',
  planning: 'pending',
  verifying: 'pending',
  intake: 'pending',
  blocked: 'offline',
  failed: 'offline',
  cancelled: 'offline',
};

export function JobsPage() {
  const jobs = useJobs();
  const createJob = useCreateJob();
  const planJob = usePlanJob();
  const runJob = useRunJob();
  const cancelJob = useCancelJob();

  const [open, setOpen] = React.useState(false);
  const [brief, setBrief] = React.useState('');
  const [criteria, setCriteria] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const submitting = createJob.isPending;

  async function handleCreate() {
    const acceptanceCriteria = criteria
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    try {
      await createJob.mutateAsync({
        brief,
        ...(acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
      });
      toast.success('Job created — plan it to decompose the brief');
      setOpen(false);
      setBrief('');
      setCriteria('');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  }

  async function act(id: string, fn: () => Promise<unknown>, label: string) {
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      await fn();
      toast.success(label);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Jobs"
        description="Multi-agent jobs: brief in, verified deliverable out"
        icon={<Briefcase className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
            New job
          </Button>
        }
      />

      <div className="mt-5">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">All jobs</h3>
            <Badge tone="muted" size="sm" aria-live="polite">{formatNumber((jobs.data?.items ?? []).length)}</Badge>
          </div>
          <DataState
            data={jobs.data?.items}
            isLoading={jobs.isLoading}
            error={jobs.error}
            onRetry={jobs.refetch}
            skeletonRows={3}
            empty={{
              icon: <Briefcase className="size-8" />,
              title: 'No jobs yet',
              description: 'Submit a brief and the agent pool carries it to a verified deliverable.',
              action: (
                <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
                  New job
                </Button>
              ),
            }}
          >
            {(data) => (
              <div className="p-1">
                {data.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    expanded={!!expanded[j.id]}
                    busy={!!busy[j.id]}
                    onToggle={() => setExpanded((prev) => ({ ...prev, [j.id]: !prev[j.id] }))}
                    onPlan={() => act(j.id, () => planJob.mutateAsync({ id: j.id }), 'Plan created')}
                    onRun={(coordinator) =>
                      act(j.id, () => runJob.mutateAsync({ id: j.id, coordinator }), coordinator ? 'Queued with Receptionist staffing' : 'Queued')
                    }
                    onCancel={() => act(j.id, () => cancelJob.mutateAsync(j.id), 'Job cancelled')}
                  />
                ))}
              </div>
            )}
          </DataState>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
            <DialogDescription>Describe the outcome you want; planning decomposes it into agent tasks.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="job-brief" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Brief</label>
                <Textarea
                  id="job-brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={6}
                  placeholder="Build a landing page with a signup form and dark mode"
                />
              </div>
              <div>
                <label htmlFor="job-criteria" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Acceptance criteria (one per line, optional)
                </label>
                <Textarea
                  id="job-criteria"
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  rows={3}
                  placeholder={'Signup form validates email\nDark mode toggle persists'}
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={() => void handleCreate()} loading={submitting} disabled={!brief.trim()}>
              Create job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function JobRow(props: {
  job: Job;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onPlan: () => void;
  onRun: (coordinator: boolean) => void;
  onCancel: () => void;
}) {
  const { job: j, expanded, busy } = props;
  const actionable = j.status === 'intake' || j.status === 'blocked';
  const runnable = j.status === 'intake' || j.status === 'blocked' || j.status === 'running';
  const cancellable = j.status === 'running' || j.status === 'planning' || j.status === 'verifying' || j.status === 'blocked';

  return (
    <div className="rounded-lg">
      <div
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 cursor-pointer"
        onClick={props.onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onToggle();
          }
        }}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
          <Briefcase className="size-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg truncate" title={j.brief}>{j.brief.slice(0, 90)}</p>
          <p className="text-[10px] text-fg-muted">
            {j.id.slice(0, 8)} · {timeAgo(j.createdAt)} · {j.source}
          </p>
        </div>
        <StatusPill status={STATUS_PILL[j.status] ?? 'unknown'} label={j.status} size="sm" showDot={false} />
        <ChevronDown className={`size-3.5 text-fg-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
        {runnable && (
          <Button
            variant="ghost"
            size="icon-sm"
            loading={busy}
            onClick={(e) => { e.stopPropagation(); props.onRun(false); }}
            aria-label="Run job"
            title="Run job"
          >
            <Play className="size-3" aria-hidden />
          </Button>
        )}
        {cancellable && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); props.onCancel(); }}
            aria-label="Cancel job"
            title="Cancel job"
          >
            <X className="size-3" aria-hidden />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 pl-14 flex flex-col gap-2">
          {actionable && (
            <div className="flex gap-2">
              {j.status === 'intake' && (
                <Button size="sm" variant="secondary" loading={busy} onClick={props.onPlan}>
                  Plan (decompose brief)
                </Button>
              )}
              <Button
                size="sm"
                loading={busy}
                onClick={() => props.onRun(true)}
                leftIcon={<UserCheck className="size-3" aria-hidden />}
                title="Pre-staff tasks via capability matching, then run"
              >
                Run with Receptionist
              </Button>
            </div>
          )}
          <JobDetail job={j} />
        </div>
      )}
    </div>
  );
}

function JobDetail({ job: j }: { job: Job }) {
  return (
    <div className="flex flex-col gap-2">
      <pre className="text-xs bg-surface-2 text-fg p-2 rounded-md overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
        {j.brief}
      </pre>
      {j.result != null && (
        <pre className="text-xs bg-surface-2 text-fg p-2 rounded-md overflow-x-auto max-h-40 overflow-y-auto">
          {JSON.stringify(j.result, null, 2)}
        </pre>
      )}
      {(j.decisionLog ?? []).length > 0 && (
        <div className="text-[11px] text-fg-muted flex flex-col gap-0.5">
          {(j.decisionLog ?? []).map((entry, i) => (
            <div key={i}>
              {entry.at ? new Date(entry.at).toLocaleTimeString() : ''} · {entry.by ?? '?'} · {entry.action ?? '?'}
            </div>
          ))}
        </div>
      )}
      <TaskList jobId={j.id} />
    </div>
  );
}

function TaskList({ jobId }: { jobId: string }) {
  const tasks = useJobTasks(jobId);
  if (!tasks.data || tasks.data.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      {tasks.data.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-[11px]">
          <StatusPill
            status={
              t.status === 'completed' ? 'healthy' :
              t.status === 'failed' ? 'offline' :
              t.status === 'pending' ? 'pending' : 'pending'
            }
            label={t.status}
            size="sm"
            showDot={false}
          />
          <span className="text-fg truncate" title={t.title}>{t.title}</span>
          {t.output?.deliverable?.summary && (
            <span className="text-fg-muted truncate" title={t.output.deliverable.summary}>
              — {t.output.deliverable.summary}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
