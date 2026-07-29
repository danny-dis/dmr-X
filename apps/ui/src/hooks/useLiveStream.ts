import { useEffect } from 'react';

import { subscribeSSE } from '@/lib/sse';
import { useLiveStore } from '@/store/useLiveStore';

/**
 * Subscribe the app to the gateway's live streams.
 *
 * Mounted once in the shell. Two streams, one store:
 *
 *  - `/admin/dashboard/stream` carries two frame types discriminated by
 *    `type`: `stats` (the recomputed stat block) and `usage_delta` (one
 *    completed request, which drives the token counters).
 *  - `/admin/telemetry/stream` carries the event log.
 *
 * Both previously authenticated by putting the token in the query string,
 * which the gateway never read — so they 401'd outside LOCAL_MODE and the UI
 * fell back to polling. `subscribeSSE` sends a real Authorization header.
 */
export function useLiveStream(): void {
  const setConnection = useLiveStore((s) => s.setConnection);
  const setStats = useLiveStore((s) => s.setStats);
  const pushDelta = useLiveStore((s) => s.pushDelta);
  const pushTelemetry = useLiveStore((s) => s.pushTelemetry);

  useEffect(() => {
    const unsubscribeDashboard = subscribeSSE(
      '/admin/dashboard/stream',
      {
        onStatus: setConnection,
        onFrame: (frame) => {
          let payload: any;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            return; // heartbeat or malformed frame
          }

          if (payload?.type === 'usage_delta') {
            pushDelta({
              tier: payload.tier === 'free' ? 'free' : 'paid',
              provider: payload.provider ?? '',
              model: payload.model ?? '',
              tokensIn: Number(payload.tokens_in ?? 0),
              tokensOut: Number(payload.tokens_out ?? 0),
              costUsd: Number(payload.cost ?? 0),
              latencyMs: Number(payload.latency_ms ?? 0),
              error: !!payload.error,
              at: Date.now(),
            });
            return;
          }

          // The stat block has no `type` field — it is the plain snapshot the
          // stream sends on connect and on each throttled recompute.
          if (payload && typeof payload.total_requests === 'number') {
            setStats(payload);
          }
        },
      },
    );

    const unsubscribeTelemetry = subscribeSSE('/admin/telemetry/stream', {
      onFrame: (frame) => {
        try {
          pushTelemetry(JSON.parse(frame.data));
        } catch {
          // heartbeat
        }
      },
    });

    return () => {
      unsubscribeDashboard();
      unsubscribeTelemetry();
    };
  }, [setConnection, setStats, pushDelta, pushTelemetry]);
}
