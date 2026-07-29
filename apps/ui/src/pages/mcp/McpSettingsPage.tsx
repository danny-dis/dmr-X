import { AlertTriangle, Settings2 } from 'lucide-react';
import { lazy, Suspense } from 'react';

import { McpNav } from './McpNav';

import { PageContainer, PageHeader } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Code } from '@/components/primitives/Code';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { useUrlState } from '@/hooks/useUrlState';
import { useMcpStatus } from '@/lib/queries/mcp';

const McpToolSearchConfig = lazy(() =>
  import('@/components/domain/mcp/McpToolSearchConfig').then((m) => ({ default: m.McpToolSearchConfig })),
);
const McpGuardrailsConfig = lazy(() =>
  import('@/components/domain/mcp/McpGuardrailsConfig').then((m) => ({ default: m.McpGuardrailsConfig })),
);
const McpAuditConfig = lazy(() =>
  import('@/components/domain/mcp/McpAuditConfig').then((m) => ({ default: m.McpAuditConfig })),
);
const McpRbacPolicies = lazy(() =>
  import('@/components/domain/mcp/McpRbacPolicies').then((m) => ({ default: m.McpRbacPolicies })),
);
const McpFederationConfig = lazy(() =>
  import('@/components/domain/mcp/McpFederationConfig').then((m) => ({ default: m.McpFederationConfig })),
);

/**
 * MCP sidecar configuration.
 *
 * These panels write to `dmrx-mcp.config.json`, which the sidecar reads at
 * boot — so a saved change is not live until it restarts. That is stated
 * persistently at the top rather than left for the operator to discover by
 * watching nothing happen.
 */
export function McpSettingsPage() {
  const [tab, setTab] = useUrlState('tab', 'search');
  const status = useMcpStatus();

  return (
    <PageContainer size="wide">
      <PageHeader
        title="MCP Settings"
        description="Tool search, guardrails, audit and access control for the built-in MCP server."
        icon={<Settings2 className="size-5 text-primary" />}
      />

      <McpNav />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="text-xs leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Changes apply on sidecar restart.</span> These
          settings are written to <code className="font-mono">dmrx-mcp.config.json</code>, which the
          MCP server reads when it starts. Restart the gateway (or the sidecar) for them to take
          effect.
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Server</CardTitle>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Detail label="Transport" value={status.data?.transport ?? '—'} />
              <Detail label="Host" value={status.data?.host ?? '—'} />
              <Detail label="Port" value={String(status.data?.port ?? '—')} />
              <Detail label="Tools" value={String(status.data?.tools?.length ?? 0)} />
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="search">Tool search</TabsTrigger>
          <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="rbac">RBAC</TabsTrigger>
          <TabsTrigger value="federation">Federation</TabsTrigger>
          <TabsTrigger value="setup">Client setup</TabsTrigger>
        </TabsList>

        <Suspense fallback={<Skeleton className="mt-4 h-48 w-full" />}>
          <TabsContent value="search"><McpToolSearchConfig /></TabsContent>
          <TabsContent value="guardrails"><McpGuardrailsConfig /></TabsContent>
          <TabsContent value="audit"><McpAuditConfig /></TabsContent>
          <TabsContent value="rbac"><McpRbacPolicies /></TabsContent>
          <TabsContent value="federation"><McpFederationConfig /></TabsContent>
        </Suspense>

        <TabsContent value="setup">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Connect a client</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium text-fg">Claude Desktop</div>
                <Code
                  language="json"
                  copyable
                >{`{
  "mcpServers": {
    "dmr-x": {
      "command": "npx",
      "args": ["-y", "@dmr-x/mcp-server"],
      "env": { "DMRX_BASE_URL": "http://localhost:3000" }
    }
  }
}`}</Code>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-fg">HTTP / SSE</div>
                <Code copyable>{`http://${status.data?.host ?? '127.0.0.1'}:${status.data?.port ?? 3100}/sse`}</Code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-fg">{value}</div>
    </div>
  );
}
