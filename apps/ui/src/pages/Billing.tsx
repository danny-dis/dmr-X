import { Wallet } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { LazyTab } from '@/components/primitives/LazyTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load tab content for code splitting
const UsageTab = React.lazy(() => import('@/pages/Usage').then(m => ({ default: m.UsagePage })));
const CreditsTab = React.lazy(() => import('@/pages/Credits').then(m => ({ default: m.CreditsPage })));
const QuotaTab = React.lazy(() => import('@/pages/Quota').then(m => ({ default: m.QuotaPage })));
const BenchmarksTab = React.lazy(() => import('@/pages/Benchmarks').then(m => ({ default: m.BenchmarksPage })));
const MemoryTab = React.lazy(() => import('@/pages/Memory').then(m => ({ default: m.MemoryPage })));

export function BillingPage() {
  return (
    <PageContainer size="wide">
      <BackLink to="/" label="Dashboard" />
      <PageHeader
        title="Billing"
        description="Costs, credits, quotas, and usage history"
        icon={<Wallet className="size-5" />}
      />

      <div className="mt-5">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="credits">Credits</TabsTrigger>
            <TabsTrigger value="quota">Quota</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <LazyTab>
              <UsageTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="credits">
            <LazyTab>
              <CreditsTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="quota">
            <LazyTab>
              <QuotaTab />
            </LazyTab>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-6">
              <LazyTab>
                <BenchmarksTab />
              </LazyTab>
              <LazyTab>
                <MemoryTab />
              </LazyTab>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
