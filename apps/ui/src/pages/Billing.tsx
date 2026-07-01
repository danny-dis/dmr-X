import { Wallet } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';

// Lazy-load tab content for code splitting
const UsageTab = React.lazy(() => import('@/pages/Usage').then(m => ({ default: m.UsagePage })));
const CreditsTab = React.lazy(() => import('@/pages/Credits').then(m => ({ default: m.CreditsPage })));
const QuotaTab = React.lazy(() => import('@/pages/Quota').then(m => ({ default: m.QuotaPage })));
const BenchmarksTab = React.lazy(() => import('@/pages/Benchmarks').then(m => ({ default: m.BenchmarksPage })));
const MemoryTab = React.lazy(() => import('@/pages/Memory').then(m => ({ default: m.MemoryPage })));

import { Skeleton } from '@/components/primitives/Skeleton';

function TabLoader() {
  return (
    <div className="flex items-center justify-center h-[40vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

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
            <React.Suspense fallback={<TabLoader />}>
              <UsageTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="credits">
            <React.Suspense fallback={<TabLoader />}>
              <CreditsTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="quota">
            <React.Suspense fallback={<TabLoader />}>
              <QuotaTab />
            </React.Suspense>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-6">
              <React.Suspense fallback={<TabLoader />}>
                <BenchmarksTab />
              </React.Suspense>
              <React.Suspense fallback={<TabLoader />}>
                <MemoryTab />
              </React.Suspense>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
