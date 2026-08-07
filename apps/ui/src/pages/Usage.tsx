import { Wallet, TrendingUp, DollarSign, Users, Sparkles, Receipt } from 'lucide-react';
import * as React from 'react';

import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { WaterfallChart } from '@/components/charts/WaterfallChart';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/primitives/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { chartColor } from '@/lib/chartPalette';
import { formatCurrency, formatNumber, formatTokens } from '@/lib/formatters';
import { useUsageHistory } from '@/lib/queries/dashboard';
import { useBilling, useTenants } from '@/lib/queries/tenants';
import type { ApiBillingSummary } from '@/types/api';

export function UsagePage() {
  const [period, setPeriod] = React.useState<'day' | 'week' | 'month'>('day');
  const billing = useBilling(period, { refetchInterval: 30000 });
  const usage = useUsageHistory(period === 'day' ? 'hour' : 'day', { refetchInterval: 15000 });
  const tenants = useTenants({ refetchInterval: 30000 });
  const [selectedInvoice, setSelectedInvoice] = React.useState<NonNullable<ApiBillingSummary['invoices']>[number] | null>(null);

  const series = (usage.data?.points ?? []).map((p) => ({
    t: p.t ?? 0,
    cost: p.cost ?? 0,
    tokens: (p.tokens ?? 0) / 1000,
  }));

  const tenantCosts = (tenants.data ?? [])
    .map((t) => ({ label: t.name, value: t.cost_used ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Usage & Cost"
        description="Cost tracking, billing breakdown, and per-tenant attribution"
        icon={<Wallet className="size-5" />}
        actions={
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger size="sm" className="w-32" aria-label="Time period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Last 24h</SelectItem>
              <SelectItem value="week">Last 7d</SelectItem>
              <SelectItem value="month">Last 30d</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Total spend"
          value={billing.data ? formatCurrency(billing.data.totalCost ?? 0) : '—'}
          tone="warning"
          icon={<DollarSign className="size-3.5" />}
          delta={billing.data?.costDelta ?? 0}
          deltaLabel="vs prev period"
          loading={billing.isLoading}
        />
        <StatTile
          label="Tokens"
          value={billing.data ? formatTokens(billing.data.totalTokens ?? 0, true) : '—'}
          tone="primary"
          icon={<Sparkles className="size-3.5" />}
          loading={billing.isLoading}
        />
        <StatTile
          label="Requests"
          value={billing.data ? formatNumber(billing.data.totalRequests ?? 0) : '—'}
          tone="accent"
          icon={<TrendingUp className="size-3.5" />}
          loading={billing.isLoading}
        />
        <StatTile
          label="Avg cost / req"
          value={billing.data ? formatCurrency(billing.data.avgCostPerRequest ?? 0) : '—'}
          tone="success"
          icon={<Users className="size-3.5" />}
          loading={billing.isLoading}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Cost over time</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Total spend by interval</p>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={usage.data?.points}
              isLoading={usage.isLoading}
              error={usage.error}
              onRetry={usage.refetch}
              loading={<Skeleton className="h-[220px] w-full" />}
              isEmpty={() => series.length === 0}
              empty={{
                icon: <TrendingUp className="size-8" />,
                title: 'No usage data yet',
                description: 'Cost history will appear once requests have been routed in this period.',
              }}
            >
              {() => (
                <TimeSeriesChart
                  data={series}
                  xKey="t"
                  height={220}
                  series={[
                    { key: 'cost', name: 'Cost', color: chartColor('warning') },
                  ]}
                  yFormatter={(v) => formatCurrency(v)}
                  xFormatter={(v) => new Date(v as number).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Cost waterfall</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">How total spend was reached</p>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={billing.data}
              isLoading={billing.isLoading}
              error={billing.error}
              onRetry={billing.refetch}
              loading={<Skeleton className="h-[220px] w-full" />}
              isEmpty={(d) =>
                (d.byCategory?.llm ?? 0) +
                  (d.byCategory?.diffusion ?? 0) +
                  (d.byCategory?.audio ?? 0) +
                  (d.byCategory?.embedding ?? 0) ===
                0
              }
              empty={{
                icon: <DollarSign className="size-8" />,
                title: 'No cost breakdown yet',
                description: 'Cost breakdown will appear once requests have been routed in this period.',
              }}
            >
              {(data) => (
                <WaterfallChart
                  steps={[
                    { label: 'Base', value: 0, type: 'start' },
                    { label: 'LLM', value: (data.byCategory?.llm ?? 0) },
                    { label: 'Image', value: (data.byCategory?.diffusion ?? 0) },
                    { label: 'Audio', value: (data.byCategory?.audio ?? 0) },
                    { label: 'Embed', value: (data.byCategory?.embedding ?? 0) },
                    { label: 'Total', value: 0, type: 'total' },
                  ]}
                  height={220}
                  unit="currency"
                />
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Top tenants by cost</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Cost attribution</p>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={tenants.data}
              isLoading={tenants.isLoading}
              error={tenants.error}
              onRetry={tenants.refetch}
              loading={<Skeleton className="h-[260px] w-full" />}
              isEmpty={() => tenantCosts.length === 0}
              empty={{
                icon: <Users className="size-8" />,
                title: 'No tenant cost data yet',
                description: 'Cost attribution will appear once tenants have routed requests.',
              }}
            >
              {() => (
                <BarSeriesChart
                  data={tenantCosts}
                  xKey="label"
                  bars={[{ key: 'value', color: chartColor('primary') }]}
                  layout="vertical"
                  height={260}
                  yFormatter={(v) => formatCurrency(v)}
                />
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Recent invoices</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Per-period billing</p>
          </CardHeader>
          <CardContent className="px-0">
            <DataState
              data={billing.data}
              isLoading={billing.isLoading}
              error={billing.error}
              onRetry={billing.refetch}
              loading={<Skeleton className="h-[260px] w-full" />}
              isEmpty={(d) => (d.invoices ?? []).length === 0}
              empty={{
                icon: <Receipt className="size-8" />,
                title: 'No invoices yet',
                description: 'Invoices will appear here once a billing period closes.',
              }}
            >
              {(data) => (
                <div className="flex flex-col gap-1">
                  {(data.invoices ?? []).slice(0, 6).map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2 w-full text-left"
                    >
                      <div className="flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
                        <Wallet className="size-3.5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg truncate">{inv.tenantName ?? inv.tenantId}</p>
                        <p className="text-[10px] text-fg-muted">
                          {new Date(inv.periodStart).toLocaleDateString()} → {new Date(inv.periodEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-fg tabular-nums">{formatCurrency(inv.amount ?? 0)}</p>
                        <Badge
                          tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'muted'}
                          size="sm"
                        >
                          {inv.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>
      <Dialog open={selectedInvoice !== null} onOpenChange={(o) => { if (!o) setSelectedInvoice(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Invoice Details</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {selectedInvoice && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-surface-2/40 px-3 divide-y divide-border/60">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] text-fg-subtle uppercase tracking-wider">Invoice ID</span>
                    <span className="text-xs text-fg font-mono">{selectedInvoice.id}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] text-fg-subtle uppercase tracking-wider">Tenant</span>
                    <span className="text-xs text-fg">{selectedInvoice.tenantName ?? selectedInvoice.tenantId ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] text-fg-subtle uppercase tracking-wider">Period</span>
                    <span className="text-xs text-fg">
                      {new Date(selectedInvoice.periodStart).toLocaleDateString()} → {new Date(selectedInvoice.periodEnd).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] text-fg-subtle uppercase tracking-wider">Amount</span>
                    <span className="text-sm font-semibold text-fg tabular-nums">{formatCurrency(selectedInvoice.amount ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] text-fg-subtle uppercase tracking-wider">Status</span>
                    <Badge
                      tone={selectedInvoice.status === 'paid' ? 'success' : selectedInvoice.status === 'overdue' ? 'danger' : 'muted'}
                      size="sm"
                    >
                      {selectedInvoice.status}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-1">Usage breakdown</p>
                  <p className="text-xs text-fg-muted">Line items will be available in a future update.</p>
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelectedInvoice(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
