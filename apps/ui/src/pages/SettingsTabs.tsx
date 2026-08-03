import { Settings, Shield, Plug } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { LazyTab } from '@/components/primitives/LazyTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load tab content for code splitting
const GeneralTab = React.lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })));
const PoliciesTab = React.lazy(() => import('@/pages/Policies').then(m => ({ default: m.PoliciesPage })));
const CompressionTab = React.lazy(() => import('@/pages/Compression').then(m => ({ default: m.CompressionPage })));
const ApiReferenceTab = React.lazy(() => import('@/pages/Connect').then(m => ({ default: m.ConnectPage })));
const ClaudeCodeTab = React.lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const IntegrationsTab = React.lazy(() => import('@/pages/Integrations').then(m => ({ default: m.IntegrationsPage })));

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
              <Shield className="size-3" aria-hidden />
              Policies
            </TabsTrigger>
            <TabsTrigger value="compression">Compression</TabsTrigger>
            <TabsTrigger value="api-reference">API Reference</TabsTrigger>
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
            <TabsTrigger value="integrations">
              <Plug className="size-3" aria-hidden />
              Integrations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <LazyTab>
              <GeneralTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="policies">
            <LazyTab>
              <PoliciesTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="compression">
            <LazyTab>
              <CompressionTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="api-reference">
            <LazyTab>
              <ApiReferenceTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="claude-code">
            <LazyTab>
              <ClaudeCodeTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="integrations">
            <LazyTab>
              <IntegrationsTab />
            </LazyTab>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
