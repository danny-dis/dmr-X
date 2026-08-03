import { Bot, MessageSquare, Pause, Play, Plus, Rocket, Trash2, Loader2, Upload } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';

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
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { ImportAgentsDialog } from '@/components/domain/ImportAgentsDialog';
import { useUrlState } from '@/hooks/useUrlState';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';
import {
  useAgentInstances,
  useAgents,
  useDeleteAgent,
  useDeployAgent,
  useSetInstanceRunning,
  type AgentDefinition,
  type AgentInstanceDetail,
} from '@/lib/queries/agents';

/**
 * Agent definitions and their deployed instances.
 *
 * The page this replaces was non-functional: it called `Admin.fetch`, which
 * does not exist, and passed a string where a fetcher function was required,
 * so every list threw on mount and rendered permanently empty.
 */
export function AgentsPage() {
  const [search, setSearch] = useUrlState('q', '');
  const [importOpen, setImportOpen] = React.useState(false);
  const agents = useAgents(search ? { search } : {});
  const instances = useAgentInstances();

  const instancesByDefinition = React.useMemo(() => {
    const map = new Map<string, AgentInstanceDetail[]>();
    for (const inst of instances.data?.items ?? []) {
      const list = map.get(inst.agentDefinitionId) ?? [];
      list.push(inst);
      map.set(inst.agentDefinitionId, list);
    }
    return map;
  }, [instances.data]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Agents"
        description="Build an agent, deploy it as an instance, then talk to it or let the router dispatch to it."
        icon={<Bot className="size-5 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<Upload className="size-4" />}
              onClick={() => setImportOpen(true)}
            >
              Import
            </Button>
            <Button leftIcon={<Plus className="size-4" />} asChild>
              <Link to="/agents/new">New agent</Link>
            </Button>
          </div>
        }
      />

      <ImportAgentsDialog open={importOpen} onOpenChange={setImportOpen} />

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agents…"
        aria-label="Search agents"
        className="mb-4 w-72"
      />

      <DataState
        data={agents.data?.items}
        isLoading={agents.isLoading}
        error={agents.error}
        onRetry={() => agents.refetch()}
        loading={
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        }
        empty={{
          icon: <Bot className="size-8" />,
          title: search ? `No agent matches “${search}”` : 'No agents yet',
          description: 'An agent is a system prompt, a model tier and a set of tools it may call.',
          action: !search ? (
            <Button asChild>
              <Link to="/agents/new">Create your first agent</Link>
            </Button>
          ) : undefined,
        }}
      >
        {(items) => (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                instances={instancesByDefinition.get(agent.id) ?? []}
              />
            ))}
          </div>
        )}
      </DataState>
    </PageContainer>
  );
}

function AgentCard({ agent, instances }: { agent: AgentDefinition; instances: AgentInstanceDetail[] }) {
  const navigate = useNavigate();
  const deploy = useDeployAgent();
  const remove = useDeleteAgent();
  const setRunning = useSetInstanceRunning();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const active = instances.filter((i) => i.status === 'active');
  const cost24h = instances.reduce((sum, i) => sum + i.costCents24h, 0) / 100;
  const totalRuns = instances.reduce((s, i) => s + i.executionCount, 0);
  const lastRun = instances
    .map((i) => i.lastExecutionAt)
    .filter(Boolean)
    .sort()
    .pop();

  // Only offer pause when there is exactly one instance — with several, the
  // action is ambiguous and belongs on the detail page's instance list.
  const soleInstance = instances.length === 1 ? instances[0] : null;

  const agentLabel = agent.humanName || agent.name;

  const handleDelete = () => {
    remove.mutate(agent.id, {
      onSuccess: () => {
        toast.success(`${agentLabel} deleted`, { description: 'Its instances and run history were removed too.' });
      },
      onError: (e) => {
        const info = interpretError(e);
        toast.error(info.title, { description: info.description });
      },
    });
  };

  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-border-2">
      <Link to={`/agents/${agent.id}`} className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-fg">{agentLabel}</span>
          {instances.length === 0 ? (
            <StatusPill status="unknown" label="Not deployed" size="sm" pulse={false} />
          ) : active.length > 0 ? (
            <StatusPill status="active" label={`${active.length} running`} size="sm" />
          ) : (
            <StatusPill status="warning" label="Paused" size="sm" pulse={false} />
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-muted">
          {agent.description || 'No description'}
        </p>
      </Link>

      <div className="mt-3 flex flex-wrap gap-1">
        {agent.category && (
          <Badge tone="neutral" variant="outline" size="sm">{agent.category}</Badge>
        )}
        <Badge tone="neutral" variant="outline" size="sm">{agent.modelTier}</Badge>
        {agent.allowedTools.length > 0 && (
          <Badge tone="neutral" variant="outline" size="sm">
            {agent.allowedTools.length} tools
          </Badge>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 text-2xs text-fg-subtle">
        <span>{formatNumber(totalRuns)} runs</span>
        <span>{formatCurrency(cost24h)} / 24h</span>
        {lastRun && <span>last {formatDate(lastRun)}</span>}
      </div>

      <div className="mt-auto flex items-center gap-1 pt-3">
        {instances.length === 0 ? (
          <Button
            size="sm"
            leftIcon={<Rocket className="size-3.5" />}
            loading={deploy.isPending}
            onClick={() =>
              deploy.mutate(agent.id, {
                onSuccess: () =>
                  toast.success(`${agentLabel} deployed`, { description: 'An instance is now live and ready to chat with.' }),
                onError: (e) => {
                  const info = interpretError(e);
                  toast.error(info.title, { description: info.description });
                },
              })
            }
          >
            Deploy
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<MessageSquare className="size-3.5" />}
            onClick={() => navigate(`/playground/agent?instance=${instances[0].id}`)}
          >
            Chat
          </Button>
        )}

        {soleInstance && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={soleInstance.status === 'active' ? 'Pause agent' : 'Resume agent'}
                loading={setRunning.isPending}
                onClick={() =>
                  setRunning.mutate(
                    { instanceId: soleInstance.id, running: soleInstance.status !== 'active' },
                    {
                      onError: (e) => {
                        const info = interpretError(e);
                        toast.error(info.title, { description: info.description });
                      },
                    },
                  )
                }
              >
                {soleInstance.status === 'active' ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {soleInstance.status === 'active'
                ? 'Pause — stops being a dispatch target'
                : 'Resume'}
            </TooltipContent>
          </Tooltip>
        )}

        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Delete agent"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

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
            <AlertDialogAction onClick={handleDelete} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
