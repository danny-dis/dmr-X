import { AlertTriangle, KeyRound, RefreshCw, Sparkles, Zap, Clock } from 'lucide-react';
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
import { useProviders } from '@/lib/queries/providers';
import { useFreeTierSummary, useLiveUsage, useSavings, type LiveUsage, type UsageWindow, type Savings, type FreeTierSummary } from '@/lib/queries/usage';

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
  // Real request telemetry for the routing split — free vs non-free or unclassified REQUEST
  // counts from /admin/usage/live. Model counts are inventory, not traffic,
  // so they must never stand in for this.
  const liveUsage = useLiveUsage(window);
  const providersQuery = useProviders();
  const traffic = computeTrafficDistribution(liveUsage.data);
  const fallbackPath = resolveFallbackPath(providersQuery.data);

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

      {/* Routing distribution — free vs non-free or unclassified REQUEST share from live usage
          telemetry. Model counts are inventory, not traffic, so when the
          usage endpoint reports nothing we say so instead of rendering a
          fabricated split. */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Routing distribution</CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Free vs non-free or unclassified request share from live usage telemetry</p>
        </CardHeader>
        <CardContent>
          <DataState
            data={traffic}
            isLoading={liveUsage.isLoading}
            error={liveUsage.error}
            onRetry={liveUsage.refetch}
            loading={<Skeleton className="h-32 w-full" />}
            empty={{
              title: 'Request telemetry unavailable',
              description:
                'Routing split appears once the usage endpoint reports classified free and other requests. Unclassified models are counted in the other bucket; model inventory is not traffic.',
            }}
          >
            {(dist) => (
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-fg-muted">Free requests ({formatNumber(dist.free)})</span>
                        <span className="font-medium text-success">{dist.freePercent.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full bg-success transition-all duration-500"
                          style={{ width: `${dist.freePercent}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-fg-muted">Non-free or unclassified requests ({formatNumber(dist.nonFreeOrUnclassified)})</span>
                        <span className="font-medium text-warning">{(100 - dist.freePercent).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full bg-warning transition-all duration-500"
                          style={{ width: `${100 - dist.freePercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-fg-muted">
                    Shares are request counts for the selected window ({window}); the non-free bucket also includes unclassified models.
                  </p>
                </div>
              )}
          </DataState>
        </CardContent>
      </Card>

      {/* Predicted exhaustion & fallback path */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Capacity forecast</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Rate-limit budgets per provider</p>
          </CardHeader>
          <CardContent>
            <DataState
              data={summary.data?.providers}
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={summary.refetch}
              loading={<Skeleton className="h-32 w-full" />}
              empty={{
                title: 'No capacity data',
                description: 'Add a free key to see capacity forecasts.',
              }}
            >
              {(providers) => (
                <div className="space-y-3">
                  {providers.slice(0, 4).map((p) => (
                      <div key={p.provider_name} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-fg truncate">{p.provider_name}</span>
                            <span className="text-fg-muted tabular-nums">
                              {formatNumber(p.total_monthly_budget, true)} tokens/mo
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-fg-muted">
                            {p.models[0]?.rate_limits.rpm ? `${p.models[0].rate_limits.rpm} rpm` : 'rate limits unreported'}
                            {p.models[0]?.rate_limits.rpd ? ` · ${formatNumber(p.models[0].rate_limits.rpd, true)} rpd` : ''}
                            {' · '}{p.models.length} model{p.models.length === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>
                    ))}
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[10px] text-fg-muted">
                    <Clock className="size-3 shrink-0" />
                    <span>
                      Exhaustion forecast unavailable — this view does not combine per-key usage,
                      reset windows, and current consumption into a reliable days-left estimate.
                      Request telemetry appears above once traffic flows.
                    </span>
                  </div>
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fallback path</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">
              Unknown — no live policy, rate-limit, or quota-reset data is reported
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {fallbackPath.steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <div className="size-6 shrink-0 rounded-full bg-surface-3 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-fg-muted">?</span>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-fg">
                      {step.title}{' '}
                      <span className="font-normal text-fg-muted">· Unknown / N/A</span>
                    </div>
                    <div className="text-[10px] text-fg-muted">{step.detail}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 text-[10px] text-fg-muted">
                <Clock className="size-3 shrink-0 mt-0.5" />
                <span>
                  No live rate-limit, quota, or routing-policy data is available from the
                  endpoints this page reads, so each step shows Unknown instead of an
                  assumed path. Request shares above are real telemetry from live usage.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
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

export interface TrafficDistribution {
  free: number;
  nonFreeOrUnclassified: number;
  freePercent: number;
}

/**
 * Free vs non-free or unclassified REQUEST share from live usage telemetry.
 *
 * Returns null when telemetry is missing or reports zero requests — the
 * caller renders "telemetry unavailable" instead of fabricating a split.
 * Model counts are inventory, never traffic: an object without numeric
 * `free.requests` / `paid.requests` (e.g. a free-tier summary carrying
 * `total_free_models`) is refused, not coerced.
 */
export function computeTrafficDistribution(
  live: LiveUsage | null | undefined,
): TrafficDistribution | null {
  const free = live?.free?.requests;
  const paid = live?.paid?.requests;
  if (typeof free !== 'number' || typeof paid !== 'number') return null;
  if (!Number.isFinite(free) || !Number.isFinite(paid)) return null;
  const total = free + paid;
  if (total <= 0) return null;
  return { free, nonFreeOrUnclassified: paid, freePercent: (free / total) * 100 };
}

/**
 * Predicted days until a budget exhausts.
 *
 * Always null: this view does not combine per-key usage, reset windows,
 * and current consumption into a reliable days-left estimate. Kept as a named function
 * (rather than inlining null) so the call site documents the gap and a
 * future backend field has one place to land.
 */
export function predictExhaustionDays(
  _budget: { total_monthly_budget: number; monthly_token_budget: number } | null | undefined,
): number | null {
  return null;
}

/**
 * Whether policy permits a paid fallback, plus paid-tier inventory.
 *
 * `available` is always null: no endpoint this page reads exposes a
 * routing-policy field, so a paid/mixed tier (which only proves a key is
 * configured) cannot prove policy permits paid fallback. Callers must
 * render Unknown/N/A — never a fabricated fallback path. `paidTierConfigured`
 * is the typed inventory fact, kept separate so it can be shown without
 * being misread as policy.
 */
export function resolvePaidFallback(
  providers: Array<{ tier?: string | null }> | null | undefined,
): { available: boolean | null; paidTierConfigured: boolean } {
  const paidTierConfigured = (providers ?? []).some(
    (p) => p.tier === 'paid' || p.tier === 'mixed',
  );
  return { available: null, paidTierConfigured };
}

export type FallbackStepId =
  | 'free_first'
  | 'rate_limit_retry'
  | 'paid_fallback'
  | 'budget_reset';

export interface FallbackPathStep {
  id: FallbackStepId;
  title: string;
  detail: string;
  status: 'unknown';
}

export interface FallbackPath {
  steps: FallbackPathStep[];
  policyDataAvailable: false;
}

/**
 * Routing behaviour when free capacity runs out.
 *
 * Every step is 'unknown': the endpoints this page read expose budgets,
 * tiers and request counts, but no routing-policy field, no live
 * rate-limit state, and no per-provider quota-reset cadence. The UI must
 * render Unknown/N/A with that explanation — never an asserted
 * free-first ordering, retry behaviour, paid-fallback permission, or
 * monthly reset.
 */
export function resolveFallbackPath(
  providers: Array<{ tier?: string | null }> | null | undefined,
): FallbackPath {
  const paid = resolvePaidFallback(providers);
  return {
    policyDataAvailable: false,
    steps: [
      {
        id: 'free_first',
        title: 'Free-first ordering',
        detail: 'No live policy data reports whether requests are ordered free-first.',
        status: 'unknown',
      },
      {
        id: 'rate_limit_retry',
        title: 'Rate-limit retry',
        detail: 'No live rate-limit state or window-reset cadence is reported.',
        status: 'unknown',
      },
      {
        id: 'paid_fallback',
        title: 'Paid fallback',
        detail: paid.paidTierConfigured
          ? 'A paid/mixed provider is configured, but no policy field reports whether paid fallback is permitted.'
          : 'No policy field reports whether paid fallback is permitted.',
        status: 'unknown',
      },
      {
        id: 'budget_reset',
        title: 'Budget reset',
        detail: 'No per-provider quota-reset cadence is reported.',
        status: 'unknown',
      },
    ],
  };
}
