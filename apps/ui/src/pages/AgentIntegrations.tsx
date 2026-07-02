import { Terminal, Code, Bot } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';

// Lazy-load tab content for code splitting
const ClaudeCodeTab = React.lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const CodexTab = React.lazy(() => import('@/pages/Codex').then(m => ({ default: m.CodexPage })));
const AntigravityTab = React.lazy(() => import('@/pages/Antigravity').then(m => ({ default: m.AntigravityPage })));

function TabLoader() {
  return (
    <div className="flex items-center justify-between h-[40vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

export function AgentIntegrationsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Agent Integrations"
        description="Configure AI coding agents to use DMR-X as their model provider"
        icon={<Terminal className="size-5" />}
      />

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
        </Tabs>
      </div>
    </PageContainer>
  );
}
