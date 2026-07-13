import { Settings, Shield, Plug } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';

// Lazy-load tab content for code splitting
const GeneralTab = React.lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })));
const PoliciesTab = React.lazy(() => import('@/pages/Policies').then(m => ({ default: m.PoliciesPage })));
const CompressionTab = React.lazy(() => import('@/pages/Compression').then(m => ({ default: m.CompressionPage })));
const ApiReferenceTab = React.lazy(() => import('@/pages/Connect').then(m => ({ default: m.ConnectPage })));
const ClaudeCodeTab = React.lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const IntegrationsTab = React.lazy(() => import('@/pages/Integrations').then(m => ({ default: m.IntegrationsPage })));

function TabLoader() {
  return (
    <div className="flex items-center justify-center h-[40vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

export function SettingsTabsPage() {
  return (
    <PageContainer size="wide">
      <BackLink to="/" label="Dashboard" />
      <PageHeader
        title="Settings"
        description="Gateway configuration, policies, compression, API reference & integrations"
        icon={<Settings className="size-5" />}
      />

      <div className="mt-5">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="policies">
              <Shield className="size-3" />
              Policies
            </TabsTrigger>
            <TabsTrigger value="compression">Compression</TabsTrigger>
            <TabsTrigger value="api-reference">API Reference</TabsTrigger>
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
            <TabsTrigger value="integrations">
              <Plug className="size-3" />
              Integrations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <React.Suspense fallback={<TabLoader />}>
              <GeneralTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="policies">
            <React.Suspense fallback={<TabLoader />}>
              <PoliciesTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="compression">
            <React.Suspense fallback={<TabLoader />}>
              <CompressionTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="api-reference">
            <React.Suspense fallback={<TabLoader />}>
              <ApiReferenceTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="claude-code">
            <React.Suspense fallback={<TabLoader />}>
              <ClaudeCodeTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="integrations">
            <React.Suspense fallback={<TabLoader />}>
              <IntegrationsTab />
            </React.Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
