import * as React from 'react';
import { cn } from '@/lib/utils';
import { Gauge } from '@/components/charts/Gauge';
import { Progress } from '@/components/primitives/Progress';
import { formatNumber, formatTokens } from '@/lib/formatters';
import type { ApiQuotaState } from '@/types/api';

export interface QuotaGaugeProps {
  quota: ApiQuotaState;
  className?: string;
}

export function QuotaGauge({ quota, className }: QuotaGaugeProps) {
  const tokensUsed = quota.tokens_used ?? 0;
  const tokensLimit = quota.tokens_limit ?? 0;
  const reqUsed = quota.requests_used ?? 0;
  const reqLimit = quota.requests_limit ?? 0;
  const costUsed = quota.cost_used ?? 0;
  const costLimit = quota.cost_limit ?? 0;

  const tokensT = tokensLimit > 0 ? (tokensUsed / tokensLimit) * 100 : 0;
  const reqT = reqLimit > 0 ? (reqUsed / reqLimit) * 100 : 0;
  const costT = costLimit > 0 ? (costUsed / costLimit) * 100 : 0;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col items-center gap-2">
          <Gauge
            value={tokensT}
            max={100}
            size={120}
            thickness={10}
            label="Tokens"
            tone={tokensT > 90 ? 'danger' : tokensT > 75 ? 'warning' : 'primary'}
          />
          <div className="text-center">
            <div className="text-sm font-semibold tabular-nums">{formatTokens(tokensUsed)}</div>
            <div className="text-[10px] text-fg-muted">of {formatTokens(tokensLimit, true)}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Gauge
            value={reqT}
            max={100}
            size={120}
            thickness={10}
            label="Requests"
            tone={reqT > 90 ? 'danger' : reqT > 75 ? 'warning' : 'accent'}
          />
          <div className="text-center">
            <div className="text-sm font-semibold tabular-nums">{formatNumber(reqUsed)}</div>
            <div className="text-[10px] text-fg-muted">of {formatNumber(reqLimit, true)}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Gauge
            value={costT}
            max={100}
            size={120}
            thickness={10}
            label="Cost"
            tone={costT > 90 ? 'danger' : costT > 75 ? 'warning' : 'success'}
          />
          <div className="text-center">
            <div className="text-sm font-semibold tabular-nums">${costUsed.toFixed(2)}</div>
            <div className="text-[10px] text-fg-muted">of ${costLimit.toFixed(0)}</div>
          </div>
        </div>
      </div>
      {quota.reset_at && (
        <p className="text-[10px] text-fg-muted text-center">
          Resets {new Date(quota.reset_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export function QuotaProgressBar({ quota, className }: QuotaGaugeProps) {
  const tokensT = (quota.tokens_limit ?? 0) > 0 ? ((quota.tokens_used ?? 0) / quota.tokens_limit!) * 100 : 0;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-fg-muted">Tokens</span>
        <span className="tabular-nums text-fg">{tokensT.toFixed(1)}%</span>
      </div>
      <Progress
        value={tokensT}
        tone={tokensT > 90 ? 'danger' : tokensT > 75 ? 'warning' : 'primary'}
        size="sm"
      />
    </div>
  );
}
