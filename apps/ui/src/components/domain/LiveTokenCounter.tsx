import { Activity, Coins, TrendingDown, Zap } from 'lucide-react';
import * as React from 'react';

import { Card } from '@/components/primitives/Card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { useLiveCounter } from '@/hooks/useLiveCounter';
import type { UsageWindow } from '@/lib/queries/usage';
import { cn } from '@/lib/utils';

const WINDOWS: Array<{ value: UsageWindow; label: string }> = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/**
 * Animate to a new value rather than snapping.
 *
 * A counter fed by a live stream jumps every time a request completes, and an
 * unanimated jump reads as a glitch. Skips the animation for large deltas —
 * a window change is a different number, not a increment, and tweening across
 * it would be a lie about what happened.
 */
function useRolledValue(target: number): number {
  const [display, setDisplay] = React.useState(target);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    const start = display;
    const delta = target - start;
    if (delta === 0) return;

    if (Math.abs(delta) > Math.max(start * 0.5, 10_000)) {
      setDisplay(target);
      return;
    }

    const startedAt = performance.now();
    const DURATION = 400;

    const step = (now: number) => {
      const t = Math.min((now - startedAt) / DURATION, 1);
      // Ease-out so the number settles rather than stopping abruptly.
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(start + delta * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
    // `display` is deliberately not a dependency: including it would restart
    // the animation on every frame it sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

export interface LiveTokenCounterProps {
  tier: 'free' | 'paid';
  window: UsageWindow;
  onWindowChange: (w: UsageWindow) => void;
  className?: string;
}

/**
 * Live token counter.
 *
 * Free tier shows tokens plus the counterfactual cost avoided; the paid side
 * shows tokens plus real spend. The savings figure is never rendered on its
 * own — the reference model it was priced against is always shown with it,
 * because "you saved $47" is meaningless without "compared to what".
 */
export function LiveTokenCounter({ tier, window, onWindowChange, className }: LiveTokenCounterProps) {
  const counter = useLiveCounter(tier, window);
  const tokens = useRolledValue(counter.tokens);
  const isFree = tier === 'free';

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-8 place-items-center rounded-lg',
              isFree ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
            )}
          >
            {isFree ? <Zap className="size-4" /> : <Coins className="size-4" />}
          </span>
          <div>
            <div className="text-sm font-medium text-fg">
              {isFree ? 'Free tier usage' : 'Paid usage'}
            </div>
            <div className="flex items-center gap-1.5 text-2xs text-fg-subtle">
              {counter.isLive ? (
                <>
                  <Activity className="size-3 text-success" />
                  Live
                </>
              ) : (
                'Reconnecting…'
              )}
            </div>
          </div>
        </div>

        <Select value={window} onValueChange={(v) => onWindowChange(v as UsageWindow)}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-3xl font-semibold tabular-nums text-fg cursor-default">
                {compact.format(tokens)}
              </div>
            </TooltipTrigger>
            <TooltipContent>{full.format(tokens)} tokens</TooltipContent>
          </Tooltip>
          <div className="mt-0.5 text-xs text-fg-muted">
            tokens · {full.format(counter.requests)} requests
          </div>
        </div>

        <div>
          {isFree ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tabular-nums text-success">
                  {usd.format(counter.costAvoidedUsd)}
                </span>
                <TrendingDown className="size-4 text-success" />
              </div>
              <div className="mt-0.5 text-xs text-fg-muted">
                {counter.basis?.warning ? (
                  // Be explicit when there is nothing to compare against
                  // rather than presenting $0.00 as a real result.
                  <span className="text-warning">No paid model to compare against</span>
                ) : counter.basis?.referenceModels?.[0] ? (
                  <>estimated saving vs. {counter.basis.referenceModels[0].model}</>
                ) : (
                  'estimated saving'
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-semibold tabular-nums text-fg">
                {usd.format(counter.costUsd)}
              </div>
              <div className="mt-0.5 text-xs text-fg-muted">spent this period</div>
            </>
          )}
        </div>
      </div>

      {isFree && counter.basis && !counter.basis.warning && (
        <p className="mt-4 border-t border-border pt-3 text-2xs leading-relaxed text-fg-subtle">
          {counter.basis.method}
        </p>
      )}
    </Card>
  );
}
