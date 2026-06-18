import * as React from 'react';
import { Cpu, Server, Hammer as Tool, Network, Globe, Info, RefreshCw, AlertTriangle, Play, ChevronDown } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { Code } from '@/components/primitives/Code';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { apiPost } from '@/lib/api';
import type { ApiMcpStatus, ApiMcpTool } from '@/types/api';

export function MCPPage() {
  // The MCP server is a separate process. The gateway's admin endpoint
  // reports the env-derived config (matching the MCP server's defaults)
  // and probes the MCP server's /health endpoint for HTTP/SSE transports.
  // For stdio the process is per-client, so `available` is `null` and we
  // render an "unknown" pill.
  const mcp = useApiData<ApiMcpStatus>(Admin.getMcpStatus, [], { refetchInterval: 30_000 });
  const mcpTools = useApiData<ApiMcpTool[]>(Admin.listMcpTools, [], { refetchInterval: 60_000 });

  const [selectedTool, setSelectedTool] = React.useState<string>('');
  const [toolParams, setToolParams] = React.useState<string>('{}');
  const [toolResult, setToolResult] = React.useState<any>(null);
  const [toolError, setToolError] = React.useState<string | null>(null);
  const [isExecuting, setIsExecuting] = React.useState(false);

  const data = mcp.data;
  const tools = mcpTools.data;
  const transport = data?.transport ?? 'stdio';
  const host = data?.host ?? '127.0.0.1';
  const port = data?.port ?? 3100;
  const isStdio = transport === 'stdio';
  const isHttp = !isStdio;

  // Status pill: reachable (online), probed-but-down (offline), or stdio
  // / error / loading (unknown).
  const pillStatus: 'online' | 'offline' | 'unknown' =
    data?.available === true ? 'online'
    : data?.available === false ? 'offline'
    : 'unknown';
  const pillLabel =
    pillStatus === 'online' ? 'Reachable'
    : pillStatus === 'offline' ? 'Unreachable'
    : isStdio ? 'Separate process' : 'Status unknown';

  return (
    <PageContainer>
      <PageHeader
        title="MCP Server"
        description="Model Context Protocol — expose DMR-X routing to external agents"
        icon={<Cpu className="size-5" />}
      />

      <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3">
        <Info className="size-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-fg-muted leading-relaxed">
          DMR-X&apos;s MCP server is a separate process from the gateway. The
          status panel below reflects the gateway&apos;s env-derived view of
          the MCP config and probes the server&apos;s <code className="bg-surface-2 px-1 rounded text-primary">/health</code> endpoint
          when reachable. For stdio transport, the server is a per-client
          child process and cannot be probed from here — see{' '}
          <code className="bg-surface-2 px-1 rounded text-primary">
            services/mcp-server/src/
          </code>{' '}
          and the deployment guide.
        </p>
      </div>

      {mcp.isError && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
          <div className="text-xs text-fg-muted">
            <span className="font-medium text-warning">Could not load MCP status.</span>{' '}
            The endpoint may be unavailable; showing the documented defaults.
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Server Status */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="size-4 text-primary" />
              Server Status
              <button
                type="button"
                onClick={() => void mcp.refetch()}
                className="ml-auto text-fg-subtle hover:text-primary transition-colors"
                title="Refresh MCP status"
                aria-label="Refresh MCP status"
              >
                <RefreshCw className={mcp.isLoading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2">
              <span className="text-xs font-medium">Status</span>
              {mcp.isLoading && !data ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <StatusPill status={pillStatus} label={pillLabel} />
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">Transport</span>
                {mcp.isLoading && !data ? (
                  <Skeleton className="h-4 w-14" />
                ) : (
                  <Badge tone="primary" variant="secondary">{transport}</Badge>
                )}
              </div>

              {isHttp && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-muted">Endpoint</span>
                  {mcp.isLoading && !data ? (
                    <Skeleton className="h-3 w-32" />
                  ) : (
                    <span className="font-mono text-[10px]">{host}:{port}</span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">Authentication</span>
                {mcp.isLoading && !data ? (
                  <Skeleton className="h-4 w-32" />
                ) : (
                  <Badge tone={data?.hasApiKey ? 'primary' : 'muted'} size="sm">
                    {data?.hasApiKey ? 'API key set in env' : 'No API key (open)'}
                  </Badge>
                )}
              </div>
            </div>

            <div className="pt-2">
              <p className="text-[10px] text-fg-subtle">
                Configured via <code>DMRX_MCP_*</code> environment variables.
                See the deployment guide for the full list.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Configuration & Tools */}
        <Card className="lg:col-span-2">
          <Tabs defaultValue="tools">
            <div className="px-5 pt-4 border-b border-border">
<TabsList className="mb-[-1px]">
                 <TabsTrigger value="tools" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2">
                   <Tool className="size-3.5 mr-2" />
                   Available Tools
                   {data && (
                     <Badge tone="muted" size="sm" className="ml-2">{data.tools.length}</Badge>
                   )}
                 </TabsTrigger>
                 <TabsTrigger value="test" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2">
                   <Play className="size-3.5 mr-2" />
                   Test Tool
                 </TabsTrigger>
                 <TabsTrigger value="aggregation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2">
                   <Network className="size-3.5 mr-2" />
                   Aggregation
                 </TabsTrigger>
                 <TabsTrigger value="setup" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2">
                   <Globe className="size-3.5 mr-2" />
                   Setup Guide
                 </TabsTrigger>
               </TabsList>
            </div>

            <TabsContent value="tools" className="p-0">
              {mcp.isLoading && !data ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {(tools ?? data?.tools ?? []).map((tool) => (
                    <div key={tool.name} className="p-4 hover:bg-surface-1 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-mono font-semibold text-primary">{tool.name}</span>
                        <Badge tone="primary" size="sm" variant="secondary">built-in</Badge>
                      </div>
                      <p className="text-xs text-fg-muted">{tool.description}</p>
                    </div>
                  ))}
                  {(tools ?? data?.tools ?? []).length === 0 && (
                    <div className="p-8 text-center text-xs text-fg-muted">
                      No tools available. Check the MCP server configuration.
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="test" className="p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-subtle uppercase">Tool</label>
                <select
                  value={selectedTool}
                  onChange={(e) => setSelectedTool(e.target.value)}
                  className="w-full p-2 text-xs bg-surface-2 border border-border rounded"
                >
                  <option value="">Select a tool...</option>
                  {(tools ?? []).map((tool) => (
                    <option key={tool.name} value={tool.name}>{tool.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-subtle uppercase">Parameters (JSON)</label>
                <textarea
                  value={toolParams}
                  onChange={(e) => setToolParams(e.target.value)}
                  placeholder='{"prompt": "your prompt here"}'
                  className="w-full h-32 p-2 text-xs font-mono bg-surface-2 border border-border rounded resize-none"
                />
              </div>
              <button
                type="button"
                disabled={!selectedTool || isExecuting}
                onClick={async () => {
                  setIsExecuting(true);
                  setToolError(null);
                  setToolResult(null);
                  try {
                    const params = JSON.parse(toolParams);
                    const result = await Admin.executeMcpTool({ tool: selectedTool, parameters: params });
                    setToolResult(result);
                  } catch (err: any) {
                    setToolError(err.message);
                  } finally {
                    setIsExecuting(false);
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded hover:bg-primary/80 disabled:opacity-50"
              >
                {isExecuting ? 'Executing...' : 'Execute'}
              </button>
              {toolError && (
                <div className="p-3 rounded-lg bg-danger/5 border border-danger/20 text-xs text-danger">{toolError}</div>
              )}
              {toolResult && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-subtle uppercase">Result</label>
                  <pre className="p-3 text-xs font-mono bg-surface-2 rounded overflow-x-auto">
                    {JSON.stringify(toolResult, null, 2)}
                  </pre>
                </div>
              )}
            </TabsContent>

            <TabsContent value="aggregation" className="p-8 text-center">
              <Network className="size-12 text-fg-subtle mx-auto mb-4" />
              <h3 className="text-sm font-semibold mb-2">MCP Aggregator</h3>
              <p className="text-xs text-fg-muted max-w-md mx-auto mb-6">
                Connect external MCP servers to DMR-X. All tools from aggregated servers will be exposed through the same connection.
              </p>
              <div className="p-4 rounded-lg border border-dashed border-border bg-surface-1 inline-block">
                <p className="text-[10px] text-fg-subtle">
                  Aggregation is configured via <code className="bg-surface-2 px-1 rounded text-primary">DMRX_MCP_CLIENT_SERVERS</code> in your .env file.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="setup" className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Claude Desktop Configuration</h3>
                  <p className="text-xs text-fg-muted">Add this to your Claude Desktop config file to use DMR-X:</p>
                  <Code copyable language="json" className="text-[11px]">
{`{
  "mcpServers": {
    "dmr-x": {
      "command": "bun",
      "args": ["run", "/path/to/dmr-x/services/mcp-server/src/index.ts"],
      "env": {
        "DMRX_MCP_TRANSPORT": "${transport}"
${data?.hasApiKey ? '        "DMRX_MCP_API_KEY": "<your-key>"\n' : ''}      }
    }
  }
}`}
                  </Code>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Using SSE (Remote)</h3>
                  <p className="text-xs text-fg-muted">For remote clients, use the SSE transport:</p>
                  <Code copyable language="json" className="text-[11px]">
{`{
  "mcpServers": {
    "dmr-x": {
      "url": "http://${host}:${port}/sse",
      "headers": {
        "Authorization": "Bearer <your-mcp-key>"
      }
    }
  }
}`}
                  </Code>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </PageContainer>
  );
}
