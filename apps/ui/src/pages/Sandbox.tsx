import { Terminal, Plus, Code, X, ChevronDown } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import { useCancelSandboxJob, useSandboxJobs, useSubmitSandboxJob } from '@/lib/queries/sandbox';

export function SandboxPage() {
  const jobs = useSandboxJobs({ refetchInterval: 5000 });
  const cancelJob = useCancelSandboxJob();
  const submitJob = useSubmitSandboxJob();

  const [open, setOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [language, setLanguage] = React.useState('python');
  const [code, setCode] = React.useState('');
  const [timeoutMs, setTimeoutMs] = React.useState('5000');
  const submitting = submitJob.isPending;

  async function handleCancel(id: string) {
    setCancelling((prev) => ({ ...prev, [id]: true }));
    try {
      await cancelJob.mutateAsync(id);
      toast.success('Job cancelled');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setCancelling((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSubmit() {
    try {
      await submitJob.mutateAsync({
        language,
        code,
        timeoutMs: Number(timeoutMs),
      });
      toast.success('Job submitted successfully');
      setOpen(false);
      setCode('');
      setLanguage('python');
      setTimeoutMs('5000');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Sandbox"
        description="Ephemeral execution environment for tool and code testing"
        icon={<Terminal className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
            New job
          </Button>
        }
      />

      <div className="mt-5">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Recent jobs</h3>
            <Badge tone="muted" size="sm" aria-live="polite">{formatNumber((jobs.data ?? []).length)}</Badge>
          </div>
          <DataState
            data={jobs.data}
            isLoading={jobs.isLoading}
            error={jobs.error}
            onRetry={jobs.refetch}
            skeletonRows={3}
            empty={{
              icon: <Terminal className="size-8" />,
              title: 'No jobs yet',
              description: 'Submit a job to run code in a sandboxed environment.',
              action: (
                <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
                  New job
                </Button>
              ),
            }}
          >
            {(data) => (
              <div className="p-1">
                {data.map((j) => {
                  const canExpand = j.status === 'completed' || j.status === 'failed';
                  const isExpanded = expanded[j.id];
                  return (
                    <div key={j.id} className="rounded-lg">
                      <div
                        className={`flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 ${canExpand ? 'cursor-pointer' : ''}`}
                        onClick={() => canExpand && toggleExpand(j.id)}
                        role={canExpand ? 'button' : undefined}
                        tabIndex={canExpand ? 0 : undefined}
                        aria-expanded={canExpand ? isExpanded : undefined}
                        onKeyDown={(e) => {
                          if (!canExpand) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpand(j.id);
                          }
                        }}
                      >
                        <div className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                          <Code className="size-3.5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg truncate font-mono" title={j.code ?? j.id}>{j.code?.slice(0, 60) ?? j.id}</p>
                          <p className="text-[10px] text-fg-muted">
                            {j.language ?? 'python'} · {j.submittedAt ? timeAgo(j.submittedAt) : '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-fg-muted tabular-nums">
                          <span>{formatDuration(j.durationMs ?? 0)}</span>
                        </div>
                        <StatusPill
                          status={
                            j.status === 'completed' ? 'healthy' :
                            j.status === 'failed' ? 'offline' :
                            j.status === 'running' ? 'pending' :
                            j.status === 'queued' ? 'pending' :
                            j.status === 'cancelled' ? 'offline' : 'unknown'
                          }
                          label={j.status}
                          size="sm"
                          showDot={false}
                        />
                        {canExpand && (
                          <ChevronDown className={`size-3.5 text-fg-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden />
                        )}
                        {j.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); void handleCancel(j.id); }}
                            loading={cancelling[j.id]}
                            aria-label="Cancel job"
                          >
                            <X className="size-3" aria-hidden />
                          </Button>
                        )}
                      </div>
                      {isExpanded && (j.output || j.error) && (
                        <div className="px-3 pb-3 pl-14">
                          {j.error && (
                            <pre className="text-xs bg-danger-soft text-danger p-2 rounded-md overflow-x-auto max-h-40 overflow-y-auto">
                              {j.error}
                            </pre>
                          )}
                          {j.output && (
                            <pre className="text-xs bg-surface-2 text-fg p-2 rounded-md overflow-x-auto max-h-40 overflow-y-auto mt-1">
                              {j.output}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DataState>
        </Card>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>New sandbox job</DialogTitle>
            <DialogDescription>Run code in a sandboxed worker</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="sandbox-language" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Language</label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="sandbox-language"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="python">Python</SelectItem>
                    <SelectItem value="python3">Python 3</SelectItem>
                    <SelectItem value="node">Node.js</SelectItem>
                    <SelectItem value="javascript">JavaScript</SelectItem>
                    <SelectItem value="js">JS</SelectItem>
                    <SelectItem value="deno">Deno</SelectItem>
                    <SelectItem value="bun">Bun</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="sandbox-code" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Code</label>
                <Textarea
                  id="sandbox-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder="print('hello from sandbox')"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                />
              </div>
              <div>
                <label htmlFor="sandbox-timeout" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Timeout (ms)</label>
                <input
                  id="sandbox-timeout"
                  type="number"
                  min="1000"
                  max="30000"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                  className="flex h-8 w-36 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="5000"
                />
                <p className="text-[10px] text-fg-muted mt-1">Range: 1,000 – 30,000 ms</p>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={() => void handleSubmit()} loading={submitting}>
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
