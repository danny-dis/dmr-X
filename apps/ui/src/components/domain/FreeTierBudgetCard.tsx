import { Gift, TrendingUp, Zap, Activity, Layers, Server } from 'lucide-react';
import * as React from 'react';

import { Card } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { Badge, type BadgeProps } from '@/components/primitives/Badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/primitives/Tooltip';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';

export type TosRisk = 'ok' | 'caution' | 'avoid';
export type ProviderType = 'keyless' | 'uncapped' | 'monthly';

export interface FreeTierPool {
  id: string;
  name: string;
  type: ProviderType;
  tos_risk: TosRisk;
  monthly_tokens: number;
}

export interface FreeTierProvider {
  id: string;
  provider_name: string;
  type: ProviderType;
  tos_risk: TosRisk;
  total_monthly_budget: number;
  is_healthy: boolean;
}

export interface FreeTierSummaryData {
  total_monthly_budget?: number;
  pooled_monthly_budget?: number;
  total_free_models?: number;
  total_pools?: number;
  total_providers?: number;
  healthy_free_providers?: number;
  estimated_tokens_saved?: number;
}

interface FreeTierBudgetCardProps {
  summary: FreeTierSummaryData;
  pools?: FreeTierPool[];
  providers?: FreeTierProvider[];
  tosRiskLabels?: Partial<Record<TosRisk, string>>;
}

// Fixed 9-hue palette for pool segments (inline — no new CSS tokens).
const POOL_COLORS = [
  '#6D4CFF', // primary purple
  '#059669', // success green
  '#D97706', // warning amber
  '#DC2626', // danger red
  '#0EA5E9', // sky
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F59E0B', // orange
];

const TOS_TONE: Record<TosRisk, BadgeProps['tone']> = {
  ok: 'success',
  caution: 'warning',
  avoid: 'danger',
};

const TOS_LABEL: Record<TosRisk, string> = {
  ok: 'OK',
  caution: 'Caution',
  avoid: 'Avoid',
};

const TYPE_TONE: Record<ProviderType, BadgeProps['tone']> = {
  keyless: 'primary',
  uncapped: 'info',
  monthly: 'neutral',
};

const TYPE_LABEL: Record<ProviderType, string> = {
  keyless: 'Keyless',
  uncapped: 'Uncapped',
  monthly: 'Monthly',
};

export function FreeTierBudgetCard({
  summary,
  pools = [],
  providers = [],
  tosRiskLabels = {},
}: FreeTierBudgetCardProps) {
  const {
    total_monthly_budget = 0,
    pooled_monthly_budget,
    total_free_models = 0,
    total_pools,
    total_providers,
    healthy_free_providers = 0,
    estimated_tokens_saved = 0,
  } = summary;

  // Stacked bar uses the pool-deduped total so the bar sums to real steady
  // recurring tokens, not an inflated rate-limit ceiling.
  const barTotal =
    typeof pooled_monthly_budget === 'number' && pooled_monthly_budget > 0
      ? pooled_monthly_budget
      : pools.reduce((s, p) => s + (p.monthly_tokens || 0), 0);

  const hasBudget = barTotal > 0 || total_monthly_budget > 0;
  const visiblePools = pools.filter((p) => (p.monthly_tokens || 0) > 0);
  const activeProviders = providers.filter((p) => (p.total_monthly_budget || 0) > 0);

  return (
    <TooltipProvider delayDuration={120}>
      <Card className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-success" />
          <h3 className="text-lg font-semibold">Free Tier Budget</h3>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatTile
            icon={<Gift className="h-4 w-4" />}
            label="Monthly Budget"
            value={hasBudget ? formatNumber(barTotal || total_monthly_budget) : 'Uncapped'}
            tone="success"
          />
          <StatTile
            icon={<Zap className="h-4 w-4" />}
            label="Free Models"
            value={total_free_models}
            tone="primary"
          />
          <StatTile
            icon={<Activity className="h-4 w-4" />}
            label="Healthy Providers"
            value={healthy_free_providers}
            tone="accent"
          />
          <StatTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Tokens Used (30d)"
            value={formatNumber(estimated_tokens_saved)}
            tone="warning"
          />
          <StatTile
            icon={<Layers className="h-4 w-4" />}
            label="Pools"
            value={typeof total_pools === 'number' ? total_pools : visiblePools.length}
            tone="default"
          />
          <StatTile
            icon={<Server className="h-4 w-4" />}
            label="Providers"
            value={typeof total_providers === 'number' ? total_providers : providers.length}
            tone="default"
          />
        </div>

        {/* Pool-deduped stacked budget bar */}
        {(hasBudget || visiblePools.length > 0) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-muted">
                Steady recurring monthly tokens by pool
              </span>
              {barTotal > 0 && (
                <span className="text-xs text-fg-muted">
                  {formatNumber(barTotal)} tokens/mo
                </span>
              )}
            </div>

            {visiblePools.length === 0 || barTotal === 0 ? (
              <div className="rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-fg-muted">
                Uncapped — no fixed monthly token budget configured.
              </div>
            ) : (
              <>
                <div className="flex h-4 w-full overflow-hidden rounded-full border border-border bg-surface-2">
                  {visiblePools.map((pool, i) => {
                    const pct = (pool.monthly_tokens / barTotal) * 100;
                    const color = POOL_COLORS[i % POOL_COLORS.length];
                    return (
                      <Tooltip key={pool.id}>
                        <TooltipTrigger asChild>
                          <div
                            className="h-full transition-[width]"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="font-medium">{pool.name}</div>
                          <div>{formatNumber(pool.monthly_tokens)} tokens/mo · {pct.toFixed(1)}%</div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {visiblePools.map((pool, i) => (
                    <div key={pool.id} className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: POOL_COLORS[i % POOL_COLORS.length] }}
                      />
                      <span className="truncate max-w-[12rem]">{pool.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Per-provider ToS-risk table */}
        {activeProviders.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs text-fg-muted">
              Providers &amp; Terms-of-Service exposure
            </span>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-fg-muted">
                    <th className="text-left font-medium py-2 pl-3">Provider</th>
                    <th className="text-left font-medium py-2">Type</th>
                    <th className="text-right font-medium py-2">Tokens/mo</th>
                    <th className="text-left font-medium py-2 pr-3">ToS Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProviders.map((p, i) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="py-2 pl-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: POOL_COLORS[i % POOL_COLORS.length] }}
                          />
                          <span className="font-medium">{p.provider_name}</span>
                          {!p.is_healthy && (
                            <Badge tone="muted" size="sm">down</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2">
                        <Badge tone={TYPE_TONE[p.type]} size="sm">
                          {TYPE_LABEL[p.type]}
                        </Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {p.total_monthly_budget > 0
                          ? formatNumber(p.total_monthly_budget)
                          : 'Uncapped'}
                      </td>
                      <td className="py-2 pr-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Badge tone={TOS_TONE[p.tos_risk]} size="sm">
                                {TOS_LABEL[p.tos_risk]}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[18rem]">
                            {tosRiskLabels[p.tos_risk] ?? defaultTosLabel(p.tos_risk)}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </TooltipProvider>
  );
}

function defaultTosLabel(risk: TosRisk): string {
  switch (risk) {
    case 'ok':
      return 'Self-hosted / no third-party ToS exposure — safe for commercial & automated use.';
    case 'caution':
      return 'Cloud free tier — provider ToS may restrict commercial or automated use. Review before production.';
    case 'avoid':
      return 'Free tier explicitly forbids the use cases DMR-X enables. Do not route production traffic here.';
  }
}
