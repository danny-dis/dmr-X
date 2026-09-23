import { BarChart3 } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { PageHeader, PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { ErrorState } from '@/components/primitives/ErrorState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { chartColor } from '@/lib/chartPalette';
import { formatDuration, formatNumber } from '@/lib/formatters';
import { useDashboardStats, useHealth, useRouteDecisions, useUsageHistory } from '@/lib/queries/dashboard';

export function PerformancePage() {
  const { data: health, isLoading, isError, error } = useHealth();
  // Measured sources only: usage history carries the single real `latency`
  // value per bucket (/admin/billing/usage-history); dashboard stats carry
  // the current UTC calendar-day average; route decisions carry per-request latency.
  // The server never returns P50/P95/P99, so this page must not invent them.
  const usage = useUsageHistory('hour');
  const stats = useDashboardStats();
  const decisions = useRouteDecisions(50);

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
        <ErrorState error={error} title="Failed to load performance data" description={error instanceof Error ? error.message : 'Unknown error'} />
      </PageContainer>
    );
  }

  const points = (usage.data?.points ?? []).slice(-24);
  const totalRequests = points.reduce((sum, p) => sum + (p.requests ?? 0), 0);
  const latencies = points.map((p) => p.latency ?? 0).filter((n) => n > 0);
  const avgBucketLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const decisionLatencies = (decisions.data ?? []).filter((d) => d.latency != null);
  const avgDecisionLatency =
    decisionLatencies.length > 0
      ? decisionLatencies.reduce((sum, d) => sum + (d.latency ?? 0), 0) / decisionLatencies.length
      : null;
  const avgLatency = stats.data?.avgLatencyMs ?? avgBucketLatency ?? avgDecisionLatency;
  const latencyLabel = stats.data?.avgLatencyMs != null
    ? 'Today (UTC) average end-to-end'
    : avgBucketLatency != null
      ? 'Average of reported hourly buckets'
      : avgDecisionLatency != null
        ? 'Average of recent routing decisions'
        : 'No latency data reported';
  const trend = points.map((p) => ({
    t: Number(p.t ?? p.time ?? 0),
    latency: p.latency ?? 0,
    requests: p.requests ?? 0,
  }));
  const trendData = usage.isLoading ? undefined : trend;

  return (
    <PageContainer>
      <PageHeader
        title="Performance"
        description="Latency, throughput, and routing overhead"
        icon={<BarChart3 className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/requests">Requests</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/routing">Routing</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/cost">Costs</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/health">Health</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Avg latency</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {stats.isLoading || usage.isLoading ? '—' : avgLatency != null ? formatDuration(avgLatency) : '—'}
            </div>
            <p className="text-xs text-fg-muted mt-1">{latencyLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Throughput</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {usage.isLoading || usage.isError ? '—' : formatNumber(totalRequests)}
            </div>
            <p className="text-xs text-fg-muted mt-1">Requests in window (hourly buckets)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Routing decisions</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {decisions.isLoading || decisions.isError ? '—' : formatNumber(decisions.data?.length ?? 0)}
            </div>
            <p className="text-xs text-fg-muted mt-1">
              Recent decisions{avgDecisionLatency != null ? ` · avg ${formatDuration(avgDecisionLatency)}` : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Latency Trend</CardTitle></CardHeader>
        <CardContent>
          <DataState
            data={trendData}
            isLoading={usage.isLoading}
            error={usage.error}
            onRetry={() => void usage.refetch()}
            loading={<Skeleton className="h-[220px] w-full" />}
            empty={{
              title: 'No data yet',
              description: 'Performance metrics will appear as requests are processed.',
            }}
          >
            {(series) => (
              <TimeSeriesChart
                data={series}
                xKey="t"
                height={220}
                series={[
                  { key: 'latency', name: 'Latency (ms)', color: chartColor('primary'), fillOpacity: 0.15 },
                ]}
                yFormatter={(v) => formatDuration(Number(v))}
                xFormatter={(v) =>
                  v ? new Date(v as number).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''
                }
              />
            )}
          </DataState>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
