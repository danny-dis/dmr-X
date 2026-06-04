import * as React from 'react';
import { Star, StarOff, MoreHorizontal, Zap, Cpu, Server, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { StatusPill } from '@/components/primitives/StatusPill';
export function ProviderCard({ provider, isFavorite = false, onToggleFavorite, onSelect, onTest, className, }) {
    const health = provider.health;
    const healthStatus = health?.status ?? provider.enabled ? 'online' : 'offline';
    const latency = health?.latencyMs;
    return (<Card padding="none" interactive className={cn('group flex flex-col', className)} onClick={() => onSelect?.(provider)}>
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted font-mono text-xs font-semibold uppercase">
            {provider.name.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-semibold text-fg truncate">{provider.name}</h4>
              {provider.priority != null && provider.priority > 0 && (<Badge tone="warning" size="sm" icon={<Zap className="size-2.5"/>}>
                  P{provider.priority}
                </Badge>)}
            </div>
            <p className="text-[11px] text-fg-muted truncate">{provider.baseUrl ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleFavorite && (<Button size="icon-sm" variant="ghost" onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(provider.id);
            }} aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}>
              {isFavorite ? (<Star className="size-3.5 text-warning fill-warning"/>) : (<StarOff className="size-3.5"/>)}
            </Button>)}
          <Button size="icon-sm" variant="ghost" aria-label="More">
            <MoreHorizontal className="size-3.5"/>
          </Button>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2 text-[11px] flex-wrap">
        <StatusPill status={healthStatus} size="sm" showDot pulse={false}/>
        {latency != null && (<span className="text-fg-subtle tabular-nums">{Math.round(latency)}ms</span>)}
        {provider.authType && (<Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5"/>}>
            {provider.authType}
          </Badge>)}
        {provider.capabilities?.length > 0 && (<Badge tone="muted" size="sm">
            {provider.capabilities.length} capabilities
          </Badge>)}
      </div>

      <div className="px-4 pb-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <Cpu className="size-3"/>
          <span>{provider.modelCount ?? provider.models?.length ?? 0} models</span>
        </div>
        {onTest && (<Button size="sm" variant="ghost" onClick={(e) => {
                e.stopPropagation();
                onTest(provider.id);
            }}>
            <Server className="size-3"/>
            Test
          </Button>)}
      </div>
    </Card>);
}
//# sourceMappingURL=ProviderCard.js.map