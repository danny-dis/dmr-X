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
import { EmptyState } from '@/components/primitives/EmptyState';
import { Progress } from '@/components/primitives/Progress';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useUrlState } from '@/hooks/useUrlState';
import { useFreeTierSummary, useSavings, type UsageWindow } from '@/lib/queries/usage';
import { chartColor } from '@/lib/chartPalette';

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

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

  const providers = summary.data?.providers ?? [];
  const totals = summary.data?.summary;

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
            {summary.isFetching && <RefreshCw className="size-3.5 animate-spin text-fg-subtle" />}
          </div>
          {summary.isLoading ? (
            <Skeleton className="mt-4 h-20 w-full" />
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-4">
              <Metric label="Free models" value={String(totals?.total_free_models ?? 0)} />
              <Metric label="Healthy providers" value={String(totals?.healthy_free_providers ?? 0)} />
              <Metric
                label="Monthly budget"
                value={compact.format(totals?.total_monthly_budget ?? 0)}
                suffix="tokens"
              />
            </div>
          )}
        </Card>
      </div>

      {/* Savings over time */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Estimated savings</CardTitle>
            {savings.data?.basis.warning ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5" />
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
          {savings.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (savings.data?.daily.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-6" />}
              title="No free-tier traffic yet"
              description="Once requests route to a free model, savings appear here."
            />
          ) : (
            <TimeSeriesChart
              data={savings.data!.daily}
              xKey="date"
              height={220}
              series={[
                { key: 'costAvoidedUsd', name: 'Cost avoided (USD)', color: chartColor('success'), fillOpacity: 0.15 },
              ]}
              yFormatter={(v) => usd.format(Number(v))}
            />
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Savings by provider */}
        <Card>
          <CardHeader>
            <CardTitle>Savings by provider</CardTitle>
          </CardHeader>
          <CardContent>
            {savings.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (savings.data?.byProvider.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-fg-muted">No free usage recorded.</p>
            ) : (
              <ul className="divide-y divide-border">
                {savings.data!.byProvider.map((p) => (
                  <li key={p.providerId} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-fg">{p.providerName ?? p.providerId}</div>
                      <div className="text-2xs text-fg-subtle">
                        {compact.format(p.totalTokens)} tokens · {p.requests} requests
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-success">
                      {usd.format(p.costAvoidedUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
          {summary.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="size-6" />}
              title="No free providers connected"
              description="Add a free API key and DMR-X will discover which of its models are actually free."
              action={<Button onClick={() => setDiscoverOpen(true)}>Add free key</Button>}
            />
          ) : (
            <div className="space-y-5">
              {providers.map((p) => (
                <div key={p.provider_name}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{p.provider_name}</span>
                    <Badge tone={p.is_healthy ? 'success' : 'danger'} variant="soft" size="sm">
                      {p.is_healthy ? 'Healthy' : 'Unhealthy'}
                    </Badge>
                    <span className="ml-auto text-2xs text-fg-subtle">
                      {compact.format(p.total_monthly_budget)} tokens/mo
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
                          {m.rate_limits.rpd ? ` · ${compact.format(m.rate_limits.rpd)} rpd` : ''}
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
