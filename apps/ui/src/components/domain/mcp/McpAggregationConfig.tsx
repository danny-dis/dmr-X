import { Network, Plus, Trash2, Server } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { useAddAggregatedServer, useAggregatedServers, useRemoveAggregatedServer } from '@/lib/queries/mcp';

export function McpAggregationConfig() {
  const serversData = useAggregatedServers();
  const addServer = useAddAggregatedServer();
  const removeServer = useRemoveAggregatedServer();
  const saving = addServer.isPending;
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Add server form
  const [serverId, setServerId] = React.useState('');
  const [serverName, setServerName] = React.useState('');
  const [serverTransport, setServerTransport] = React.useState('sse');
  const [serverUrl, setServerUrl] = React.useState('');
  const [serverCommand, setServerCommand] = React.useState('');
  const [serverArgs, setServerArgs] = React.useState('');

  const servers = serversData.data ?? [];

  const resetForm = () => {
    setServerId('');
    setServerName('');
    setServerTransport('sse');
    setServerUrl('');
    setServerCommand('');
    setServerArgs('');
  };

  const handleAdd = async () => {
    if (!serverId.trim() || !serverName.trim()) {
      toast.error('ID and Name are required');
      return;
    }
    try {
      await addServer.mutateAsync({
        id: serverId,
        name: serverName,
        transport: serverTransport,
        url: serverUrl || undefined,
        command: serverCommand || undefined,
        args: serverArgs ? serverArgs.split(',').map((s) => s.trim()) : undefined,
      });
      toast.success('Server added');
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      toast.error('Failed to add server', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeServer.mutateAsync(id);
      toast.success('Server removed');
    } catch (err) {
      toast.error('Failed to remove server', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  if (serversData.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Network className="size-4 text-primary" />
            MCP Aggregator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg-muted">
            Connect external MCP servers to DMR-X. All tools from aggregated servers will be exposed through the same MCP connection with namespaced tool names.
          </p>
          <p className="text-[10px] text-fg-subtle">
            Tool names are namespaced as <code className="bg-surface-2 px-1 rounded text-primary">{'<serverId>__<toolName>'}</code> to avoid collisions.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs flex items-center gap-2">
            <Server className="size-3.5 text-primary" />
            Aggregated Servers
            <Badge tone="muted" size="sm" className="ml-auto">{servers.length}</Badge>
            <Button size="icon-sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
              <Plus className="size-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <div className="text-center py-6">
              <Network className="size-8 text-fg-subtle mx-auto mb-2" />
              <p className="text-xs text-fg-muted">No aggregated servers configured</p>
              <p className="text-[10px] text-fg-subtle mt-1">Add external MCP servers to aggregate their tools</p>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg"
                >
                  <Server className="size-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold">{server.name}</span>
                      <Badge tone="primary" size="sm" variant="secondary">{server.transport}</Badge>
                      <StatusPill
                        status={server.status === 'connected' ? 'online' : server.status === 'error' ? 'offline' : 'unknown'}
                        label={server.status ?? 'unknown'}
                      />
                    </div>
                    {server.url && (
                      <p className="text-[10px] font-mono text-fg-muted truncate">{server.url}</p>
                    )}
                    {server.command && (
                      <p className="text-[10px] font-mono text-fg-muted">
                        {server.command} {server.args?.join(' ')}
                      </p>
                    )}
                    {server.toolCount !== undefined && (
                      <p className="text-[10px] text-fg-subtle">{server.toolCount} tools</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(server.id)}
                    className="text-fg-subtle hover:text-danger transition-colors shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="p-3 rounded-lg border border-dashed border-border bg-surface-1">
        <p className="text-[10px] text-fg-subtle">
          You can also configure aggregated servers via <code className="bg-surface-2 px-1 rounded text-primary">DMRX_MCP_CLIENT_SERVERS</code> in your .env file.
        </p>
      </div>

      {/* Add Server Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Aggregated MCP Server</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium">Server ID</label>
                <Input
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  placeholder="e.g., filesystem"
                />
                <p className="text-[10px] text-fg-subtle">Used as tool name prefix</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Display Name</label>
                <Input
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder="e.g., Filesystem MCP"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Transport</label>
              <select
                value={serverTransport}
                onChange={(e) => setServerTransport(e.target.value)}
                className="w-full p-2 text-xs bg-surface-2 border border-border rounded"
              >
                <option value="sse">SSE (Server-Sent Events)</option>
                <option value="stdio">Stdio (Child Process)</option>
                <option value="http">HTTP</option>
              </select>
            </div>

            {serverTransport !== 'stdio' && (
              <div className="space-y-2">
                <label className="text-xs font-medium">URL</label>
                <Input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:3001/sse"
                />
              </div>
            )}

            {serverTransport === 'stdio' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Command</label>
                  <Input
                    value={serverCommand}
                    onChange={(e) => setServerCommand(e.target.value)}
                    placeholder="npx"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Arguments (comma-separated)</label>
                  <Input
                    value={serverArgs}
                    onChange={(e) => setServerArgs(e.target.value)}
                    placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} loading={saving}>
                Add Server
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
