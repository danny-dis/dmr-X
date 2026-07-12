/**
 * LearningStats — minimal EMA learning loop viewer for G0DM0D3 feedback.
 *
 * Polls GET /v1/godmode/feedback/stats and renders the returned EMA /
 * count state. Keep it minimal but real — no fabricated numbers.
 */

import { Activity, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { fetchAuthenticated } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface FeedbackStats {
  total?: number;
  positive?: number;
  negative?: number;
  ema_score?: number; // 0..1 exponential moving average of (rating)
  ema_positive_rate?: number;
  by_context?: Record<string, number>;
  [key: string]: unknown;
}

export function LearningStats({ refreshKey }: { refreshKey?: number }) {
  const [stats, setStats] = React.useState<FeedbackStats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuthenticated('/v1/godmode/feedback/stats');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed: ${res.status}`);
      }
      const data = (await res.json().catch(() => ({}))) as FeedbackStats;
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const ema = stats?.ema_score ?? stats?.ema_positive_rate;
  const emaPct = typeof ema === 'number' ? Math.round(ema * 100) : null;

  return (
    <Card padding="md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2">
            <Activity className="size-3.5 text-primary" />
            Learning Stats
          </CardTitle>
          <Button size="icon-sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-xs text-danger">{error}</p>}
        {!error && !stats && !loading && (
          <p className="text-xs text-fg-muted">No feedback data yet.</p>
        )}
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Total" value={stats.total ?? 0} icon={<Activity className="size-3.5" />} />
              <StatTile
                label="EMA score"
                value={emaPct !== null ? `${emaPct}%` : '—'}
                icon={<Activity className="size-3.5" />}
                tone="primary"
              />
              <StatTile label="Positive" value={stats.positive ?? 0} tone="success" icon={<Activity className="size-3.5" />} />
              <StatTile label="Negative" value={stats.negative ?? 0} tone="danger" icon={<Activity className="size-3.5" />} />
            </div>
            {stats.by_context && Object.keys(stats.by_context).length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] text-fg-muted">By context type</div>
                {Object.entries(stats.by_context).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-xs">
                    <span className="text-fg">{k}</span>
                    <span className="text-fg-muted">{Number(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
