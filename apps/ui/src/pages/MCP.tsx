import * as React from 'react';
import { Cpu, Server, Tool, Shield, Play, RotateCcw, Network, Globe, Lock } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Code } from '@/components/primitives/Code';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';

export function MCPPage() {
  const settings = useApiData(() => Admin.getSettings(), []);
  const health = useApiData(() => Admin.health(), []);
  
  // These would ideally come from a dedicated MCP API, but for now we'll 
  // extract what we can from settings and status.
  const mcpTransport = (settings.data?.DMRX_MCP_TRANSPORT as string) || 'stdio';
  const mcpPort = (settings.data?.DMRX_MCP_PORT as string) || '3100';
  const mcpHost = (settings.data?.DMRX_MCP_HOST as string) || '127.0.0.1';
  const hasMcpKey = !!settings.data?.DMRX_MCP_API_KEY;

  const mcpStatus = health.data?.checks?.find(c => c.name === 'mcp') || { status: 'ok' };

  return (
    <PageContainer>
      <PageHeader
        title="MCP Server"
        description="Model Context Protocol — expose DMR-X routing to external agents"
        icon={<Cpu className="size-5" />}
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Server Status */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="size-4 text-primary" />
              Server Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2">
              <span className="text-xs font-medium">Status</span>
              <StatusPill status={mcpStatus.status === 'ok' ? 'online' : 'offline'} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">Transport</span>
                <Badge tone="primary" variant="secondary">{mcpTransport}</Badge>
              </div>
              
              {mcpTransport !== 'stdio' && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">Endpoint</span>
                    <span className="font-mono text-[10px]">{mcpHost}:{mcpPort}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">Authentication</span>
                    <div className="flex items-center gap-1.5">
                      {hasMcpKey ? (
                        <Badge tone="success" size="sm" className="flex items-center gap-1">
                          <Lock className="size-2.5" /> Enabled
                        </Badge>
                      ) : (
                        <Badge tone="warning" size="sm">Disabled</Badge>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pt-2">
              <p className="text-[10px] text-fg-muted italic">
                The MCP server allows clients like Claude Desktop or Cursor to use DMR-X as a tool provider.
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
              <div className="divide-y divide-border">
                {[
                  { name: 'dmrx_chat', desc: 'Chat completions with full routing capabilities' },
                  { name: 'dmrx_generate_image', desc: 'DALL-E, Stable Diffusion, and Flux image generation' },
                  { name: 'dmrx_embed', desc: 'Generate vector embeddings from text' },
                  { name: 'dmrx_models', desc: 'List all available models across providers' },
                  { name: 'dmrx_status', desc: 'Get health and metrics for the DMR-X platform' }
                ].map((tool) => (
                  <div key={tool.name} className="p-4 hover:bg-surface-1 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-mono font-semibold text-primary">{tool.name}</span>
                      <Badge tone="primary" size="sm" variant="secondary">built-in</Badge>
                    </div>
                    <p className="text-xs text-fg-muted">{tool.desc}</p>
                  </div>
                ))}
              </div>
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
      "args": ["run", "${settings.data?.DMRX_ROOT || '/path/to/dmr-x'}/services/mcp-server/src/index.ts"],
      "env": {
        "DMRX_MCP_TRANSPORT": "stdio"
      }
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
      "url": "http://${mcpHost}:${mcpPort}/sse",
      "headers": {
        "Authorization": "Bearer your-mcp-key"
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
