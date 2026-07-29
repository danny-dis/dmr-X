import { AlertTriangle, KeySquare } from 'lucide-react';

import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Progress } from '@/components/primitives/Progress';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { useKeyRotation } from '@/lib/queries/usage';

/**
 * Key pool balance.
 *
 * Surfaces `/admin/key-rotation`, which the gateway has exposed since the
 * multi-key routing fix and which no page has ever called. It answers the
 * question that setup silently gets wrong: *are all my keys actually being
 * used?* A key with zero selections is configured but carrying no traffic —
 * the exact failure the rotation fix was written for, and invisible without
 * this view.
 */
export function KeyPoolHealth() {
  const { data, isLoading } = useKeyRotation();
  const pools = data?.pools ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key pool balance</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : pools.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            No provider has more than one key configured.
          </p>
        ) : (
          <ul className="space-y-4">
            {pools.map((pool) => {
              const idleKeys = pool.keys.filter((k) => k.selections === 0);
              // balance is min/max selections: 1.0 even, near 0 = one hot key.
              const uneven = pool.totalSelections > 0 && pool.balance < 0.5;

              return (
                <li key={pool.providerId}>
                  <div className="flex items-center gap-2">
                    <KeySquare className="size-3.5 text-fg-subtle" />
                    <span className="text-sm text-fg">{pool.providerName}</span>
                    <span className="text-2xs text-fg-subtle">
                      {pool.keysUsed}/{pool.keys.length} keys used
                    </span>
                    {(uneven || idleKeys.length > 0) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-auto">
                            <Badge tone="warning" variant="soft" size="sm" icon={<AlertTriangle className="size-3" />}>
                              {idleKeys.length > 0 ? `${idleKeys.length} idle` : 'Uneven'}
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                          {idleKeys.length > 0
                            ? 'These keys are stored but have never been selected. They are not adding capacity.'
                            : 'Traffic is concentrated on one key, so the pool is not spreading rate limits.'}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <Progress
                      value={pool.balance * 100}
                      className="flex-1"
                    />
                    <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
                      {(pool.balance * 100).toFixed(0)}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
