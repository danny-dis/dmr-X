import * as React from 'react';
import { Terminal, Plus, Play, Code, Cpu, Clock, ChevronRight, RefreshCw, X } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Code as CodeBlock } from '@/components/primitives/Code';
import { StatusPill } from '@/components/primitives/StatusPill';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, timeAgo } from '@/lib/formatters';
import type { ApiSandboxJob } from '@/types/api';

export function SandboxPage() {
  const jobs = useApiData<ApiSandboxJob[]>(
    () => Admin.listSandboxJobs(),
    [],
    { refetchInterval: 5000 }
  );

  const [open, setOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<Record<string, boolean>>({});
  const [language, setLanguage] = React.useState('python');
  const [code, setCode] = React.useState('');
  const [timeoutMs, setTimeoutMs] = React.useState('5000');
  const [submitting, setSubmitting] = React.useState(false);

  async function handleCancel(id: string) {
    setCancelling((prev) => ({ ...prev, [id]: true }));
    try {
      await Admin.cancelSandbox(id);
      toast.success('Job cancelled');
      jobs.refetch();
    } catch {
      toast.error('Failed to cancel job');
    } finally {
      setCancelling((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await Admin.submitSandbox({
        language,
        code,
        timeoutMs: Number(timeoutMs),
      });
      toast.success('Job submitted successfully');
      setOpen(false);
      setCode('');
      setLanguage('python');
      setTimeoutMs('5000');
      jobs.refetch();
    } catch {
      toast.error('Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Sandbox"
        description="Ephemeral execution environment for tool and code testing"
        icon={<Terminal className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3" />
            New job
          </Button>
        }
      />

      <Card padding="md" className="mt-5">
        <CardHeader className="px-0 pt-0">
          <CardTitle>Submit a job</CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Run code in a sandboxed worker</p>
        </CardHeader>
        <CardContent className="px-0">
          <CodeBlock inline={false} copyable>
{`POST /admin/sandbox/jobs
{
  "language": "python",
  "code": "print('hello from sandbox')",
  "timeoutMs": 5000
}`}
          </CodeBlock>
        </CardContent>
      </Card>

      <div className="mt-3">
        <Card padding="none">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Recent jobs</h3>
            <Badge tone="muted" size="sm">{(jobs.data ?? []).length}</Badge>
          </div>
          {jobs.isLoading ? (
            <div className="p-3 flex flex-col gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : jobs.data && jobs.data.length > 0 ? (
            <div className="p-1">
              {jobs.data.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                    <Code className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg truncate font-mono">{j.code?.slice(0, 60) ?? j.id}</p>
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
                      j.status === 'running' ? 'pending' : 'unknown'
                    }
                    label={j.status}
                    size="sm"
                    showDot={false}
                  />
                  {j.status === 'running' && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleCancel(j.id)}
                      disabled={cancelling[j.id]}
                    >
                      {cancelling[j.id] ? '...' : <X className="size-3" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No jobs"
              description="Submit a job to test code in a sandboxed environment."
            />
          )}
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
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Language</label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Code</label>
                <Textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder="print('hello from sandbox')"
                />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Timeout (ms)</label>
                <input
                  type="number"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                  className="flex h-8 w-36 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="5000"
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
