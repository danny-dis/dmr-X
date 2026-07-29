import { Bot, MessageSquare, Pause, Play, Plus, Rocket, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';

import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { toast } from '@/components/primitives/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { useUrlState } from '@/hooks/useUrlState';
import {
  useAgentInstances,
  useAgents,
  useDeleteAgent,
  useDeployAgent,
  useSetInstanceRunning,
  type AgentDefinition,
  type AgentInstanceDetail,
} from '@/lib/queries/agents';

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/**
 * Agent definitions and their deployed instances.
 *
 * The page this replaces was non-functional: it called `Admin.fetch`, which
 * does not exist, and passed a string where a fetcher function was required,
 * so every list threw on mount and rendered permanently empty.
 */
export function AgentsPage() {
  const [search, setSearch] = useUrlState('q', '');
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

  const items = agents.data?.items ?? [];

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Agents"
        description="Build an agent, deploy it as an instance, then talk to it or let the router dispatch to it."
        icon={<Bot className="size-5 text-primary" />}
        actions={
          <Button leftIcon={<Plus className="size-4" />} asChild>
            <Link to="/agents/new">New agent</Link>
          </Button>
        }
      />

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agents…"
        className="mb-4 w-72"
      />

      {agents.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : agents.isError ? (
        <EmptyState
          icon={<Bot className="size-6" />}
          title="Could not load agents"
          description={(agents.error as Error)?.message}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bot className="size-6" />}
          title={search ? `No agent matches “${search}”` : 'No agents yet'}
          description="An agent is a system prompt, a model tier and a set of tools it may call."
          action={
            !search && (
              <Button asChild>
                <Link to="/agents/new">Create your first agent</Link>
              </Button>
            )
          }
        />
      ) : (
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
    </PageContainer>
  );
}

function AgentCard({ agent, instances }: { agent: AgentDefinition; instances: AgentInstanceDetail[] }) {
  const navigate = useNavigate();
  const deploy = useDeployAgent();
  const remove = useDeleteAgent();
  const setRunning = useSetInstanceRunning();

  const active = instances.filter((i) => i.status === 'active');
  const cost24h = instances.reduce((sum, i) => sum + i.costCents24h, 0) / 100;
  const lastRun = instances
    .map((i) => i.lastExecutionAt)
    .filter(Boolean)
    .sort()
    .pop();

  // Only offer pause when there is exactly one instance — with several, the
  // action is ambiguous and belongs on the detail page's instance list.
  const soleInstance = instances.length === 1 ? instances[0] : null;

  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-border-2">
      <Link to={`/agents/${agent.id}`} className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-fg">{agent.humanName || agent.name}</span>
          {instances.length === 0 ? (
            <Badge tone="muted" variant="soft" size="sm">Not deployed</Badge>
          ) : active.length > 0 ? (
            <Badge tone="success" variant="soft" size="sm">
              {active.length} running
            </Badge>
          ) : (
            <Badge tone="warning" variant="soft" size="sm">Paused</Badge>
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
        <span>{instances.reduce((s, i) => s + i.executionCount, 0)} runs</span>
        <span>{usd.format(cost24h)} / 24h</span>
        {lastRun && <span>last {new Date(lastRun).toLocaleDateString()}</span>}
      </div>

      <div className="mt-auto flex items-center gap-1 pt-3">
        {instances.length === 0 ? (
          <Button
            size="sm"
            leftIcon={<Rocket className="size-3.5" />}
            loading={deploy.isPending}
            onClick={() =>
              deploy.mutate(agent.id, {
                onSuccess: () => toast.success(`${agent.name} deployed`),
                onError: (e) => toast.error((e as Error).message),
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
                aria-label={soleInstance.status === 'active' ? 'Pause' : 'Resume'}
                loading={setRunning.isPending}
                onClick={() =>
                  setRunning.mutate(
                    { instanceId: soleInstance.id, running: soleInstance.status !== 'active' },
                    { onError: (e) => toast.error((e as Error).message) },
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
          loading={remove.isPending}
          onClick={() => {
            if (!confirm(`Delete "${agent.name}"? Its instances and run history go too.`)) return;
            remove.mutate(agent.id, {
              onSuccess: () => toast.success(`${agent.name} deleted`),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
}
