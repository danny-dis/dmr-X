import { Bot, MessageSquare, Pause, Play, Rocket, Trash2, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { AgentForm, type AgentFormValues } from './AgentForm';
import { RunTrace } from './RunTrace';

import { PageContainer, PageHeader } from '@/components/layout';
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
import { BackLink } from '@/components/primitives/BackLink';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useUrlState } from '@/hooks/useUrlState';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/formatters';
import {
  useAgent,
  useAgentInstancesFor,
  useDeleteAgent,
  useDeleteInstance,
  useDeployAgent,
  usePublishAgent,
  useSetInstanceRunning,
  useUpdateAgent,
  type AgentInstanceDetail,
} from '@/lib/queries/agents';

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useUrlState('tab', 'overview');

  const agent = useAgent(id);
  const instances = useAgentInstancesFor(id);
  const update = useUpdateAgent();
  const deploy = useDeployAgent();
  const publish = usePublishAgent();
  const remove = useDeleteAgent();
  const [editError, setEditError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const handleUpdate = (agentId: string, values: AgentFormValues) => {
    setEditError(null);
    update.mutate(
      { id: agentId, ...values },
      {
        onSuccess: () => toast.success('Agent updated'),
        onError: (e) => {
          const info = interpretError(e);
          setEditError(info.description);
          toast.error(info.title, { description: info.description });
        },
      },
    );
  };

  const handleDelete = (agentId: string, agentName: string) => {
    remove.mutate(agentId, {
      onSuccess: () => {
        toast.success(`${agentName} deleted`, { description: 'Its instances and run history were removed too.' });
        navigate('/agents');
      },
      onError: (e) => {
        const info = interpretError(e);
        toast.error(info.title, { description: info.description });
      },
    });
  };

  return (
    <PageContainer size="wide">
      <BackLink to="/agents">Agents</BackLink>

      <DataState
        data={agent.data}
        isLoading={agent.isLoading}
        error={agent.error}
        onRetry={() => agent.refetch()}
        skeletonRows={6}
        empty={{
          icon: <Bot className="size-8" />,
          title: 'Agent not found',
          description: 'It may have been deleted. Go back to the agent list to pick another.',
        }}
      >
        {(def) => {
          const items = instances.data?.items ?? [];
          const agentLabel = def.humanName || def.name;

          return (
            <>
              <PageHeader
                title={agentLabel}
                description={def.description ?? undefined}
                icon={<Bot className="size-5 text-primary" />}
                actions={
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      leftIcon={<Rocket className="size-4" />}
                      loading={deploy.isPending}
                      onClick={() =>
                        deploy.mutate(def.id, {
                          onSuccess: () => toast.success('Deployed', { description: 'A new instance is now live.' }),
                          onError: (e) => {
                            const info = interpretError(e);
                            toast.error(info.title, { description: info.description });
                          },
                        })
                      }
                    >
                      Deploy instance
                    </Button>
                    {items.length > 0 && (
                      <Button
                        leftIcon={<MessageSquare className="size-4" />}
                        onClick={() => navigate(`/playground/agent?instance=${items[0].id}`)}
                      >
                        Chat
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      leftIcon={<Trash2 className="size-4" />}
                      aria-label="Delete agent"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete
                    </Button>
                  </div>
                }
              />

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="instances">Instances ({items.length})</TabsTrigger>
                  <TabsTrigger value="runs">Runs</TabsTrigger>
                  <TabsTrigger value="triggers">Triggers</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        <Detail label="Model tier" value={def.modelTier} />
                        <Detail label="Preferred model" value={def.preferredModel ?? 'Router decides'} />
                        <Detail label="Visibility" value={def.visibility} />
                        <Detail label="Version" value={def.version} />
                        <div>
                          <div className="text-2xs uppercase tracking-wide text-fg-subtle">Allowed tools</div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {def.allowedTools.length === 0 ? (
                              <span className="text-xs text-fg-muted">None — reply only</span>
                            ) : (
                              def.allowedTools.map((t) => (
                                <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                                  {t}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle>System prompt</CardTitle></CardHeader>
                      <CardContent>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-fg-muted">
                          {def.systemPrompt || 'No system prompt set.'}
                        </pre>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="secondary"
                      loading={publish.isPending}
                      onClick={() =>
                        publish.mutate(def.id, {
                          onSuccess: () => toast.success('Published to the marketplace'),
                          onError: (e) => {
                            const info = interpretError(e);
                            toast.error(info.title, { description: info.description });
                          },
                        })
                      }
                    >
                      Publish to marketplace
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="edit">
                  <div className="mt-4">
                    <AgentForm
                      submitLabel="Save changes"
                      pending={update.isPending}
                      error={editError}
                      onCancel={() => setTab('overview')}
                      onSubmit={(values) => handleUpdate(def.id, values)}
                      defaultValues={{
                        name: def.name,
                        humanName: def.humanName ?? undefined,
                        description: def.description ?? undefined,
                        systemPrompt: def.systemPrompt ?? undefined,
                        personality: def.personality ?? undefined,
                        preferredModel: def.preferredModel ?? undefined,
                        modelTier: (def.modelTier as AgentFormValues['modelTier']) ?? 'auto',
                        category: def.category ?? undefined,
                        visibility: (def.visibility as AgentFormValues['visibility']) ?? 'private',
                        allowedTools: def.allowedTools,
                        planMode: def.planMode ?? false,
                        historyCompaction: def.historyCompaction ?? false,
                        verifyOnStop: def.verifyOnStop ?? false,
                      }}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="instances">
                  <Card className="mt-4">
                    <CardContent className="pt-5">
                      <DataState
                        data={instances.data?.items}
                        isLoading={instances.isLoading}
                        error={instances.error}
                        onRetry={() => instances.refetch()}
                        skeletonRows={3}
                        empty={{
                          icon: <Rocket className="size-6" />,
                          title: 'Not deployed',
                          description: 'Deploying creates an addressable instance you can chat with or dispatch to.',
                        }}
                      >
                        {(rows) => (
                          <ul className="divide-y divide-border">
                            {rows.map((inst) => (
                              <InstanceRow key={inst.id} instance={inst} />
                            ))}
                          </ul>
                        )}
                      </DataState>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="runs">
                  <div className="mt-4">
                    <DataState
                      data={instances.data?.items}
                      isLoading={instances.isLoading}
                      error={instances.error}
                      onRetry={() => instances.refetch()}
                      skeletonRows={3}
                      empty={{
                        icon: <Rocket className="size-6" />,
                        title: 'No instances to show runs for',
                        description: 'Deploy an instance, then its run trace appears here.',
                      }}
                    >
                      {(rows) => <RunTrace instanceId={rows[0].id} />}
                    </DataState>
                  </div>
                </TabsContent>

                <TabsContent value="triggers">
                  <Card className="mt-4">
                    <CardHeader><CardTitle>Triggers</CardTitle></CardHeader>
                    <CardContent>
                      {def.triggers.length === 0 ? (
                        <EmptyState
                          size="sm"
                          title="No triggers configured"
                          description="Scheduled triggers dispatch this agent automatically once added to its definition."
                        />
                      ) : (
                        <ul className="space-y-2">
                          {def.triggers.map((trigger, i) => {
                            const type = String((trigger as { type?: string }).type ?? 'unknown');
                            // Only `schedule` is dispatched today; the others are
                            // stored but nothing acts on them. Say so rather than
                            // implying they work.
                            const wired = type === 'schedule';
                            return (
                              <li key={i} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                                <Badge tone={wired ? 'success' : 'muted'} variant="soft" size="sm">
                                  {type}
                                </Badge>
                                <code className="flex-1 truncate font-mono text-2xs text-fg-muted">
                                  {JSON.stringify(trigger)}
                                </code>
                                {!wired && (
                                  <span className="shrink-0 text-2xs text-warning">Stored, not yet dispatched</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{agentLabel}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Its instances and run history are deleted too. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(def.id, agentLabel)} disabled={remove.isPending}>
                      {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          );
        }}
      </DataState>
    </PageContainer>
  );
}

function InstanceRow({ instance }: { instance: AgentInstanceDetail }) {
  const setRunning = useSetInstanceRunning();
  const remove = useDeleteInstance();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const running = instance.status === 'active';

  return (
    <li className="flex items-center gap-3 py-3">
      <StatusPill status={running ? 'active' : 'warning'} label={instance.status} size="sm" pulse={running} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-2xs text-fg">{instance.id}</div>
        <div className="text-2xs text-fg-subtle">
          {formatNumber(instance.executionCount)} runs · {formatCurrency(instance.costCents24h / 100)} / 24h
          {instance.lastExecutionAt && ` · last ${formatDateTime(instance.lastExecutionAt)}`}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        loading={setRunning.isPending}
        onClick={() =>
          setRunning.mutate(
            { instanceId: instance.id, running: !running },
            {
              onError: (e) => {
                const info = interpretError(e);
                toast.error(info.title, { description: info.description });
              },
            },
          )
        }
      >
        {running ? 'Pause' : 'Resume'}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Delete instance"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this instance?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything holding <span className="font-mono">{instance.id}</span> stops working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(instance.id, {
                  onSuccess: () => toast.success('Instance deleted'),
                  onError: (e) => {
                    const info = interpretError(e);
                    toast.error(info.title, { description: info.description });
                  },
                })
              }
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-sm text-fg">{value}</div>
    </div>
  );
}
