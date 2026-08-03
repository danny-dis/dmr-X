import { AlertTriangle, Ban, Network, RadioTower, Search } from 'lucide-react';
import * as React from 'react';

import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Code } from '@/components/primitives/Code';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useUrlState } from '@/hooks/useUrlState';
import {
  useA2AStatus,
  useA2ATasks,
  useAgentCard,
  useCancelA2ATask,
  useProbeA2APeer,
  type A2ATaskState,
} from '@/lib/queries/a2a';

const TERMINAL: A2ATaskState[] = ['completed', 'canceled', 'failed', 'rejected'];

/**
 * Agent-to-Agent.
 *
 * Replaces a static block of text that described endpoints nobody could reach:
 * the A2A implementation runs in the MCP sidecar on a separate port, so a
 * browser served by the gateway had no same-origin path to it. Everything here
 * goes through the gateway's admin proxy.
 */
export function A2APage() {
  const [tab, setTab] = useUrlState('tab', 'card');
  const status = useA2AStatus();

  const enabled = status.data?.enabled ?? false;
  const reachable = status.data?.reachable ?? false;
  const live = enabled && reachable;

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Agent-to-Agent"
        description="The A2A protocol surface other agents use to discover and task this instance."
        icon={<Network className="size-5 text-primary" />}
        actions={
          status.isLoading ? null : (
            <StatusPill
              status={live ? 'healthy' : enabled ? 'offline' : 'unknown'}
              label={live ? 'Live' : enabled ? 'Unreachable' : 'Disabled'}
            />
          )
        }
      />

      <div className="mb-4">
        <DataState
          data={status.data}
          isLoading={status.isLoading}
          error={status.error}
          onRetry={status.refetch}
          loading={<Skeleton className="h-24 w-full" />}
        >
          {(data) => {
            const liveNow = data.enabled && data.reachable;
            return !liveNow ? (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="flex items-start gap-3 pt-5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="text-sm">
                    <div className="font-medium text-fg">
                      {data.enabled ? 'A2A is enabled but not answering' : 'A2A is disabled'}
                    </div>
                    {/* The backend returns the exact fix; show it verbatim rather
                        than paraphrasing into something vaguer. */}
                    <p className="mt-1 leading-relaxed text-fg-muted">{data.hint}</p>
                    {data.error && (
                      <p className="mt-1 font-mono text-2xs text-fg-subtle">{data.error}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="p-4">
                  <div className="text-2xs uppercase tracking-wide text-fg-subtle">Agent card</div>
                  <Code copyable className="mt-1.5">{data.agentCardUrl!}</Code>
                </Card>
                <Card className="p-4">
                  <div className="text-2xs uppercase tracking-wide text-fg-subtle">
                    JSON-RPC endpoint
                    {data.protocolVersion && (
                      <Badge tone="info" variant="soft" size="sm" className="ml-2">
                        v{String(data.protocolVersion)}
                      </Badge>
                    )}
                  </div>
                  <Code copyable className="mt-1.5">{data.jsonRpcUrl!}</Code>
                </Card>
              </div>
            );
          }}
        </DataState>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="card">Agent card</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="peers">Peers</TabsTrigger>
        </TabsList>

        <TabsContent value="card">
          <AgentCardPanel enabled={live} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksPanel enabled={live} />
        </TabsContent>
        <TabsContent value="peers">
          <PeersPanel />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function AgentCardPanel({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error, refetch } = useAgentCard(enabled);

  if (!enabled) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            icon={<RadioTower className="size-6" />}
            title="Agent card unavailable"
            description="Enable A2A and restart the MCP sidecar to publish an agent card."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <DataState
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        loading={<Skeleton className="h-64 w-full" />}
      >
        {(card) => {
          const caps = card.capabilities ?? {};
          return (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Identity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Detail label="Name" value={card.name ?? '—'} />
                  <Detail label="Description" value={card.description ?? '—'} />
                  <Detail label="URL" value={card.url ?? '—'} mono />
                  <Detail label="Protocol" value={card.protocolVersion ?? '—'} />
                  <Detail label="Preferred transport" value={card.preferredTransport ?? '—'} />

                  <div>
                    <div className="text-2xs uppercase tracking-wide text-fg-subtle">Capabilities</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {Object.entries(caps).length === 0 ? (
                        <span className="text-xs text-fg-muted">None advertised</span>
                      ) : (
                        Object.entries(caps).map(([key, value]) => (
                          <Badge key={key} tone={value ? 'success' : 'muted'} variant="soft" size="sm">
                            {key}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    Skills
                    <Badge tone="neutral" variant="soft" size="sm" className="ml-2">
                      {card.skills?.length ?? 0}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!card.skills?.length ? (
                    <p className="py-6 text-center text-sm text-fg-muted">
                      Skills are derived from the MCP tool list. Connect a server to advertise more.
                    </p>
                  ) : (
                    <ul className="max-h-96 space-y-2 overflow-y-auto">
                      {card.skills.map((skill, i) => (
                        <li key={skill.id ?? i} className="rounded-lg border border-border p-2.5">
                          <div className="font-mono text-xs text-fg">{skill.name ?? skill.id}</div>
                          {skill.description && (
                            <p className="mt-0.5 line-clamp-2 text-2xs text-fg-muted">{skill.description}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        }}
      </DataState>
    </div>
  );
}

function TasksPanel({ enabled }: { enabled: boolean }) {
  const [state, setState] = React.useState<A2ATaskState | undefined>(undefined);
  const { data, isLoading, error, refetch } = useA2ATasks(state, enabled);
  const cancel = useCancelA2ATask();

  if (!enabled) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            icon={<Network className="size-6" />}
            title="A2A is not running"
            description="Enable A2A above to start receiving tasks from other agents."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Tasks
          {data && (
            <span className="ml-2 text-xs font-normal text-fg-subtle">
              {data.total} shown · {data.retained} retained
            </span>
          )}
        </CardTitle>
        {/* Filter group: variant alone conveys selection visually, so the
            selected state also needs to be exposed programmatically. */}
        <div className="flex gap-1" role="group" aria-label="Filter tasks by state">
          <Button
            size="sm"
            variant={!state ? 'secondary' : 'ghost'}
            aria-pressed={!state}
            onClick={() => setState(undefined)}
          >
            All
          </Button>
          {(['working', 'completed', 'failed'] as A2ATaskState[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={state === s ? 'secondary' : 'ghost'}
              aria-pressed={state === s}
              className="capitalize"
              onClick={() => setState(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <DataState
          data={data?.tasks}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonRows={4}
          empty={{
            icon: <Network className="size-8" />,
            title: 'No tasks',
            description: 'Tasks appear here when a peer agent sends this instance work.',
          }}
        >
          {(tasks) => (
            <ul className="divide-y divide-border">
              {tasks.map((task) => {
                const terminal = TERMINAL.includes(task.status.state);
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5">
                    <Badge
                      tone={
                        task.status.state === 'completed'
                          ? 'success'
                          : task.status.state === 'working'
                            ? 'info'
                            : terminal
                              ? 'danger'
                              : 'neutral'
                      }
                      variant="soft"
                      size="sm"
                    >
                      {task.status.state}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-2xs text-fg">{task.id}</div>
                      <div className="truncate text-2xs text-fg-subtle">context {task.contextId}</div>
                    </div>
                    {task.artifacts.length > 0 && (
                      <span className="text-2xs text-fg-subtle">{task.artifacts.length} artifacts</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      // Terminal states are final in the spec; offering Cancel
                      // on one would be an action that can only fail.
                      disabled={terminal}
                      // Scoped to this row: `cancel.isPending` alone would put
                      // every task's Cancel button in flight at once.
                      loading={cancel.isPending && cancel.variables === task.id}
                      leftIcon={<Ban className="size-3.5" aria-hidden />}
                      onClick={() =>
                        cancel.mutate(task.id, {
                          onSuccess: () => toast.success('Task cancelled', { description: task.id }),
                          onError: (e) => {
                            const info = interpretError(e);
                            toast.error(info.title, { description: info.description });
                          },
                        })
                      }
                    >
                      Cancel
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}

function PeersPanel() {
  const [url, setUrl] = React.useState('');
  const probe = useProbeA2APeer();

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Probe a peer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs leading-relaxed text-fg-muted">
          Fetch another agent&rsquo;s card to confirm it is reachable and see what it advertises.
          This is read-only — DMR-X does not yet act as an A2A client, so nothing here starts a
          conversation with the peer.
        </p>

        <div>
          <label htmlFor="peer-probe-url" className="mb-1.5 block text-2xs uppercase tracking-wide text-fg-subtle">
            Peer URL
          </label>
          <div className="flex gap-2">
            <Input
              id="peer-probe-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://peer.example.com"
              className="flex-1"
            />
            <Button
              leftIcon={<Search className="size-4" aria-hidden />}
              disabled={!url.trim()}
              loading={probe.isPending}
              onClick={() =>
                probe.mutate(url.trim(), {
                  onError: (e) => {
                    const info = interpretError(e);
                    toast.error(info.title, { description: info.description });
                  },
                })
              }
            >
              Probe
            </Button>
          </div>
        </div>

        {probe.data && (
          <Card className="border-success/30 bg-success/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-fg">{probe.data.summary.name ?? 'Unnamed agent'}</div>
              <StatusPill status="healthy" label="Reachable" size="sm" />
            </div>
            {probe.data.summary.description && (
              <p className="mt-1 text-xs text-fg-muted">{probe.data.summary.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {probe.data.summary.protocolVersion && (
                <Badge tone="info" variant="soft" size="sm">
                  A2A v{probe.data.summary.protocolVersion}
                </Badge>
              )}
              {probe.data.summary.preferredTransport && (
                <Badge tone="neutral" variant="soft" size="sm">
                  {probe.data.summary.preferredTransport}
                </Badge>
              )}
              <Badge tone="neutral" variant="soft" size="sm">
                {probe.data.summary.skillCount} skills
              </Badge>
            </div>
            <Code copyable className="mt-2">{probe.data.url}</Code>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={mono ? 'mt-0.5 break-all font-mono text-xs text-fg' : 'mt-0.5 text-sm text-fg'}>
        {value}
      </div>
    </div>
  );
}
