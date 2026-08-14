import type { FastifyInstance } from 'fastify';
import { trace, SpanStatusCode, SpanKind, propagation, context, type Span } from '@opentelemetry/api';
import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';
import { tracer, contentCaptureService } from '@dmr-x/telemetry';
import { billingService } from '@dmr-x/billing';

/**
 * Cached free/paid classification, keyed `providerId:modelId`.
 *
 * The live token counters need to attribute each request to a tier, but this
 * runs on every response — a classification query per request would put a read
 * on the hot path for data that changes only when an operator reclassifies a
 * model. Entries expire so a reclassification is picked up without a restart.
 */
const tierCache = new Map<string, { tier: 'free' | 'paid'; at: number }>();
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;

function resolveTier(providerId: string, modelId: string): 'free' | 'paid' {
  const key = `${providerId}:${modelId}`;
  const cached = tierCache.get(key);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) return cached.tier;

  let tier: 'free' | 'paid' = 'paid';
  try {
    const row = getDb()
      .prepare(
        `SELECT has_free_tier, verified_free, pricingTier
           FROM model_classifications
          WHERE provider_id = ? AND model_id = ?`,
      )
      .get(providerId, modelId) as
      | { has_free_tier?: number; verified_free?: number; pricingTier?: string }
      | undefined;

    if (
      row &&
      (row.has_free_tier === 1 ||
        row.verified_free === 1 ||
        row.pricingTier === 'free' ||
        row.pricingTier === 'free_with_limits')
    ) {
      tier = 'free';
    }
  } catch {
    // Unclassified or unreadable: default to 'paid'. Under-reporting savings
    // is the safe direction — claiming a paid model was free is not.
  }

  tierCache.set(key, { tier, at: Date.now() });
  return tier;
}

export function registerTelemetryHooks(server: FastifyInstance, telemetry: any): void {
  // Telemetry: record request count + latency per request, token usage
  // and errors when the route handler populated `request.metrics`.
  // Route handlers can set:
  //   (request as any).metrics = {
  //     providerId, modelId, modality,
  //     tokens?: { prompt, completion, total, costUsd? },
  //     errorCode?: string,    // present if the request errored
  //     tenantId?: string,     // CRIT-6: tenant for request_logs row
  //     taskProfile?: string,  // CRIT-6: routing decision audit trail
  //     routingPlan?: {        // CRIT-6: top-3 candidates considered
  //       primary: { providerId, modelId, score },
  //       candidates: Array<{ providerId, modelId, score }>,
  //     },
  //     firstTokenLatencyMs?: number, // CRIT-6: optional TTFT for streaming
  //   }
  // The hook is fire-and-forget — telemetry must never break the request.
  // CRIT-6: a row is also inserted into `request_logs` so the bandit
  // reward-updater can learn across restarts. The write is wrapped in the
  // existing try/catch — a write failure logs a warning and continues.
  // OpenTelemetry: end the root `http.request` span, record the response
  // status / latency, and surface 5xx as span errors so trace UIs can
  // highlight them. This is the second half of the pair started in
  // the onRequest hook above.
  server.addHook('onResponse', async (request, reply) => {
    const span = (request as any).openTelemetrySpan as Span | undefined;
    try {
      const metrics = (request as any).metrics as
        | {
            providerId?: string;
            modelId?: string;
            modality?: string;
            tokens?: {
              prompt: number;
              completion: number;
              total: number;
              costUsd?: number;
            };
            errorCode?: string;
            tenantId?: string;
            taskProfile?: string;
            routingPlan?: {
              primary?: { providerId: string; modelId: string; score?: number };
              candidates?: Array<{ providerId: string; modelId: string; score?: number }>;
            };
            firstTokenLatencyMs?: number;
            qualityTarget?: string;
            freeTierStrategy?: string;
          }
        | undefined;
      if (metrics?.providerId && metrics.modelId) {
        const statusCode = reply.statusCode;
        const latencyMs = Date.now() - ((request as any).startTime ?? Date.now());

        telemetry.recordRequest({
          providerId: metrics.providerId,
          modelId: metrics.modelId,
          modality: metrics.modality ?? 'unknown',
          statusCode,
        });
        telemetry.recordLatency({
          providerId: metrics.providerId,
          modelId: metrics.modelId,
          modality: metrics.modality ?? 'unknown',
          latencyMs,
        });
        if (metrics.errorCode) {
          telemetry.recordError({
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            modality: metrics.modality ?? 'unknown',
            errorCode: metrics.errorCode,
          });
        }
        if (metrics.tokens) {
          telemetry.recordTokens({
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            promptTokens: metrics.tokens.prompt,
            completionTokens: metrics.tokens.completion,
            totalTokens: metrics.tokens.total,
            costUsd: metrics.tokens.costUsd,
          });
        }

        // Tag the OTel span with the routing outcome so a trace shows
        // which provider the gateway picked for this request.
        if (span) {
          span.setAttribute('router.selected_provider', metrics.providerId);
          span.setAttribute('router.selected_model', metrics.modelId);
          if (metrics.modality) span.setAttribute('router.modality', metrics.modality);
        }

        // CRIT-6: write a row to `request_logs` so the bandit reward-updater
        // (services/router/src/bandit/reward-updater.ts:198) has data to
        // compute per-provider reward signals. The table was added in the
        // v0.2.0 schema but never populated — this closes the loop.
        //
        // The write is single-row, prepared-statement, no transaction. With
        // the 50ms debounced save in packages/db/src/client.ts, burst writes
        // batch into a single disk write.
        try {
          const requestLogsDb = getDb();
          const id = crypto.randomUUID();
          const fallbackUsed = (metrics.routingPlan?.candidates?.length ?? 0) > 1 ? 1 : 0;
          // Top-3 candidates only — keep the row narrow.
          const candidatesTop3 = (metrics.routingPlan?.candidates ?? []).slice(0, 3);
          const routingPlanJson = metrics.routingPlan
            ? JSON.stringify({
                primary: metrics.routingPlan.primary,
                candidates: candidatesTop3,
              })
            : null;
          requestLogsDb.prepare(
            `INSERT INTO request_logs (
              id, request_id, tenant_id, timestamp,
              task_profile, routing_plan, selected_provider, selected_model,
              fallback_used, fallback_reason,
              latency_ms, time_to_first_token_ms, tokens_input, tokens_output,
              estimated_cost, error_code, error_message,
              quality_target, free_tier_strategy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            request.id,
            metrics.tenantId ?? null,
            new Date().toISOString(),
            metrics.taskProfile ?? null,
            routingPlanJson,
            metrics.providerId,
            metrics.modelId,
            fallbackUsed,
            null,
            latencyMs,
            metrics.firstTokenLatencyMs ?? null,
            metrics.tokens?.prompt ?? null,
            metrics.tokens?.completion ?? null,
            metrics.tokens?.costUsd ?? null,
            metrics.errorCode ?? null,
            null,
            metrics.qualityTarget ?? null,
            metrics.freeTierStrategy ?? null,
          );

          // Persist billing usage so /v1/admin/billing/usage-history and the
          // Routing page traffic-composition chart have data. Best-effort —
          // failures must never break the request (same policy as above).
          try {
            await billingService.recordUsage({
              tenantId: metrics.tenantId ?? 'default',
              providerId: metrics.providerId,
              modelId: metrics.modelId,
              inputTokens: metrics.tokens?.prompt ?? 0,
              outputTokens: metrics.tokens?.completion ?? 0,
              requestId: request.id,
            });
          } catch (usageErr) {
            logger.warn({ err: usageErr, requestId: request.id }, 'usage_records write failed');
          }

          // Two distinct frames go out on the dashboard stream, discriminated
          // by `type`:
          //
          //  1. `usage_delta` — this one request's tokens/cost, so the live
          //     counters on the Free Tier and Models pages can increment
          //     without re-polling. Carries `tier` because "cost is zero" is
          //     not proof a model is free (an unpriced paid model also logs
          //     zero); the classification lookup is what decides.
          //
          //  2. `stats` — the recomputed dashboard stat block, throttled to
          //     1/s. Previously this stream only ever carried the per-request
          //     frame, so a client expecting the stat block received a payload
          //     it could not parse and rendered nothing.
          const publishStats = (server as any).publishDashboardStatsUpdate;
          if (publishStats) {
            publishStats({
              type: 'usage_delta',
              tier: resolveTier(metrics.providerId, metrics.modelId),
              provider: metrics.providerId,
              model: metrics.modelId,
              latency_ms: latencyMs,
              tokens_in: metrics.tokens?.prompt ?? 0,
              tokens_out: metrics.tokens?.completion ?? 0,
              tokens: (metrics.tokens?.prompt ?? 0) + (metrics.tokens?.completion ?? 0),
              cost: metrics.tokens?.costUsd ?? 0,
              error: !!metrics.errorCode,
              timestamp: new Date().toISOString(),
            });
          }

          (server as any).publishDashboardStatsThrottled?.();
        } catch (writeErr) {
          // Persistence failures must never break the request. The debounced
          // save will retry the export on the next batch, so a single bad
          // row is fine.
          logger.warn({ err: writeErr, requestId: request.id }, 'request_logs write failed');
        }

        // Populate `usage_records` — the billing ledger the Dashboard's
        // "Cost (24h)" tile and request-volume chart read from. `request_logs`
        // above is the routing/audit trail (CRIT-6); this is a separate table
        // and `billingService.recordUsage` (services/billing/src/billing.service.ts)
        // had no caller anywhere in the request lifecycle, so it stayed empty
        // no matter how many requests were logged. Independent try/catch from
        // the request_logs write above so neither can block the other, and
        // guarded on `tenantId` being present up front — `usage_records.tenant_id`
        // is `NOT NULL REFERENCES tenants(id)` and sql.js rejects an `undefined`
        // binding outright, so an absent tenant skips the write instead of
        // throwing here.
        if (metrics.tenantId && metrics.tokens) {
          try {
            await billingService.recordUsage({
              tenantId: metrics.tenantId,
              providerId: metrics.providerId,
              modelId: metrics.modelId,
              inputTokens: metrics.tokens.prompt ?? 0,
              outputTokens: metrics.tokens.completion ?? 0,
              requestId: request.id,
            });
          } catch (usageErr) {
            logger.warn({ err: usageErr, requestId: request.id }, 'usage_records write failed');
          }
        }

        // Surface the completed request on the Requests page live stream.
        // Fires once per HTTP request (not per fallback attempt) for every
        // path that populates `request.metrics` — chat, tools, moderation,
        // and agentic. Explicit per-route emissions (error paths etc.) carry
        // richer metadata; this generic frame guarantees every real model
        // call shows up on the dashboard.
        try {
          (server as any).recordTelemetryEvent?.({
            level: metrics.errorCode ? 'error' : 'info',
            service: 'gateway',
            message: metrics.errorCode
              ? `Request failed: ${metrics.errorCode}`
              : 'Request completed',
            metadata: {
              path: request.url,
              requestId: request.id,
              providerId: metrics.providerId,
              modelId: metrics.modelId,
              statusCode,
              latencyMs,
              tokens: (metrics.tokens?.prompt ?? 0) + (metrics.tokens?.completion ?? 0),
              error: metrics.errorCode ?? null,
            },
          });
        } catch (telemetryErr) {
          logger.debug({ err: telemetryErr }, 'telemetry event emission failed');
        }
      }

        // Content capture: record the call event for ML-ready streaming
        if (contentCaptureService.isEnabled()) {
          contentCaptureService.record({
            type: 'llm_call',
            providerId: metrics.providerId,
            modelId: metrics.modelId,
            requestId: request.id,
            inputTokens: metrics.tokens?.prompt,
            outputTokens: metrics.tokens?.completion,
            latencyMs,
            statusCode,
            error: metrics.errorCode,
          });
        }
      }
    } catch (err) {
      // Telemetry failures must never affect the request
      logger.debug({ err }, 'telemetry onResponse hook failed');
    } finally {
      if (span) {
        try {
          const statusCode = reply.statusCode;
          span.setAttribute('http.status_code', statusCode);
          const latencyMs = Date.now() - ((request as any).startTime ?? Date.now());
          span.setAttribute('http.duration_ms', latencyMs);
          if (statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
        } catch (err) {
          // Span manipulation must never break the request either
          logger.debug({ err }, 'otel onResponse span finalisation failed');
        } finally {
          span.end();
        }
      }
    }
  });

  // OpenTelemetry: stamp start time on every request AND start the
  // root `http.request` span. The span is the parent of every downstream
  // span (router.*, adapter.fetch) emitted for this request — without it,
  // the OTel SDK receives a tree of disconnected spans.
  //
  // We honour an incoming W3C `traceparent` header so this gateway can
  // participate in a trace that was started upstream (e.g. by a frontend
  // SDK, a service mesh sidecar, or another DMR-X gateway in a federation).
  // The propagation.extract call is a no-op when no `traceparent` is
  // present, so it is always safe.
  server.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();

    // Pull the W3C context out of the inbound headers (if any) so the
    // span we are about to start uses the upstream trace id.
    const parentCtx = propagation.extract(context.active(), request.headers);
    const span = tracer.startSpan(
      'http.request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': request.method,
          'http.target': request.url,
          'url.path': request.url.split('?')[0],
          'url.scheme': (request.headers['x-forwarded-proto'] as string) || 'http',
          'http.host': (request.headers['host'] as string) || 'unknown',
          'server.address': (request.headers['host'] as string) || 'unknown',
          'request.id': request.id,
        },
      },
      parentCtx,
    );
    // Stash the span on the request so route handlers + the onResponse
    // hook can attach attributes and end it. We don't call
    // `startActiveSpan` here because Fastify already has its own async
    // context that would be lost across route boundaries.
    (request as any).openTelemetrySpan = span;
    (request as any).openTelemetryContext = trace.setSpan(parentCtx, span);
  });
}
