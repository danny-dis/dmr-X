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

  return (
    <PageContainer>
      <PageHeader
        title="Sandbox"
        description="Ephemeral execution environment for tool and code testing"
        icon={<Terminal className="size-5" />}
        actions={
          <Button size="sm">
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
                      {j.language ?? 'python'} · {timeAgo(j.submittedAt)}
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
    </PageContainer>
  );
}
