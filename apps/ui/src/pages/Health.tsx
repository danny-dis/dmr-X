import { HeartPulse, CheckCircle2, XCircle, AlertTriangle, Server, Cpu, Activity } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useHealth } from '@/lib/queries/dashboard';

export function HealthPage() {
  const { data: health, isLoading, isError, error } = useHealth();

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Health" description="Gateway, provider, and system health" icon={<HeartPulse className="size-5" />} />
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
        <PageHeader title="Health" description="Gateway, provider, and system health" icon={<HeartPulse className="size-5" />} />
        <DataState variant="error" title="Failed to load health" description={error?.message ?? 'Unknown error'} />
      </PageContainer>
    );
  }

  const statusColor = health?.status === 'ok' || health?.status === 'operational'
    ? 'success'
    : health?.status === 'degraded' ? 'warning' : 'danger';

  return (
    <PageContainer>
      <PageHeader
        title="Health"
        description="Gateway, provider, and system health"
        icon={<HeartPulse className="size-5" />}
        actions={<Badge variant={statusColor}>{health?.status ?? 'Unknown'}</Badge>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Gateway</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {statusColor === 'success' ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-danger" />}
              <span className="text-lg font-semibold">{health?.status === 'operational' ? 'Healthy' : health?.status ?? 'Unknown'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Providers</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Active / Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Uptime</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-fg-muted mt-1">Last 30 days</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Component Status</CardTitle></CardHeader>
        <CardContent>
          <DataState variant="empty" title="All systems nominal" description="Detailed component health will appear here." />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
