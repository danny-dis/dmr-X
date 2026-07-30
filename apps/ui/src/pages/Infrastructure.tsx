import { Cpu } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { LazyTab } from '@/components/primitives/LazyTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load tab content for code splitting
const ToolsTab = React.lazy(() => import('@/pages/Tools').then(m => ({ default: m.ToolsPage })));
const WorkersTab = React.lazy(() => import('@/pages/Workers').then(m => ({ default: m.WorkersPage })));
const FederationTab = React.lazy(() => import('@/pages/Federation').then(m => ({ default: m.FederationPage })));
const SandboxTab = React.lazy(() => import('@/pages/Sandbox').then(m => ({ default: m.SandboxPage })));

export function InfrastructurePage() {
  return (
    <PageContainer size="wide">
      <BackLink to="/" label="Dashboard" />
      <PageHeader
        title="Infrastructure"
        description="MCP server, tool execution, workers, federation & sandbox"
        icon={<Cpu className="size-5" />}
      />

      <div className="mt-5">
        <Tabs defaultValue="tools">
          <TabsList>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="workers">Workers</TabsTrigger>
            <TabsTrigger value="federation">Federation</TabsTrigger>
            <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          </TabsList>

          <TabsContent value="tools">
            <LazyTab>
              <ToolsTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="workers">
            <LazyTab>
              <WorkersTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="federation">
            <LazyTab>
              <FederationTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="sandbox">
            <LazyTab>
              <SandboxTab />
            </LazyTab>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
