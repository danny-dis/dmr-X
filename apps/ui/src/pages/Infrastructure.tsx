import { Cpu } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';

// Lazy-load tab content for code splitting
const McpTab = React.lazy(() => import('@/pages/MCP').then(m => ({ default: m.MCPPage })));
const ToolsTab = React.lazy(() => import('@/pages/Tools').then(m => ({ default: m.ToolsPage })));
const WorkersTab = React.lazy(() => import('@/pages/Workers').then(m => ({ default: m.WorkersPage })));
const FederationTab = React.lazy(() => import('@/pages/Federation').then(m => ({ default: m.FederationPage })));
const SandboxTab = React.lazy(() => import('@/pages/Sandbox').then(m => ({ default: m.SandboxPage })));

function TabLoader() {
  return (
    <div className="flex items-center justify-center h-[40vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

export function InfrastructurePage() {
  return (
    <PageContainer size="wide">
      <PageHeader
        title="Infrastructure"
        description="MCP server, tool execution, workers, federation & sandbox"
        icon={<Cpu className="size-5" />}
      />

      <div className="mt-5">
        <Tabs defaultValue="mcp">
          <TabsList>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="workers">Workers</TabsTrigger>
            <TabsTrigger value="federation">Federation</TabsTrigger>
            <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          </TabsList>

          <TabsContent value="mcp">
            <React.Suspense fallback={<TabLoader />}>
              <McpTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="tools">
            <React.Suspense fallback={<TabLoader />}>
              <ToolsTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="workers">
            <React.Suspense fallback={<TabLoader />}>
              <WorkersTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="federation">
            <React.Suspense fallback={<TabLoader />}>
              <FederationTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="sandbox">
            <React.Suspense fallback={<TabLoader />}>
              <SandboxTab />
            </React.Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
