import {
  Star,
  StarOff,
  MoreHorizontal,
  Cpu,
  Server,
  KeyRound,
} from 'lucide-react';
import * as React from 'react';

import { TierBadge } from '@/components/domain/TierBadge';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Progress } from '@/components/primitives/Progress';
import { StatusPill, type StatusKind } from '@/components/primitives/StatusPill';
import { formatTokens } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiProvider } from '@/types/api';

export interface FreeProviderCardProps {
  provider: ApiProvider;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  onSelect?: (provider: ApiProvider) => void;
  onTest?: (id: string) => void;
  className?: string;
}

export function FreeProviderCard({
  provider,
  isFavorite = false,
  onToggleFavorite,
  onSelect,
  onTest,
  className,
}: FreeProviderCardProps) {
  const health = provider.health;
  // `health?.status` uses the wire vocabulary ('ok' | 'degraded' | 'down' |
  // 'unknown'); StatusPill expects its own StatusKind union. Map explicitly
  // instead of passing the value straight through — the previous
  // `health?.status ?? provider.enabled ? 'online' : 'offline'` bound `??`
  // tighter than `?:`, so any truthy status collapsed to 'online'.
  const healthStatus: StatusKind =
    health?.status === 'ok'
      ? 'online'
      : health?.status === 'down'
        ? 'offline'
        : health?.status === 'degraded'
          ? 'degraded'
          : health?.status === 'unknown'
            ? 'unknown'
            : provider.enabled
              ? 'online'
              : 'offline';
  const latency = health?.latencyMs;
  const config = provider.config as Record<string, unknown> | undefined;
  const signupUrl = (provider as unknown as Record<string, unknown>).signupUrl as string | undefined;
  const monthlyBudget = (config?.monthlyTokenBudget as number | undefined) ?? 1000000;

  return (
    <Card
      padding="none"
      interactive
      className={cn('group flex flex-col', className)}
      onClick={() => onSelect?.(provider)}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary font-mono text-xs font-semibold uppercase">
            {provider.name.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-semibold text-fg truncate">{provider.name}</h4>
              <TierBadge tier={provider.tier} />
            </div>
            <p className="text-[11px] text-fg-muted truncate">{provider.baseUrl ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleFavorite && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(provider.id);
              }}
              aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
            >
              {isFavorite ? (
                <Star className="size-3.5 text-warning fill-warning" />
              ) : (
                <StarOff className="size-3.5" />
              )}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="More"
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(provider);
            }}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Token Budget Progress */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between text-[10px] text-fg-subtle">
          <span>Monthly budget</span>
          <span className="tabular-nums">{formatTokens(monthlyBudget)}</span>
        </div>
        <Progress
          value={0}
          tone="primary"
          size="sm"
          className="mt-1"
        />
      </div>

      <div className="px-4 pb-3 flex items-center gap-2 text-[11px] flex-wrap">
        <StatusPill status={healthStatus} size="sm" showDot pulse={false} />
        {latency != null && (
          <span className="text-fg-subtle tabular-nums">{Math.round(latency)}ms</span>
        )}
        {provider.authType && (
          <Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5" />}>
            {provider.authType}
          </Badge>
        )}
        {provider.keys && provider.keys.length > 1 && (
          <Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5" />}>
            {provider.keys.length} keys
          </Badge>
        )}
        {provider.capabilities?.length ? (
          <Badge tone="muted" size="sm">
            {provider.capabilities.length} capabilities
          </Badge>
        ) : null}
      </div>

      <div className="px-4 pb-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <Cpu className="size-3" />
          <span>{provider.modelCount ?? provider.models?.length ?? 0} models</span>
        </div>
        <div className="flex items-center gap-2">
          {signupUrl && (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                window.open(signupUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              <KeyRound className="size-3" />
              Get Key
            </Button>
          )}
          {onTest && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onTest(provider.id);
              }}
            >
              <Server className="size-3" />
              Test
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
