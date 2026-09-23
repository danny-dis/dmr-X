import { HeartPulse, CheckCircle2, XCircle } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { ErrorState } from '@/components/primitives/ErrorState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useHealth } from '@/lib/queries/dashboard';
import { useProviders } from '@/lib/queries/providers';

export function HealthPage() {
  const { data: health, isLoading, isError, error } = useHealth();
  // Measured only: provider counts come from the real provider list.
  // GET /health returns status alone (no uptime/checks), so version, uptime
  // and component checks render only when the backend actually provides them.
  const providers = useProviders();

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
        <ErrorState error={error} title="Failed to load health" description={error instanceof Error ? error.message : 'Unknown error'} />
      </PageContainer>
    );
  }

  const statusColor = health?.status === 'ok' || health?.status === 'operational'
    ? 'success'
    : health?.status === 'degraded' ? 'warning' : 'danger';

  const providerList = providers.data ?? [];
  const activeProviders = providerList.filter((p) => p.status === 'healthy' && p.tier != null && p.tier !== 'inactive').length;
  const checks = health?.checks ?? [];
  const uptime = health?.uptime;
  const version = health?.version;

  return (
    <PageContainer>
      <PageHeader
        title="Health"
        description="Gateway, provider, and system health"
        icon={<HeartPulse className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusColor}>{health?.status ?? 'Unknown'}</Badge>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/requests">Requests</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/performance">Performance</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/cost">Costs</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/providers">Providers</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Gateway</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {statusColor === 'success' ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-danger" />}
              <span className="text-lg font-semibold">{health?.status === 'operational' ? 'Healthy' : health?.status ?? 'Unknown'}</span>
            </div>
            {version && <p className="text-xs text-fg-muted mt-1">Version {version}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Providers</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {providers.isLoading || providers.isError ? '—' : `${activeProviders} / ${providerList.length}`}
            </div>
            <p className="text-xs text-fg-muted mt-1">Healthy configured / Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Uptime</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {uptime != null ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : '—'}
            </div>
            <p className="text-xs text-fg-muted mt-1">
              {uptime != null ? 'Since last restart' : 'Not reported by gateway'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Component Status</CardTitle></CardHeader>
        <CardContent>
          {checks.length > 0 ? (
            <ul className="divide-y divide-border">
              {checks.map((c) => (
                <li key={c.name} className="flex items-center gap-3 py-2">
                  {c.status === 'ok'
                    ? <CheckCircle2 className="size-4 text-success" />
                    : <XCircle className="size-4 text-danger" />}
                  <span className="text-sm text-fg">{c.name}</span>
                  {c.message && <span className="text-xs text-fg-muted truncate">{c.message}</span>}
                  <Badge
                    tone={c.status === 'ok' ? 'success' : 'danger'}
                    variant="soft"
                    size="sm"
                    className="ml-auto"
                  >
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Component checks unavailable" description="The gateway did not report component-level health checks." />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
