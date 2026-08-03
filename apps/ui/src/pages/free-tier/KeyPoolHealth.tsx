import { KeySquare } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Progress } from '@/components/primitives/Progress';
import { StatusPill, type StatusKind } from '@/components/primitives/StatusPill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { useKeyRotation, type KeyRotationPool } from '@/lib/queries/usage';

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
  const { data, isLoading, error, refetch } = useKeyRotation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key pool balance</CardTitle>
      </CardHeader>
      <CardContent>
        <DataState
          data={data?.pools}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonRows={3}
          empty={{
            icon: <KeySquare className="size-8" />,
            title: 'No key pools configured',
            description: 'Add a second key to any provider to enable rotation and see pool balance here.',
          }}
        >
          {(pools) => (
            <ul className="space-y-4">
              {pools.map((pool) => (
                <PoolRow key={pool.providerId} pool={pool} />
              ))}
            </ul>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}

function PoolRow({ pool }: { pool: KeyRotationPool }) {
  const keys = pool.keys ?? [];
  const idleKeys = keys.filter((k) => k.selections === 0);
  const allIdle = keys.length > 0 && idleKeys.length === keys.length;
  // balance is min/max selections: 1.0 even, near 0 = one hot key.
  const uneven = pool.totalSelections > 0 && pool.balance < 0.5;

  let status: StatusKind;
  let label: string;
  let tooltip: string;
  if (allIdle) {
    status = 'offline';
    label = 'Unused';
    tooltip = 'None of these keys have ever been selected. The pool is configured but carrying no traffic.';
  } else if (idleKeys.length > 0) {
    status = 'warning';
    label = `${idleKeys.length} idle`;
    tooltip = 'These keys are stored but have never been selected. They are not adding capacity.';
  } else if (uneven) {
    status = 'warning';
    label = 'Uneven';
    tooltip = 'Traffic is concentrated on one key, so the pool is not spreading rate limits.';
  } else {
    status = 'healthy';
    label = 'Balanced';
    tooltip = 'Traffic is spread evenly across all keys in this pool.';
  }

  return (
    <li>
      <div className="flex items-center gap-2">
        <KeySquare className="size-3.5 text-fg-subtle" aria-hidden />
        <span className="text-sm text-fg">{pool.providerName}</span>
        <span className="text-2xs text-fg-subtle">
          {pool.keysUsed}/{keys.length} keys used
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto">
              <StatusPill status={status} label={label} size="sm" pulse={false} />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{tooltip}</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Progress
          value={pool.balance * 100}
          tone={status === 'offline' ? 'danger' : status === 'warning' ? 'warning' : 'success'}
          className="flex-1"
        />
        <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
          {(pool.balance * 100).toFixed(0)}%
        </span>
      </div>
    </li>
  );
}
