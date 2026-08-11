import { EventEmitter } from 'node:events';

import { trace, type Span } from '@opentelemetry/api';
import { logger } from '@dmr-x/utils';

/**
 * Resolve the active OpenTelemetry span's trace/span id. Returns nulls when
 * no SDK provider is registered or no span is active on the current async
 * context.
 */
export function getActiveTraceContext(): { traceId: string | null; spanId: string | null } {
  try {
    const span = trace.getActiveSpan() as Span | undefined;
    if (!span) return { traceId: null, spanId: null };
    const ctx = span.spanContext();
    if (!ctx || ctx.traceId === '00000000000000000000000000000000') {
      return { traceId: null, spanId: null };
    }
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  } catch {
    return { traceId: null, spanId: null };
  }
}

// ---------------------------------------------------------------------------
// Telemetry events (in-memory ring buffer + push-based SSE)
// ---------------------------------------------------------------------------

export const telemetryEvents = new EventEmitter();
telemetryEvents.setMaxListeners(100); // up to 100 concurrent SSE subscribers

export const telemetryBuffer: Array<{
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  trace_id: string | null;
  span_id: string | null;
  duration: number | null;
  metadata: Record<string, unknown>;
}> = [];

const MAX_TELEMETRY_EVENTS = 1000;

export function trimTelemetryBuffer(): void {
  while (telemetryBuffer.length > MAX_TELEMETRY_EVENTS) {
    telemetryBuffer.shift();
  }
}

/**
 * Publish a telemetry event. Appends to the in-memory buffer (trimmed to
 * MAX_TELEMETRY_EVENTS) and emits to all live SSE subscribers.
 *
 * Call sites: any code that wants to surface a real-time event in the
 * admin dashboard (e.g. request failures, auth failures, provider
 * health changes, etc.).
 */
export function recordTelemetryEvent(event: {
  id?: string;
  level?: string;
  service?: string;
  message: string;
  trace_id?: string | null;
  span_id?: string | null;
  duration?: number | null;
  metadata?: Record<string, unknown>;
}): void {
  const explicitTraceId = event.trace_id;
  const explicitSpanId = event.span_id;
  let activeTraceId: string | null = null;
  let activeSpanId: string | null = null;
  if (explicitTraceId === null || explicitTraceId === undefined ||
      explicitSpanId === null || explicitSpanId === undefined) {
    const active = getActiveTraceContext();
    activeTraceId = active.traceId;
    activeSpanId = active.spanId;
  }
  const enriched = {
    id: event.id ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: event.level ?? 'info',
    service: event.service ?? 'gateway',
    message: event.message,
    trace_id: explicitTraceId ?? activeTraceId,
    span_id: explicitSpanId ?? activeSpanId,
    duration: event.duration ?? null,
    metadata: event.metadata ?? {},
  };
  telemetryBuffer.push(enriched);
  trimTelemetryBuffer();
  telemetryEvents.emit('event', enriched);
}

// ---------------------------------------------------------------------------
// Dashboard stats stream
// ---------------------------------------------------------------------------

export const dashboardStatsEvents = new EventEmitter();
dashboardStatsEvents.setMaxListeners(50);

/** Publish a dashboard stats update (called after significant events). */
export function publishDashboardStatsUpdate(stats: Record<string, unknown>): void {
  dashboardStatsEvents.emit('stats', stats);
}

let computeDashboardStatsFn: (() => Record<string, unknown>) | null = null;

/**
 * The throttled dashboard publisher needs the admin routes' closure-local
 * `computeDashboardStats`. admin.routes calls this once during registration
 * to feed it in; the publisher itself lives here so it can be decorated on
 * the ROOT server and reached from every plugin.
 */
export function registerDashboardStatsComputer(
  compute: () => Record<string, unknown>
): void {
  computeDashboardStatsFn = compute;
}

let lastStatsPublish = 0;

/**
 * Recompute and broadcast dashboard stats, at most once a second. No-ops
 * when nobody is listening; coalesces bursts into one recompute per second
 * (the stat block is six aggregate queries).
 */
export function publishDashboardStatsThrottled(): void {
  if (dashboardStatsEvents.listenerCount('stats') === 0) return;

  const now = Date.now();
  if (now - lastStatsPublish < 1000) return;
  lastStatsPublish = now;

  try {
    if (computeDashboardStatsFn) {
      publishDashboardStatsUpdate(computeDashboardStatsFn());
    }
  } catch (err) {
    logger.warn({ err }, 'Dashboard stats publish failed');
  }
}
