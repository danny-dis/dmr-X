import type { FastifyInstance } from 'fastify';

/**
 * SIEM forwarding middleware (compliance layer, runtime feature).
 *
 * When DMRX_SIEM_URL is set, every completed response is mirrored to the SIEM
 * endpoint as a structured audit event. The forward is FIRE-AND-FORGET: it does
 * not await the request lifecycle, never throws, and never blocks the response.
 * Failure to deliver (network error, timeout, non-2xx) is silently swallowed so
 * that a misbehaving SIEM collector can never take the gateway down with it.
 *
 * When DMRX_SIEM_URL is unset, this is a pure no-op.
 */

// 2s delivery budget. SIEM ingestion must be fast; if it is not, we drop the
// event rather than stall the gateway's event loop with dangling promises.
const SIEM_TIMEOUT_MS = 2_000;

interface SiemAuditEvent {
  ts: string;
  method: string;
  url: string;
  statusCode: number;
  tenantId: string | undefined;
  ip: string;
  userAgent: string | undefined;
}

export function registerSiemForwarding(server: FastifyInstance): void {
  const siemUrl = process.env.DMRX_SIEM_URL;
  if (!siemUrl) {
    // No-op: compliance layer's SIEM forward is disabled by default and only
    // active when an operator explicitly configures DMRX_SIEM_URL.
    return;
  }

  // onResponse fires after the response has been sent to the client, so the
  // forward below can never delay or affect the response itself.
  server.addHook('onResponse', (_request, reply, done) => {
    const request = _request as any;

    const event: SiemAuditEvent = {
      ts: new Date().toISOString(),
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      tenantId: request.tenant?.id,
      ip: request.ip,
      userAgent: request.headers?.['user-agent'],
    };

    // Fire-and-forget. We deliberately do NOT await this. The .catch swallows
    // any rejection so an unhandled rejection can never bubble up.
    void forwardToSiem(siemUrl, event).catch(() => {
      // Intentionally empty — silent drop on delivery failure.
    });

    done();
  });
}

function forwardToSiem(url: string, event: SiemAuditEvent): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIEM_TIMEOUT_MS);
  // Don't keep the event loop alive solely for a SIEM callback.
  timer.unref?.();

  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}
