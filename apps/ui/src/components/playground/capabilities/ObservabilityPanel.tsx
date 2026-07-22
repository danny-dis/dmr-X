import * as React from 'react';
import { Activity, DollarSign, Clock, RefreshCw, Zap } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { Badge, Button, StatTile } from '@/components/primitives';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, PanelError, PanelLoading, useAsync } from './PanelShell';

interface Decision {
  id?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
  cost_usd?: number;
  cost?: number;
  status?: number;
  fallback?: boolean;
  chosenAt?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export function ObservabilityPanel({ tab }: { tab: CapabilityTab }) {
  const decisions = useAsync<Decision[]>(() => Admin.listRouteDecisions() as unknown as Promise<Decision[]>, []);
  const [auto, setAuto] = React.useState(true);

  React.useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => decisions.refetch(), 4000);
    return () => clearInterval(t);
  }, [auto, decisions.refetch]);

  const list = Array.isArray(decisions.data) ? (decisions.data as Decision[]) : [];
  const sorted = [...list].sort((a, b) => {
    const ta = new Date(b.chosenAt ?? b.createdAt ?? 0).getTime();
    const tb = new Date(a.chosenAt ?? a.createdAt ?? 0).getTime();
    return ta - tb;
  });

  const totalCost = sorted.reduce((sum, d) => sum + (Number(d.cost_usd ?? d.cost ?? 0) || 0), 0);
  const avgLatency = sorted.length
    ? sorted.reduce((sum, d) => sum + (Number(d.latency_ms ?? 0) || 0), 0) / sorted.length
    : 0;
  const fallbackCount = sorted.filter((d) => d.fallback).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<DollarSign className="size-4" />} label="Total cost" value={`$${totalCost.toFixed(4)}`} hint={`${sorted.length} requests`} />
        <StatTile icon={<Clock className="size-4" />} label="Avg latency" value={`${avgLatency.toFixed(0)} ms`} />
        <StatTile icon={<Zap className="size-4" />} label="Fallbacks" value={String(fallbackCount)} tone={fallbackCount ? 'warning' : 'default'} />
        <StatTile icon={<Activity className="size-4" />} label="Live" value={auto ? 'on' : 'off'} tone={auto ? 'success' : 'accent'} />
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Request stream {sorted.length ? <Badge tone="muted" size="sm" variant="soft">{sorted.length}</Badge> : null}</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={auto ? 'secondary' : 'ghost'} onClick={() => setAuto((v) => !v)}>{auto ? 'Live' : 'Paused'}</Button>
          <Button size="sm" variant="ghost" onClick={decisions.refetch}><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {decisions.loading ? <PanelLoading /> : decisions.error ? <PanelError error={decisions.error} /> : sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border"><EmptyHint>No requests yet — send traffic (Chat, Agents, Routing) to populate the stream.</EmptyHint></div>
        ) : (
          <div className="space-y-1.5">
            {sorted.map((d, i) => (
              <div key={d.id ?? i} className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs">
                <Badge tone="info" size="sm" variant="soft">{d.provider ?? '—'}</Badge>
                <span className="font-mono text-fg">{d.model ?? '—'}</span>
                <span className="ml-auto font-mono text-fg-muted">{typeof d.latency_ms === 'number' ? `${d.latency_ms}ms` : ''}</span>
                <span className="font-mono text-fg-muted">${(Number(d.cost_usd ?? d.cost ?? 0) || 0).toFixed(5)}</span>
                {d.fallback ? <Badge tone="warning" size="sm" variant="soft">fb</Badge> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
