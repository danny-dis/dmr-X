import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  DollarSign,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Terminal,
  Zap,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile, type StatTileProps } from '@/components/primitives/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { useHealth } from '@/lib/queries/dashboard';
import {
  useAgentExecutions,
  useAgentInstances,
  useAgentSteps,
  useDeleteInstance,
  useSetInstanceRunning,
  type AgentExecution,
  type AgentInstanceDetail,
} from '@/lib/queries/agents';
import { formatCurrency, formatDateTime, formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import { useLiveStore } from '@/store/useLiveStore';

/** Status pill color for instance status */
function instanceStatusTone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'active') return 'success';
  if (status === 'paused') return 'warning';
  if (status === 'failed' || status === 'stopped') return 'danger';
  return 'muted';
}

function StatTileSkeleton({ label, icon, tone }: { label: string; icon: React.ReactNode; tone?: StatTileProps['tone'] }) {
  return <StatTile label={label} icon={icon} tone={tone} value="" loading />;
}

export function RuntimePage() {
  const { data: health, isLoading: healthLoading } = useHealth();
  const instances = useAgentInstances();
  const liveStats = useLiveStore((s) => s.stats);
  const connection = useLiveStore((s) => s.connection);

  // Compute runtime stats from instances
  const stats = React.useMemo(() => {
    const items = instances.data?.items ?? [];
    const active = items.filter((i) => i.status === 'active');
    const paused = items.filter((i) => i.status === 'paused');
    const failed = items.filter((i) => i.status === 'failed');
    const totalCost = items.reduce((sum, i) => sum + i.costCents24h, 0) / 100;
    const totalRuns = items.reduce((sum, i) => sum + i.executionCount, 0);
    return {
      total: items.length,
      active: active.length,
      paused: paused.length,
      failed: failed.length,
      totalCost,
      totalRuns,
    };
  }, [instances.data]);

  const systemStatus = health?.status === 'ok' || health?.status === 'operational'
    ? 'Operational'
    : health?.status === 'degraded'
      ? 'Degraded'
      : 'Unknown';

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Runtime"
        description="Live agent instances, tasks, and execution state"
        icon={<Cpu className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={connection === 'open' ? 'success' : 'muted'} size="md" icon={<Activity className="size-3" aria-hidden />}>
              {connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Polling'}
            </Badge>
            <Badge tone="success" size="md" icon={<CheckCircle2 className="size-3" aria-hidden />}>
              {systemStatus}
            </Badge>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/agents">
                <Plus className="size-3" aria-hidden />
                Deploy agent
              </Link>
            </Button>
          </div>
        }
      />

      {/* ── KPI row ── */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DataState
          data={instances.data?.items}
          isLoading={instances.isLoading}
          error={instances.error}
          onRetry={() => instances.refetch()}
          loading={
            <>
              <StatTileSkeleton label="Running Instances" icon={<Cpu className="size-3.5" />} tone="success" />
              <StatTileSkeleton label="Active Tasks" icon={<Zap className="size-3.5" />} tone="primary" />
            </>
          }
        >
          {() => (
            <>
              <StatTile
                label="Running Instances"
                value={stats.active}
                icon={<Cpu className="size-3.5" />}
                tone="success"
                hint={`${stats.total} total · ${stats.paused} paused`}
              />
              <StatTile
                label="Active Tasks"
                value={stats.active}
                icon={<Zap className="size-3.5" />}
                tone="primary"
                hint="In-flight executions"
              />
            </>
          )}
        </DataState>
        <DataState
          data={instances.data?.items}
          isLoading={instances.isLoading}
          error={instances.error}
          onRetry={() => instances.refetch()}
          loading={<StatTileSkeleton label="Total Runs" icon={<Activity className="size-3.5" />} tone="accent" />}
        >
          {() => (
            <StatTile
              label="Total Runs"
              value={formatNumber(stats.totalRuns, true)}
              icon={<Activity className="size-3.5" />}
              tone="accent"
              hint="Across all instances"
            />
          )}
        </DataState>
        <DataState
          data={instances.data?.items}
          isLoading={instances.isLoading}
          error={instances.error}
          onRetry={() => instances.refetch()}
          loading={<StatTileSkeleton label="Cost (24h)" icon={<DollarSign className="size-3.5" />} tone="warning" />}
        >
          {() => (
            <StatTile
              label="Cost (24h)"
              value={formatCurrency(stats.totalCost)}
              icon={<DollarSign className="size-3.5" />}
              tone="warning"
              hint="All instances"
            />
          )}
        </DataState>
      </div>

      {/* ── Main content ── */}
      <div className="mt-5">
        <Tabs defaultValue="instances">
          <TabsList>
            <TabsTrigger value="instances">Instances ({stats.total})</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>

          <TabsContent value="instances">
            <div className="mt-4">
              <DataState
                data={instances.data?.items}
                isLoading={instances.isLoading}
                error={instances.error}
                onRetry={() => instances.refetch()}
                skeletonRows={3}
                empty={{
                  icon: <Cpu className="size-8" />,
                  title: 'No instances running',
                  description: 'Deploy an agent to see it running here.',
                  action: (
                    <Button asChild>
                      <Link to="/agents">Go to agents</Link>
                    </Button>
                  ),
                }}
              >
                {(items) => (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((instance) => (
                      <InstanceCard key={instance.id} instance={instance} />
                    ))}
                  </div>
                )}
              </DataState>
            </div>
          </TabsContent>

          <TabsContent value="runs">
            <div className="mt-4">
              <RunsList instances={instances.data?.items ?? []} />
            </div>
          </TabsContent>

          <TabsContent value="events">
            <div className="mt-4">
              <EventsPanel />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

// ── Instance Card ──────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: AgentInstanceDetail }) {
  const setRunning = useSetInstanceRunning();
  const remove = useDeleteInstance();
  const executions = useAgentExecutions(instance.id);
  const [showTrace, setShowTrace] = React.useState(false);

  const running = instance.status === 'active';
  const lastRun = instance.lastExecutionAt;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`size-2 rounded-full ${running ? 'bg-success' : 'bg-warning'}`} aria-hidden />
          <span className="truncate text-sm font-medium text-fg">
            {instance.definitionHumanName ?? instance.definitionName ?? 'Unnamed'}
          </span>
        </div>
        <Badge tone={instanceStatusTone(instance.status)} variant="soft" size="sm">
          {instance.status}
        </Badge>
      </div>

      <div className="mt-2 text-[11px] text-fg-subtle font-mono truncate">{instance.id}</div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-fg-muted">Model tier</div>
          <div className="text-fg">{instance.definitionModelTier ?? 'default'}</div>
        </div>
        <div>
          <div className="text-fg-muted">Runs</div>
          <div className="text-fg tabular-nums">{instance.executionCount}</div>
        </div>
        <div>
          <div className="text-fg-muted">Cost (24h)</div>
          <div className="text-fg tabular-nums">{formatCurrency(instance.costCents24h / 100)}</div>
        </div>
        <div>
          <div className="text-fg-muted">Last run</div>
          <div className="text-fg">{lastRun ? timeAgo(lastRun) : '—'}</div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1 pt-3">
        <Button
          size="sm"
          variant="ghost"
          leftIcon={running ? <Pause className="size-3" /> : <Play className="size-3" />}
          loading={setRunning.isPending}
          onClick={() =>
            setRunning.mutate(
              { instanceId: instance.id, running: !running },
            )
          }
        >
          {running ? 'Pause' : 'Resume'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<RotateCcw className="size-3" />}
          loading={setRunning.isPending}
          onClick={() => setRunning.mutate({ instanceId: instance.id, running: true })}
        >
          Restart
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Terminal className="size-3" />}
          onClick={() => setShowTrace(!showTrace)}
        >
          {showTrace ? 'Hide trace' : 'Trace'}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Stop instance"
          onClick={() => remove.mutate(instance.id)}
        >
          <Square className="size-3" />
        </Button>
      </div>

      {showTrace && (
        <div className="mt-3 border-t border-border pt-3">
          <InstanceTrace instanceId={instance.id} />
        </div>
      )}
    </Card>
  );
}

// ── Instance Trace ─────────────────────────────────────────────────────────

function InstanceTrace({ instanceId }: { instanceId: string }) {
  const executions = useAgentExecisions(instanceId);
  const [selectedExecution, setSelectedExecution] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      <DataState
        data={executions.data}
        isLoading={executions.isLoading}
        error={executions.error}
        onRetry={() => executions.refetch()}
        skeletonRows={2}
        empty={{
          title: 'No executions yet',
          description: 'Run history appears here once the agent executes.',
        }}
      >
        {(list) => (
          <div className="space-y-1">
            {list.slice(0, 5).map((exec) => (
              <button
                key={exec.id}
                type="button"
                className={`w-full text-left rounded p-2 text-xs transition-colors ${
                  selectedExecution === exec.id ? 'bg-primary/10 border border-primary/20' : 'bg-surface-2 hover:bg-surface-3'
                }`}
                onClick={() => setSelectedExecution(selectedExecution === exec.id ? null : exec.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={exec.status === 'completed' ? 'text-success' : exec.status === 'failed' ? 'text-danger' : 'text-warning'}>
                    {exec.status === 'completed' ? '✓' : exec.status === 'failed' ? '✗' : '○'}
                  </span>
                  <span className="truncate text-fg">{exec.input ?? 'No input'}</span>
                  <span className="ml-auto text-fg-subtle tabular-nums">{formatCurrency(exec.costCents / 100)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </DataState>
      {selectedExecution && (
        <ExecutionSteps instanceId={instanceId} executionId={selectedExecution} />
      )}
    </div>
  );
}

// ── Execution Steps ────────────────────────────────────────────────────────

function ExecutionSteps({ instanceId, executionId }: { instanceId: string; executionId: string }) {
  const steps = useAgentSteps(instanceId, executionId);

  return (
    <DataState
      data={steps.data?.items}
      isLoading={steps.isLoading}
      error={steps.error}
      onRetry={() => steps.refetch()}
      skeletonRows={3}
      empty={{
        title: 'No steps recorded',
        description: 'Step-level detail appears after the agent executes.',
      }}
    >
      {(items) => (
        <ol className="space-y-1.5">
          {items.map((step, i) => (
            <li key={`${step.conversationId}-${step.turn}-${i}`} className="rounded bg-surface-2 p-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-fg-muted">Turn {step.turn}</span>
                <span className={step.status === 'completed' ? 'text-success' : step.status === 'error' ? 'text-danger' : 'text-warning'}>
                  {step.status ?? 'unknown'}
                </span>
                <span className="ml-auto text-fg-subtle tabular-nums">
                  {formatNumber(step.tokenDelta)} tok · {formatCurrency(step.costDelta)}
                </span>
              </div>
              {step.allowedToolCalls.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {step.allowedToolCalls.map((t, j) => (
                    <span key={j} className="rounded bg-success/10 px-1 py-0.5 font-mono text-[10px] text-success">{t}</span>
                  ))}
                </div>
              )}
              {step.blockedToolCalls.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {step.blockedToolCalls.map((t, j) => (
                    <span key={j} className="rounded bg-danger/10 px-1 py-0.5 font-mono text-[10px] text-danger">{t}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </DataState>
  );
}

// ── Runs List ──────────────────────────────────────────────────────────────

function RunsList({ instances }: { instances: AgentInstanceDetail[] }) {
  const [selectedInstance, setSelectedInstance] = React.useState<string | null>(instances[0]?.id ?? null);
  const executions = useAgentExecutions(selectedInstance ?? undefined);

  React.useEffect(() => {
    if (!selectedInstance && instances.length > 0) {
      setSelectedInstance(instances[0].id);
    }
  }, [instances, selectedInstance]);

  return (
    <div className="space-y-4">
      {instances.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {instances.map((inst) => (
            <button
              key={inst.id}
              type="button"
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                selectedInstance === inst.id
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-surface-2 text-fg-muted border border-border hover:bg-surface-3'
              }`}
              onClick={() => setSelectedInstance(inst.id)}
            >
              {inst.definitionHumanName ?? inst.definitionName ?? inst.id}
            </button>
          ))}
        </div>
      )}
      <DataState
        data={executions.data}
        isLoading={executions.isLoading}
        error={executions.error}
        onRetry={() => executions.refetch()}
        skeletonRows={5}
        empty={{
          icon: <Activity className="size-8" />,
          title: 'No runs recorded',
          description: 'Run history appears here once instances execute.',
        }}
      >
        {(list) => (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Input</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Model</th>
                  <th className="text-right p-3 font-medium">Tokens</th>
                  <th className="text-right p-3 font-medium">Cost</th>
                  <th className="text-right p-3 font-medium">Duration</th>
                  <th className="text-right p-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((exec) => (
                  <tr key={exec.id} className="hover:bg-surface-1">
                    <td className="p-3 max-w-xs truncate text-fg">{exec.input ?? '—'}</td>
                    <td className="p-3">
                      <Badge
                        tone={exec.status === 'completed' ? 'success' : exec.status === 'failed' ? 'danger' : 'warning'}
                        variant="soft"
                        size="sm"
                      >
                        {exec.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-fg-muted">{exec.modelUsed ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums text-fg-muted">
                      {formatNumber(exec.inputTokens + exec.outputTokens, true)}
                    </td>
                    <td className="p-3 text-right tabular-nums text-fg-muted">{formatCurrency(exec.costCents / 100)}</td>
                    <td className="p-3 text-right tabular-nums text-fg-muted">{formatDuration(exec.durationMs)}</td>
                    <td className="p-3 text-right text-fg-subtle">{exec.createdAt ? timeAgo(exec.createdAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
    </div>
  );
}

// ── Events Panel ───────────────────────────────────────────────────────────

function EventsPanel() {
  const events = useLiveStore((s) => s.events);
  const decisions = useLiveStore((s) => s.decisions);

  const allEvents = React.useMemo(() => {
    const combined = [
      ...events.map((e) => ({
        id: e.id ?? Math.random().toString(),
        time: e.timestamp ?? new Date().toISOString(),
        type: 'telemetry',
        message: e.message ?? e.kind ?? 'Event',
        severity: e.level ?? 'info',
      })),
      ...decisions.map((d) => ({
        id: d.id ?? Math.random().toString(),
        time: d.timestamp,
        type: 'routing',
        message: `${d.selected_provider}/${d.selected_model} — ${d.status}`,
        severity: d.status === 'error' ? 'error' : d.status === 'fallback' ? 'warning' : 'info',
      })),
    ];
    return combined.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 50);
  }, [events, decisions]);

  return (
    <DataState
      data={allEvents}
      isLoading={false}
      error={null}
      empty={{
        icon: <Activity className="size-8" />,
        title: 'No events yet',
        description: 'Live events appear here as the gateway processes requests.',
      }}
    >
      {(list) => (
        <div className="rounded-xl border border-border divide-y divide-border max-h-[600px] overflow-y-auto">
          {list.map((event) => (
            <div key={event.id} className="flex items-start gap-3 p-3 text-xs">
              <div className={`mt-0.5 size-2 rounded-full shrink-0 ${
                event.severity === 'error' ? 'bg-danger' : event.severity === 'warning' ? 'bg-warning' : 'bg-info'
              }`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-fg truncate">{event.message}</div>
                <div className="text-fg-subtle">{event.type} · {timeAgo(event.time)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DataState>
  );
}
