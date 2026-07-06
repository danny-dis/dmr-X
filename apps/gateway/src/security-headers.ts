import type { FastifyInstance } from 'fastify';
import { type Span } from '@opentelemetry/api';
import { logger } from '@dmr-x/utils';
import { LOCAL_MODE } from './middleware/auth.middleware.js';

export function registerSecurity(server: FastifyInstance): void {
  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // NOTE: 'unsafe-inline' in script-src is required for OAuth callback pages
    // (admin.routes.ts) that use inline scripts to close popup windows.
    // A future improvement would be to use nonce-based CSP with per-request nonces.
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: *; connect-src 'self'"
    );
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // Error handler — must be set BEFORE server.register(...) so that the
  // custom shape (`{ error: { message, type, code } }`) is captured by
  // child contexts. Setting it after register means the child context
  // (admin, chat, etc.) keeps Fastify's default shape
  // (`{ statusCode, code, error: "Bad Request", message }`), which the
  // UI surfaces as the unhelpful string "Bad Request".
  server.setErrorHandler((error, request, reply) => {
    // fastify 5 typed the error parameter as `unknown` (it was `FastifyError`
    // in v4). Cast to any to preserve the previous access pattern — the
    // existing `error.statusCode / error.code / error.message / error.stack`
    // shape is unchanged at runtime, so this is a TS-only adjustment.
    const err = error as any;
    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';

    // OpenTelemetry: record the exception on the active span (started in
    // the onRequest hook) so the trace UI can show the failure mode.
    // Don't crash the request if span manipulation itself fails.
    try {
      const span = (request as any).openTelemetrySpan as Span | undefined;
      if (span && span.isRecording()) {
        span.recordException(err);
        span.setAttribute('error.type', code);
        span.setAttribute('error.message', err.message);
      }
    } catch {
      // swallow — telemetry must never break the error path
    }

    // Always log full error server-side (with request id so logs and
    // client payloads are correlatable)
    logger.error(
      { err, req: request, requestId: request.id },
      `Request error: ${err.message}`,
    );

    // For 500+ errors, hide all internal details from clients — unless
    // we're in dev / local-mode, where we surface the real message so
    // the UI toast and gateway log line up while debugging. CRIT-2:
    // LOCAL_MODE is the frozen module-level constant — re-reading
    // process.env here would re-introduce the live-bypass vulnerability
    // that the constant was added to prevent.
    const isDev = LOCAL_MODE || process.env.NODE_ENV !== 'production';
    const clientMessage = statusCode >= 500 && !isDev ? 'Internal server error' : err.message;
    const clientType = statusCode >= 500 && !isDev ? 'server_error' : code;

    const errorBody: Record<string, unknown> = {
      message: clientMessage,
      type: clientType,
      code: statusCode >= 500 && !isDev ? 'internal_error' : code.toLowerCase(),
    };

    // For 5xx, include the request id so users can quote it in support
    // tickets (matches the pattern used by Stripe, GitHub, Cloudflare).
    // The x-request-id response header carries the same value.
    if (statusCode >= 500) {
      errorBody.request_id = request.id;
      if (isDev) {
        // Dev-only: surface the real error so the UI toast and pino log
        // line up. Production keeps `error.message` out of the wire.
        errorBody.dev_message = err.message;
        errorBody.dev_stack = err.stack;
      }

      // Surface 5xx to the live telemetry SSE stream so the observability
      // dashboard can show them in real time. Uses optional chaining so
      // tests / alternate builds without the publish function still work.
      (server as any).recordTelemetryEvent?.({
        level: 'error',
        service: 'gateway',
        message: err.message,
        metadata: {
          path: request.url,
          method: request.method,
          statusCode,
          requestId: request.id,
        },
      });
    }

    reply.status(statusCode).send({ error: errorBody });
  });
}
