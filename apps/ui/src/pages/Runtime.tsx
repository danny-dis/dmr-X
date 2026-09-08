import { Cpu, Activity, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useHealth } from '@/lib/queries/dashboard';

export function RuntimePage() {
  const { data: health, isLoading, isError, error } = useHealth();

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Runtime" description="Live agent instances, tasks, and execution state" icon={<Cpu className="size-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent><Skeleton className="h-20" /></CardContent>
            </Card>
          ))}
        </div>
      </PageContainer>
    );
  }

  if (isError) {
    return (
      <PageContainer>
        <PageHeader title="Runtime" description="Live agent instances, tasks, and execution state" icon={<Cpu className="size-5" />} />
        <DataState variant="error" title="Failed to load runtime" description={error?.message ?? 'Unknown error'} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Runtime"
        description="Live agent instances, tasks, and execution state"
        icon={<Cpu className="size-5" />}
        actions={
          <Badge variant={health?.status === 'ok' ? 'success' : 'warning'}>
            {health?.status === 'operational' ? 'Operational' : health?.status ?? 'Unknown'}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Running Instances</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Active agent workers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Active Tasks</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">In-flight executions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Success Rate</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Instances</CardTitle></CardHeader>
        <CardContent>
          <DataState variant="empty" title="No active instances" description="Runtime instances will appear here when agents are deployed and running." />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
