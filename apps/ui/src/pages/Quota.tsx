import * as React from 'react';
import { Gauge as GaugeIcon, TrendingUp, Users, AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Progress } from '@/components/primitives/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { QuotaGauge, QuotaProgressBar } from '@/components/domain/QuotaGauge';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, formatCompactCurrency, formatTokens, formatDuration } from '@/lib/formatters';
import type { ApiTenant, ApiQuotaState } from '@/types/api';

export function QuotaPage() {
  const tenants = useApiData<ApiTenant[]>(() => Admin.listTenants(), [], { refetchInterval: 15000 });
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedTenant && tenants.data && tenants.data.length > 0) {
      setSelectedTenant(tenants.data[0].id);
    }
  }, [tenants.data, selectedTenant]);

  const quota = useApiData<ApiQuotaState>(
    () => Admin.getQuota(selectedTenant!),
    [selectedTenant],
    { enabled: !!selectedTenant, refetchInterval: 8000 }
  );

  return (
    <PageContainer>
      <PageHeader
        title="Quota"
        description="Tenant usage limits, consumption tracking, and threshold alerts"
        icon={<GaugeIcon className="size-5" />}
        actions={
          tenants.data && tenants.data.length > 0 ? (
            <Select value={selectedTenant ?? ''} onValueChange={setSelectedTenant}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.data.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Tokens used"
          value={quota.data ? formatTokens(quota.data.tokensUsed ?? 0) : '—'}
          tone="primary"
          icon={<TrendingUp className="size-3.5" />}
          hint={quota.data ? `of ${formatTokens(quota.data.tokensLimit ?? 0, true)} limit` : undefined}
          loading={quota.isLoading}
        />
        <StatTile
          label="Requests"
          value={quota.data ? formatNumber(quota.data.requestsUsed ?? 0) : '—'}
          tone="accent"
          icon={<Users className="size-3.5" />}
          hint={quota.data ? `of ${formatNumber(quota.data.requestsLimit ?? 0, true)} limit` : undefined}
          loading={quota.isLoading}
        />
        <StatTile
          label="Cost"
          value={quota.data ? formatCompactCurrency(quota.data.costUsed ?? 0) : '—'}
          tone="warning"
          icon={<TrendingUp className="size-3.5" />}
          hint={quota.data ? `of ${formatCompactCurrency(quota.data.costLimit ?? 0)} limit` : undefined}
          loading={quota.isLoading}
        />
        <StatTile
          label="Status"
          value={
            quota.data
              ? quota.data.exceeded
                ? 'Exceeded'
                : quota.data.warnAt
                  ? 'Warning'
                  : 'Healthy'
              : '—'
          }
          tone={quota.data?.exceeded ? 'danger' : quota.data?.warnAt ? 'warning' : 'success'}
          icon={
            quota.data?.exceeded ? (
              <ShieldAlert className="size-3.5" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )
          }
          loading={quota.isLoading}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Quota usage</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Live consumption tracking</p>
          </CardHeader>
          <CardContent className="px-0">
            {quota.isLoading ? (
              <div className="flex justify-center">
                <Skeleton className="size-32 rounded-full" />
              </div>
            ) : quota.data ? (
              <QuotaGauge quota={quota.data} />
            ) : null}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Per-model breakdown</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Token consumption by model</p>
          </CardHeader>
          <CardContent className="px-0">
            {quota.data?.byModel ? (
              <div className="flex flex-col gap-3">
                {Object.entries(quota.data.byModel).map(([model, used]) => {
                  const limit = quota.data?.perModelLimit?.[model] ?? (quota.data.tokensLimit ?? 0) / 5;
                  const pct = (used / limit) * 100;
                  return (
                    <div key={model} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-fg truncate">{model}</span>
                        <span className="text-fg-muted tabular-nums">
                          {formatTokens(used)} / {formatTokens(limit, true)}
                        </span>
                      </div>
                      <Progress
                        value={Math.min(100, pct)}
                        tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'primary'}
                        size="sm"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-fg-subtle text-xs">No model breakdown available</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>All tenants quota</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {tenants.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : tenants.data && tenants.data.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {tenants.data.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2"
                  >
                    <div className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted text-xs font-semibold uppercase">
                      {t.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg truncate">{t.name}</p>
                      <p className="text-[10px] text-fg-muted">{t.tier ?? 'free'} tier</p>
                    </div>
                    <QuotaProgressBar quota={{ tokensUsed: t.tokensUsed, tokensLimit: t.tokensLimit } as ApiQuotaState} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-fg-subtle text-xs">No tenants</div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
