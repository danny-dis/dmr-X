import { AlertTriangle, KeyRound, RefreshCw, Sparkles, Zap } from 'lucide-react';
import * as React from 'react';

import { DiscoverKeyDialog } from './DiscoverKeyDialog';
import { KeyPoolHealth } from './KeyPoolHealth';

import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { LiveTokenCounter } from '@/components/domain/LiveTokenCounter';
import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Progress } from '@/components/primitives/Progress';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useUrlState } from '@/hooks/useUrlState';
import { chartColor } from '@/lib/chartPalette';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { useFreeTierSummary, useSavings, type UsageWindow, type Savings, type FreeTierSummary } from '@/lib/queries/usage';

/**
 * Free Tier.
 *
 * Deliberately separate from Models: this page answers "what am I getting for
 * free and what is it worth", while Models answers "what am I paying for".
 * Merging them buried the free-tier story inside a registry table.
 */
export function FreeTierPage() {
  const [window, setWindow] = useUrlState<UsageWindow>('window', '24h');
  const [days, setDays] = useUrlState('days', '30');
  const [discoverOpen, setDiscoverOpen] = React.useState(false);

  const summary = useFreeTierSummary();
  const savings = useSavings(Number(days) || 30);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Free Tier"
        description="Free models discovered from your keys, what they've served, and what that saved."
        icon={<Zap className="size-5 text-success" />}
        actions={
          <Button leftIcon={<KeyRound className="size-4" />} onClick={() => setDiscoverOpen(true)}>
            Add free key
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <LiveTokenCounter tier="free" window={window} onWindowChange={setWindow} />

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Free capacity</div>
            {summary.isFetching && (
              <RefreshCw className="size-3.5 animate-spin text-fg-subtle" aria-hidden />
            )}
          </div>
          <div className="mt-4">
            <DataState
              data={summary.data?.summary}
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={summary.refetch}
              loading={
                <div className="grid grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              }
            >
              {(totals) => (
                <div className="grid grid-cols-3 gap-4">
                  <Metric label="Free models" value={formatNumber(totals.total_free_models ?? 0)} />
                  <Metric label="Healthy providers" value={formatNumber(totals.healthy_free_providers ?? 0)} />
                  <Metric
                    label="Monthly budget"
                    value={formatNumber(totals.total_monthly_budget ?? 0, true)}
                    suffix="tokens"
                  />
                </div>
              )}
            </DataState>
          </div>
        </Card>
      </div>

      {/* Savings over time */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Estimated savings</CardTitle>
            {savings.data?.basis.warning ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5" aria-hidden />
                {savings.data.basis.warning}
              </p>
            ) : (
              <p className="mt-1 text-xs text-fg-muted">{savings.data?.basis.method}</p>
            )}
          </div>
          <div className="flex gap-1">
            {['7', '30', '90'].map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? 'secondary' : 'ghost'}
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <DataState
            data={savings.data}
            isLoading={savings.isLoading}
            error={savings.error}
            onRetry={savings.refetch}
            isEmpty={(d: Savings) => d.daily.length === 0}
            loading={<Skeleton className="h-56 w-full" />}
            empty={{
              icon: <Sparkles className="size-6" />,
              title: 'No free-tier traffic yet',
              description: 'Once requests route to a free model, savings appear here.',
            }}
          >
            {(data) => (
              <TimeSeriesChart
                data={data.daily}
                xKey="date"
                height={220}
                series={[
                  { key: 'costAvoidedUsd', name: 'Cost avoided (USD)', color: chartColor('success'), fillOpacity: 0.15 },
                ]}
                yFormatter={(v) => formatCurrency(Number(v))}
              />
            )}
          </DataState>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Savings by provider */}
        <Card>
          <CardHeader>
            <CardTitle>Savings by provider</CardTitle>
          </CardHeader>
          <CardContent>
            <DataState
              data={savings.data}
              isLoading={savings.isLoading}
              error={savings.error}
              onRetry={savings.refetch}
              isEmpty={(d: Savings) => d.byProvider.length === 0}
              loading={<Skeleton className="h-40 w-full" />}
              empty={{
                title: 'No free usage recorded',
                description: 'Provider savings appear once a request routes to a free model.',
              }}
            >
              {(data) => (
                <ul className="divide-y divide-border">
                  {data.byProvider.map((p) => (
                    <li key={p.providerId} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-fg">{p.providerName ?? p.providerId}</div>
                        <div className="text-2xs text-fg-subtle">
                          {formatNumber(p.totalTokens, true)} tokens · {p.requests} requests
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-success">
                        {formatCurrency(p.costAvoidedUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DataState>
          </CardContent>
        </Card>

        <KeyPoolHealth />
      </div>

      {/* Per-provider rate-limit budgets */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Free providers &amp; limits</CardTitle>
        </CardHeader>
        <CardContent>
          <DataState
            data={summary.data?.providers}
            isLoading={summary.isLoading}
            error={summary.error}
            onRetry={summary.refetch}
            loading={<Skeleton className="h-40 w-full" />}
            empty={{
              icon: <KeyRound className="size-6" />,
              title: 'No free providers connected',
              description: 'Add a free API key and DMR-X will discover which of its models are actually free.',
              action: <Button onClick={() => setDiscoverOpen(true)}>Add free key</Button>,
            }}
          >
            {(providers: FreeTierSummary['providers']) => (
              <div className="space-y-5">
                {providers.map((p) => (
                  <div key={p.provider_name}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">{p.provider_name}</span>
                      <Badge tone={p.is_healthy ? 'success' : 'danger'} variant="soft" size="sm">
                        {p.is_healthy ? 'Healthy' : 'Unhealthy'}
                      </Badge>
                      <span className="ml-auto text-2xs text-fg-subtle">
                        {formatNumber(p.total_monthly_budget, true)} tokens/mo
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {p.models.slice(0, 6).map((m) => (
                        <li key={m.model_id} className="flex items-center gap-3 text-xs">
                          <span className="w-56 shrink-0 truncate font-mono text-2xs text-fg-muted">
                            {m.model_id}
                          </span>
                          <div className="flex-1">
                            <Progress
                              value={
                                p.total_monthly_budget > 0
                                  ? (m.monthly_token_budget / p.total_monthly_budget) * 100
                                  : 0
                              }
                            />
                          </div>
                          <span className="w-32 shrink-0 text-right text-2xs text-fg-subtle">
                            {m.rate_limits.rpm ? `${m.rate_limits.rpm} rpm` : '—'}
                            {m.rate_limits.rpd ? ` · ${formatNumber(m.rate_limits.rpd, true)} rpd` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {p.models.length > 6 && (
                      <p className="mt-1.5 text-2xs text-fg-subtle">
                        +{p.models.length - 6} more models
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DataState>
        </CardContent>
      </Card>

      <DiscoverKeyDialog open={discoverOpen} onOpenChange={setDiscoverOpen} />
    </PageContainer>
  );
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-fg">{value}</div>
      <div className="mt-0.5 text-2xs text-fg-subtle">
        {label}
        {suffix ? ` · ${suffix}` : ''}
      </div>
    </div>
  );
}
