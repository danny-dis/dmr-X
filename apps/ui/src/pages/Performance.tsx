import { BarChart3, Clock, Activity, TrendingUp } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useHealth } from '@/lib/queries/dashboard';

export function PerformancePage() {
  const { data: health, isLoading, isError, error } = useHealth();

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Performance" description="Latency, throughput, and routing overhead" icon={<BarChart3 className="size-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent><Skeleton className="h-20" /></CardContent></Card>
          ))}
        </div>
      </PageContainer>
    );
  }

  if (isError) {
    return (
      <PageContainer>
        <PageHeader title="Performance" description="Latency, throughput, and routing overhead" icon={<BarChart3 className="size-5" />} />
        <DataState variant="error" title="Failed to load performance data" description={error?.message ?? 'Unknown error'} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Performance" description="Latency, throughput, and routing overhead" icon={<BarChart3 className="size-5" />} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">P50 Latency</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Median response time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">P95 Latency</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">95th percentile</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Throughput</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Requests per second</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Latency Trend</CardTitle></CardHeader>
        <CardContent>
          <DataState variant="empty" title="No data yet" description="Performance metrics will appear as requests are processed." />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
