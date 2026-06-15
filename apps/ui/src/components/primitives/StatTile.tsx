import * as React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from './Card';
import { Sparkline } from '@/icons/Status';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  deltaTrend?: 'up-good' | 'down-good' | 'neutral';
  icon?: React.ReactNode;
  sparkline?: number[];
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  deltaTrend = 'up-good',
  icon,
  sparkline,
  hint,
  loading = false,
  className,
  tone = 'default',
}: StatTileProps) {
  const toneClass = {
    default: 'text-fg',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    accent: 'text-accent',
  }[tone];

  const deltaDirection =
    delta == null
      ? null
      : delta > 0
        ? 'up'
        : delta < 0
          ? 'down'
          : 'flat';

  const deltaIsGood =
    deltaDirection === null
      ? false
      : deltaTrend === 'up-good'
        ? deltaDirection === 'up'
        : deltaTrend === 'down-good'
          ? deltaDirection === 'down'
          : false;

  const deltaColor =
    deltaDirection === null
      ? ''
      : deltaIsGood
        ? 'text-success'
        : deltaDirection === 'flat'
          ? 'text-fg-muted'
          : 'text-danger';

  return (
    <Card padding="md" className={cn('relative overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            {icon && (
              <span className="text-fg-subtle [&_svg]:size-3.5 flex items-center">
                {icon}
              </span>
            )}
            <span className="truncate">{label}</span>
          </div>
          {loading ? (
            <div className="h-7 w-24 rounded-md bg-surface-2 animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className={cn('text-2xl font-semibold tracking-tight', toneClass)}>
                {value}
              </span>
              {unit && (
                <span className="text-xs text-fg-muted">{unit}</span>
              )}
            </div>
          )}
          {(delta != null || hint) && (
            <div className="flex items-center gap-2 text-[11px]">
              {delta != null && (
                <span className={cn('inline-flex items-center gap-0.5 font-medium', deltaColor)}>
                  {deltaDirection === 'up' && <ArrowUp className="size-3" />}
                  {deltaDirection === 'down' && <ArrowDown className="size-3" />}
                  {deltaDirection === 'flat' && <Minus className="size-3" />}
                  {Math.abs(delta).toFixed(1)}%
                </span>
              )}
              {deltaLabel && (
                <span className="text-fg-subtle">{deltaLabel}</span>
              )}
              {!deltaLabel && hint && (
                <span className="text-fg-subtle">{hint}</span>
              )}
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <div className="shrink-0 opacity-80">
            <Sparkline
              points={sparkline}
              width={80}
              height={32}
              stroke={tone === 'primary' ? '#7C5CFF' : tone === 'success' ? '#34D399' : tone === 'warning' ? '#FBBF24' : tone === 'danger' ? '#F87171' : '#22D3EE'}
              fill="transparent"
              strokeWidth={1.5}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
