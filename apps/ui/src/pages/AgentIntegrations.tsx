import { Terminal, Code, Bot, AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { LazyTab } from '@/components/primitives/LazyTab';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { useAgentIntegrationConfig, type AgentIntegrationConfig } from '@/lib/queries/integrations';
import { cn } from '@/lib/utils';

// Lazy-load tab content for code splitting
const ClaudeCodeTab = React.lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const CodexTab = React.lazy(() => import('@/pages/Codex').then(m => ({ default: m.CodexPage })));
const AntigravityTab = React.lazy(() => import('@/pages/Antigravity').then(m => ({ default: m.AntigravityPage })));
const OpenCodeTab = React.lazy(() => import('@/pages/OpenCode').then(m => ({ default: m.OpenCodePage })));

const TOOL_META: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  'claude-code': { label: 'Claude Code', description: 'Anthropic CLI', icon: <Terminal className="size-4" /> },
  codex: { label: 'Codex', description: 'OpenAI CLI', icon: <Code className="size-4" /> },
  antigravity: { label: 'Antigravity', description: 'Google CLI', icon: <Bot className="size-4" /> },
  opencode: { label: 'OpenCode', description: 'OpenCode CLI', icon: <Terminal className="size-4" /> },
};

function isConfigured(config: AgentIntegrationConfig): Record<string, boolean> {
  return {
    'claude-code': !!(
      config.claudeCode?.bigModelId ||
      config.claudeCode?.mediumModelId ||
      config.claudeCode?.smallModelId
    ),
    codex: !!(config.codex?.modelId && config.codex?.providerId),
    // Antigravity (agy) shares the "gemini-cli" integration config — it
    // speaks Google's Cloud Code protocol, same as the Gemini CLI.
    antigravity: !!config.geminiCli?.isEnabled,
    opencode: !!(config.opencode?.modelId && config.opencode?.providerId),
  };
}

export function AgentIntegrationsPage() {
  const config = useAgentIntegrationConfig();

  return (
    <PageContainer>
      <PageHeader
        title="Agent Integrations"
        description="Configure AI coding agents to use DMR-X as their model provider"
        icon={<Terminal className="size-5" />}
      />

      <div className="mt-5">
        <DataState
          data={config.data}
          isLoading={config.isLoading}
          error={config.error}
          onRetry={config.refetch}
          loading={
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(TOOL_META).map(([tool, meta]) => (
                <Card key={tool} padding="md">
                  <CardContent className="px-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-surface-3 text-fg-muted">
                          {meta.icon}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-fg">{meta.label}</p>
                          <p className="text-[10px] text-fg-muted">{meta.description}</p>
                        </div>
                      </div>
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          }
        >
          {(data) => {
            const configured = isConfigured(data);
            const configuredCount = Object.values(configured).filter(Boolean).length;
            const totalCount = Object.keys(TOOL_META).length;

            return (
              <>
                {/* Status Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(TOOL_META).map(([tool, meta]) => (
                    <Card key={tool} padding="md">
                      <CardContent className="px-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className={cn(
                                'flex size-8 items-center justify-center rounded-lg',
                                configured[tool] ? 'bg-success/10 text-success' : 'bg-surface-3 text-fg-muted',
                              )}
                            >
                              {meta.icon}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-fg">{meta.label}</p>
                              <p className="text-[10px] text-fg-muted">{meta.description}</p>
                            </div>
                          </div>
                          <StatusPill
                            status={configured[tool] ? 'healthy' : 'unknown'}
                            label={configured[tool] ? 'Ready' : 'Not set up'}
                            size="sm"
                            pulse={false}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Summary */}
                {configuredCount < totalCount && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
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
              </>
            );
          }}
        </DataState>
      </div>

      {/* Tabs */}
      <div className="mt-5">
        <Tabs defaultValue="claude-code">
          <TabsList>
            <TabsTrigger value="claude-code">
              <Terminal className="size-3" aria-hidden />
              Claude Code
            </TabsTrigger>
            <TabsTrigger value="codex">
              <Code className="size-3" aria-hidden />
              Codex
            </TabsTrigger>
            <TabsTrigger value="antigravity">
              <Bot className="size-3" aria-hidden />
              Antigravity
            </TabsTrigger>
            <TabsTrigger value="opencode">
              <Terminal className="size-3" aria-hidden />
              OpenCode
            </TabsTrigger>
          </TabsList>

          <TabsContent value="claude-code">
            <LazyTab>
              <ClaudeCodeTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="codex">
            <LazyTab>
              <CodexTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="antigravity">
            <LazyTab>
              <AntigravityTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="opencode">
            <LazyTab>
              <OpenCodeTab />
            </LazyTab>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
