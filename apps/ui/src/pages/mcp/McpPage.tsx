import { AlertTriangle, Plug, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { AddServerDialog } from './AddServerDialog';
import { McpNav } from './McpNav';

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
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill, type StatusKind } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import {
  useDeleteMcpServer,
  useMcpServers,
  useRefreshMcpServer,
  type McpServer,
} from '@/lib/queries/mcp';
import { cn } from '@/lib/utils';

const SERVER_STATUS: Record<McpServer['status'], { kind: StatusKind; label: string }> = {
  connected: { kind: 'online', label: 'Connected' },
  disconnected: { kind: 'offline', label: 'Disconnected' },
  disabled: { kind: 'unknown', label: 'Disabled' },
};

/**
 * Connected MCP servers.
 *
 * Status here is read from the live client registry, not from the config file.
 * The previous implementation reported a hardcoded `disconnected / 0 tools`
 * for every entry, so the page looked identical whether a server was healthy,
 * misconfigured, or had never been reachable.
 */
export function McpPage() {
  const { data, isLoading, error, refetch } = useMcpServers();
  const [addOpen, setAddOpen] = React.useState(false);

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

      <DataState
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        loading={
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => d.servers.length === 0}
        empty={{
          icon: <Plug className="size-6" />,
          title: 'No MCP servers connected',
          description:
            'Install one from the curated catalog, or add a server manually. Either way the connection is tested before it is saved.',
          action: (
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/mcp/discover">Browse catalog</Link>
              </Button>
              <Button variant="secondary" onClick={() => setAddOpen(true)}>
                Add manually
              </Button>
            </div>
          ),
        }}
      >
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2">
            {d.servers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        )}
      </DataState>

      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />
    </PageContainer>
  );
}

function ServerCard({ server }: { server: McpServer }) {
  const refresh = useRefreshMcpServer();
  const remove = useDeleteMcpServer();
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const statusInfo = SERVER_STATUS[server.status];
  const breakerOpen = server.circuitBreaker?.state === 'open';

  const handleRefresh = () =>
    refresh.mutate(server.id, {
      onSuccess: (r) =>
        toast.success(r.reconnected ? `Reconnected to ${server.name}` : `${server.name} refreshed`, {
          description: `${r.toolCount} tool${r.toolCount === 1 ? '' : 's'} available.`,
        }),
      onError: (e) => {
        const interpreted = interpretError(e);
        toast.error(`Could not refresh ${server.name}`, { description: interpreted.description });
      },
    });

  const handleRemove = () =>
    remove.mutate(server.id, {
      onSuccess: () => {
        toast.success(`${server.name} removed`, {
          description: 'Its tools are no longer available to agents.',
        });
        setConfirmRemove(false);
      },
      onError: (e) => {
        const interpreted = interpretError(e);
        toast.error(`Could not remove ${server.name}`, { description: interpreted.description });
      },
    });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-fg">{server.name}</span>
            <StatusPill status={statusInfo.kind} label={statusInfo.label} size="sm" />
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
                onClick={handleRefresh}
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
                onClick={() => setConfirmRemove(true)}
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

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its tools stop being available to agents immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} disabled={remove.isPending}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
