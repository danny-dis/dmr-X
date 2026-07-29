import { AlertTriangle, Plug, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { AddServerDialog } from './AddServerDialog';
import { McpNav } from './McpNav';

import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { toast } from '@/components/primitives/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import {
  useDeleteMcpServer,
  useMcpServers,
  useRefreshMcpServer,
  type McpServer,
} from '@/lib/queries/mcp';
import { cn } from '@/lib/utils';

/**
 * Connected MCP servers.
 *
 * Status here is read from the live client registry, not from the config file.
 * The previous implementation reported a hardcoded `disconnected / 0 tools`
 * for every entry, so the page looked identical whether a server was healthy,
 * misconfigured, or had never been reachable.
 */
export function McpPage() {
  const { data, isLoading } = useMcpServers();
  const [addOpen, setAddOpen] = React.useState(false);

  const servers = data?.servers ?? [];

  return (
    <PageContainer size="wide">
      <PageHeader
        title="MCP Servers"
        description="Upstream Model Context Protocol servers whose tools DMR-X can call."
        icon={<Plug className="size-5 text-primary" />}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link to="/mcp/discover">Browse catalog</Link>
            </Button>
            <Button leftIcon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
              Add server
            </Button>
          </div>
        }
      />

      <McpNav />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<Plug className="size-6" />}
          title="No MCP servers connected"
          description="Install one from the curated catalog, or add a server manually. Either way the connection is tested before it is saved."
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/mcp/discover">Browse catalog</Link>
              </Button>
              <Button variant="secondary" onClick={() => setAddOpen(true)}>
                Add manually
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}

      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />
    </PageContainer>
  );
}

function ServerCard({ server }: { server: McpServer }) {
  const refresh = useRefreshMcpServer();
  const remove = useDeleteMcpServer();

  const statusTone =
    server.status === 'connected' ? 'success' : server.status === 'disabled' ? 'muted' : 'danger';

  const breakerOpen = server.circuitBreaker?.state === 'open';

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-fg">{server.name}</span>
            <Badge tone={statusTone} variant="soft" size="sm">
              {server.status}
            </Badge>
            {breakerOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge tone="warning" variant="soft" size="sm" icon={<AlertTriangle className="size-3" />}>
                      Circuit open
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  Repeated failures tripped the breaker, so calls are being rejected without
                  reaching this server. It will retry automatically.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-2xs text-fg-subtle">
            {server.transport === 'stdio'
              ? `${server.command} ${(server.args ?? []).join(' ')}`
              : server.url}
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh tools"
                loading={refresh.isPending}
                onClick={() =>
                  refresh.mutate(server.id, {
                    onSuccess: (r) =>
                      toast.success(
                        r.reconnected
                          ? `Reconnected to ${server.name}`
                          : `${server.name}: ${r.toolCount} tools`,
                      ),
                    onError: (e) => toast.error(`Refresh failed: ${(e as Error).message}`),
                  })
                }
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh tools</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove server"
                loading={remove.isPending}
                onClick={() => {
                  if (!confirm(`Remove "${server.name}"? Its tools stop being available to agents.`)) return;
                  remove.mutate(server.id, {
                    onSuccess: () => toast.success(`${server.name} removed`),
                    onError: (e) => toast.error(`Remove failed: ${(e as Error).message}`),
                  });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-fg-muted">
        <span className={cn('flex items-center gap-1.5', server.toolCount === 0 && 'text-fg-subtle')}>
          <Wrench className="size-3.5" />
          {server.toolCount} tool{server.toolCount === 1 ? '' : 's'}
        </span>
        <span className="uppercase tracking-wide text-2xs text-fg-subtle">{server.transport}</span>
        {server.connectedAt && (
          <span className="text-2xs text-fg-subtle">
            since {new Date(server.connectedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {server.tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {server.tools.slice(0, 6).map((t) => (
            <span
              key={t.name}
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
            >
              {t.name}
            </span>
          ))}
          {server.tools.length > 6 && (
            <span className="px-1 py-0.5 text-2xs text-fg-subtle">
              +{server.tools.length - 6}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
