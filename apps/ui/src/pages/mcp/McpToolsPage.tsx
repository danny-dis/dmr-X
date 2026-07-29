import { Search, Wrench } from 'lucide-react';
import * as React from 'react';

import { McpNav } from './McpNav';

import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useMcpTools } from '@/lib/queries/mcp';

/**
 * Every tool across every connected upstream.
 *
 * Filtering happens client-side because the tool list is small (tens to low
 * hundreds) and already in memory — a round trip per keystroke would be slower
 * than the filter it replaces.
 */
export function McpToolsPage() {
  const { data, isLoading } = useMcpTools();
  const [search, setSearch] = React.useState('');

  const tools = data?.tools ?? [];

  const grouped = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q
      ? tools.filter(
          (t) =>
            t.toolName.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q) ||
            t.serverName.toLowerCase().includes(q),
        )
      : tools;

    const byServer = new Map<string, typeof matching>();
    for (const tool of matching) {
      const list = byServer.get(tool.serverName) ?? [];
      list.push(tool);
      byServer.set(tool.serverName, list);
    }
    return [...byServer.entries()];
  }, [tools, search]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="MCP Tools"
        description="Tools exposed by connected servers, callable by agents and the playground."
        icon={<Wrench className="size-5 text-primary" />}
      />

      <McpNav />

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tools…"
        prefix={<Search className="size-3.5" />}
        className="mb-4 w-72"
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : tools.length === 0 ? (
        <EmptyState
          icon={<Wrench className="size-6" />}
          title="No tools available"
          description="Connect an MCP server and its tools appear here."
        />
      ) : grouped.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">No tool matches “{search}”.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([serverName, serverTools]) => (
            <div key={serverName}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-fg">{serverName}</span>
                <Badge tone="neutral" variant="soft" size="sm">
                  {serverTools.length}
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {serverTools.map((tool) => (
                  <Card key={`${tool.serverId}:${tool.toolName}`} className="p-3">
                    <div className="font-mono text-xs text-fg">{tool.toolName}</div>
                    {tool.description && (
                      <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-fg-muted">
                        {tool.description}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
