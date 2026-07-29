import { Terminal, Code, Bot, Check, AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent } from '@/components/primitives/Card';
import { PageHeader, PageContainer } from '@/components/layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';

// Lazy-load tab content for code splitting
const ClaudeCodeTab = React.lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const CodexTab = React.lazy(() => import('@/pages/Codex').then(m => ({ default: m.CodexPage })));
const AntigravityTab = React.lazy(() => import('@/pages/Antigravity').then(m => ({ default: m.AntigravityPage })));
const OpenCodeTab = React.lazy(() => import('@/pages/OpenCode').then(m => ({ default: m.OpenCodePage })));

function TabLoader() {
  return (
    <div className="flex items-center justify-between h-[40vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

interface IntegrationStatus {
  configured: boolean;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export function AgentIntegrationsPage() {
  const [statuses, setStatuses] = React.useState<Record<string, IntegrationStatus>>({
    'claude-code': { configured: false, label: 'Claude Code', description: 'Anthropic CLI', icon: <Terminal className="size-4" /> },
    'codex': { configured: false, label: 'Codex', description: 'OpenAI CLI', icon: <Code className="size-4" /> },
    'antigravity': { configured: false, label: 'Antigravity', description: 'Google CLI', icon: <Bot className="size-4" /> },
    'opencode': { configured: false, label: 'OpenCode', description: 'OpenCode CLI', icon: <Terminal className="size-4" /> },
  });
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    Admin.getAgentIntegrationConfig()
      .then((config) => {
        setStatuses((prev) => ({
          ...prev,
          'claude-code': {
            ...prev['claude-code'],
            configured: !!(
              config.claudeCode?.bigModelId ||
              config.claudeCode?.mediumModelId ||
              config.claudeCode?.smallModelId
            ),
          },
          'codex': {
            ...prev['codex'],
            configured: !!(config.codex?.modelId && config.codex?.providerId),
          },
          'antigravity': {
            ...prev['antigravity'],
            // Antigravity (agy) shares the "gemini-cli" integration config —
            // it speaks Google's Cloud Code protocol, same as the Gemini CLI.
            configured: !!(config.geminiCli?.isEnabled),
          },
          'opencode': {
            ...prev['opencode'],
            configured: !!(config.opencode?.modelId && config.opencode?.providerId),
          },
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const configuredCount = Object.values(statuses).filter((s) => s.configured).length;
  const totalCount = Object.keys(statuses).length;

  return (
    <PageContainer>
      <PageHeader
        title="Agent Integrations"
        description="Configure AI coding agents to use DMR-X as their model provider"
        icon={<Terminal className="size-5" />}
      />

      {/* Status Overview */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(statuses).map(([tool, status]) => (
          <Card key={tool} padding="md">
            <CardContent className="px-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg',
                      status.configured ? 'bg-success/10 text-success' : 'bg-surface-3 text-fg-muted',
                    )}
                  >
                    {status.icon}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-fg">{status.label}</p>
                    <p className="text-[10px] text-fg-muted">{status.description}</p>
                  </div>
                </div>
                {loading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <Badge tone={status.configured ? 'success' : 'muted'} size="sm">
                    {status.configured ? (
                      <>
                        <Check className="size-2.5 mr-0.5" />
                        Ready
                      </>
                    ) : (
                      'Not set up'
                    )}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary */}
      {!loading && configuredCount < totalCount && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-fg leading-relaxed">
              <p className="font-medium">
                {configuredCount === 0
                  ? 'No integrations configured yet'
                  : `${configuredCount} of ${totalCount} integrations configured`}
              </p>
              <p className="text-fg-muted">
                Click on a tab below to configure each integration. DMR-X will act as the inference
                server for each tool, routing requests through your configured providers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-5">
        <Tabs defaultValue="claude-code">
          <TabsList>
            <TabsTrigger value="claude-code">
              <Terminal className="size-3" />
              Claude Code
            </TabsTrigger>
            <TabsTrigger value="codex">
              <Code className="size-3" />
              Codex
            </TabsTrigger>
            <TabsTrigger value="antigravity">
              <Bot className="size-3" />
              Antigravity
            </TabsTrigger>
            <TabsTrigger value="opencode">
              <Terminal className="size-3" />
              OpenCode
            </TabsTrigger>
          </TabsList>

          <TabsContent value="claude-code">
            <React.Suspense fallback={<TabLoader />}>
              <ClaudeCodeTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="codex">
            <React.Suspense fallback={<TabLoader />}>
              <CodexTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="antigravity">
            <React.Suspense fallback={<TabLoader />}>
              <AntigravityTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="opencode">
            <React.Suspense fallback={<TabLoader />}>
              <OpenCodeTab />
            </React.Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
