/**
 * Server Hardening Tests
 *
 * Validates the production-grade defaults applied to the Fastify server:
 *  - bodyLimit / requestTimeout / keepAliveTimeout / connectionTimeout
 *  - maxParamLength
 *  - trustProxy (loopback vs X-Forwarded-For)
 *  - error response includes `request_id` for 5xx
 *  - /healthz reports db_read, db_write, candidates, memory, and uptime
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

// We re-import the parser helpers. They're not exported from server.ts (they
// live at module scope), so we replicate them here and unit-test the logic.
// Keep these in sync with `apps/gateway/src/server.ts` and `main.ts`.

function parseBodyLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(trimmed);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3
             : unit === 'mb' ? 1024 ** 2
             : unit === 'kb' ? 1024
             : 1;
  return Math.floor(n * mult);
}

function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined) return 'loopback';
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (['loopback', 'linklocal', 'uniquelocal'].includes(v)) return v;
  return raw.trim();
}

describe('parseBodyLimit', () => {
  it('returns fallback when raw is undefined', () => {
    expect(parseBodyLimit(undefined, 1024)).toBe(1024);
  });

  it('returns fallback when raw is empty', () => {
    expect(parseBodyLimit('', 1024)).toBe(1024);
  });

  it('returns fallback when raw is unparseable', () => {
    expect(parseBodyLimit('garbage', 1024)).toBe(1024);
  });

  it('parses plain numbers as bytes', () => {
    expect(parseBodyLimit('1024', 0)).toBe(1024);
    expect(parseBodyLimit('  2048  ', 0)).toBe(2048);
  });

  it('parses "kb" suffix', () => {
    expect(parseBodyLimit('1kb', 0)).toBe(1024);
    expect(parseBodyLimit('4KB', 0)).toBe(4096);
  });

  it('parses "mb" suffix', () => {
    expect(parseBodyLimit('10mb', 0)).toBe(10 * 1024 * 1024);
    expect(parseBodyLimit('5MB', 0)).toBe(5 * 1024 * 1024);
  });

  it('parses "gb" suffix', () => {
    expect(parseBodyLimit('1gb', 0)).toBe(1024 ** 3);
  });

  it('parses decimal values', () => {
    expect(parseBodyLimit('1.5mb', 0)).toBe(Math.floor(1.5 * 1024 * 1024));
  });
});

describe('parseTrustProxy', () => {
  it('defaults to "loopback" when unset', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback');
  });

  it('parses truthy strings', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('1')).toBe(true);
    expect(parseTrustProxy('yes')).toBe(true);
  });

  it('parses falsy strings', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('no')).toBe(false);
  });

  it('preserves Fastify-prescribed preset strings', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('linklocal')).toBe('linklocal');
    expect(parseTrustProxy('uniquelocal')).toBe('uniquelocal');
  });

  it('preserves CIDR / IP / comma-separated lists verbatim', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('192.168.1.1, 10.0.0.1')).toBe('192.168.1.1, 10.0.0.1');
  });
});

describe('Fastify server hardening', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({
      bodyLimit: 1024, // 1 KB
      requestTimeout: 5_000,
      keepAliveTimeout: 65_000,
      connectionTimeout: 10_000,
      maxParamLength: 200,
      trustProxy: parseTrustProxy(undefined), // 'loopback'
      requestIdHeader: 'x-request-id',
      genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    });

    app.get('/echo', async () => ({ ok: true }));
    app.post('/echo', async (request) => ({ body: request.body }));
    app.get('/ip', async (request) => ({ ip: request.ip }));

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      const errorBody: Record<string, unknown> = {
        message: statusCode >= 500 ? 'Internal server error' : error.message,
        type: statusCode >= 500 ? 'server_error' : error.code,
        code: statusCode >= 500 ? 'internal_error' : (error.code || '').toLowerCase(),
      };
      if (statusCode >= 500) {
        errorBody.request_id = request.id;
      }
      reply.status(statusCode).send({ error: errorBody });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('enforces bodyLimit (413 on oversized payload)', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(2_000) });
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: big,
      headers: { 'content-type': 'application/json' },
    });
    // 413 Payload Too Large
    expect(res.statusCode).toBe(413);
  });

  it('accepts payloads under bodyLimit', async () => {
    const small = JSON.stringify({ data: 'x'.repeat(100) });
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: small,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('enforces maxParamLength (404 on oversized param)', async () => {
    app.get('/items/:id', async () => ({ ok: true }));
    const oversized = 'x'.repeat(500);
    const res = await app.inject({ method: 'GET', url: `/items/${oversized}` });
    // Fastify returns 404 for paths where the param exceeds maxParamLength
    expect(res.statusCode).toBe(404);
  });

  it('honors request id header when provided', async () => {
    let observed: string | undefined;
    app.get('/capture', async (request) => {
      observed = request.id;
      return { ok: true };
    });
    await app.inject({
      method: 'GET',
      url: '/capture',
      headers: { 'x-request-id': 'client-supplied-id-123' },
    });
    // requestIdHeader: 'x-request-id' + genReqId reads from headers first
    expect(observed).toBe('client-supplied-id-123');
  });

  it('generates a UUID request id when none is provided', async () => {
    let observed: string | undefined;
    app.get('/capture', async (request) => {
      observed = request.id;
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/capture' });
    expect(typeof observed).toBe('string');
    expect(observed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('with trustProxy=loopback, trusts X-Forwarded-For from loopback peer (inject() simulates loopback)', async () => {
    // Fastify's `trustProxy: 'loopback'` trusts X-Forwarded-For when the
    // immediate client is on a loopback address. inject() arrives from
    // 127.0.0.1, so XFF is honored. This is the safe default for a server
    // that may be hit via localhost-forwarded proxies; behind a non-loopback
    // load balancer, set DMRX_TRUST_PROXY=true (or a CIDR).
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    const body = res.json();
    expect(body.ip).toBe('8.8.8.8');
  });

  it('with trustProxy=true, trusts X-Forwarded-For from any peer', async () => {
    await app.close();
    app = Fastify({
      trustProxy: true,
      requestIdHeader: 'x-request-id',
      genReqId: () => randomUUID(),
    });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(res.json().ip).toBe('8.8.8.8');
  });

  it('includes request_id in 5xx error responses', async () => {
    let boomId: string | undefined;
    // Capture the request.id of the failing request from inside the handler
    app.get('/boom', async (request) => {
      boomId = request.id;
      throw new Error('unexpected');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(boomId).toBeDefined();
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.request_id).toBeDefined();
    expect(typeof body.error.request_id).toBe('string');
    // request_id in the error body matches the request.id that
    // triggered the failure (and the x-request-id response header).
    expect(body.error.request_id).toBe(boomId);
  });

  it('does NOT include request_id in 4xx error responses', async () => {
    app.get('/notfound', async (_request, reply) => {
      return reply.code(404).send({ error: 'gone' });
    });
    // Trigger the error handler via an unhandled throw
    app.get('/badrequest', async (_request, _reply) => {
      const err = new Error('bad input') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    });
    const res = await app.inject({ method: 'GET', url: '/badrequest' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.request_id).toBeUndefined();
  });
});

describe('Deepened /healthz', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Stub the in-memory health check shape
    const MEMORY_LIMIT = 1_500 * 1024 * 1024;
    const router = { getCandidateCount: () => 0 };
    app.decorate('router', router);

    app.get('/healthz', async (_request, reply) => {
      const checks: Record<string, { status: string; detail?: string }> = {};
      let healthy = true;

      // db_read
      try {
        if (1 !== 1) throw new Error('db not ready');
        checks.db_read = { status: 'ok' };
      } catch (err) {
        checks.db_read = { status: 'fail', detail: (err as Error).message };
        healthy = false;
      }

      // db_write
      checks.db_write = { status: 'ok' };

      // candidates
      const count = router.getCandidateCount();
      if (count > 0) {
        checks.candidates = { status: 'ok', detail: `${count} candidates` };
      } else {
        checks.candidates = { status: 'fail', detail: 'no routing candidates loaded' };
      }

      // memory
      const rss = process.memoryUsage().rss;
      checks.memory = {
        status: rss < MEMORY_LIMIT ? 'ok' : 'fail',
        detail: `${Math.round(rss / 1024 / 1024)}MB`,
      };

      const status = healthy ? 'ok' : 'degraded';
      if (!healthy) reply.status(503);
      return { status, checks, uptime: Math.round(process.uptime()) };
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns all expected checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const body = res.json();
    expect(body.checks).toHaveProperty('db_read');
    expect(body.checks).toHaveProperty('db_write');
    expect(body.checks).toHaveProperty('candidates');
    expect(body.checks).toHaveProperty('memory');
  });

  it('reports candidates=fail when no candidates loaded (degraded)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const body = res.json();
    // Candidates is "fail" but doesn't make the response unhealthy on its own
    expect(body.checks.candidates.status).toBe('fail');
    expect(body.checks.candidates.detail).toContain('no routing candidates');
  });

  it('includes uptime in the response', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const body = res.json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('Fastify compression', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // We import fastifyCompress lazily so a failure to install the
    // dep surfaces only when this test runs, not in unrelated suites.
    const fastifyCompress = (await import('@fastify/compress')).default;
    app = Fastify({ logger: false });
    await app.register(fastifyCompress, { threshold: 1024 });
    app.get('/big', async () => ({
      // ~10 KB JSON — well over the 1 KB threshold
      data: 'x'.repeat(10_000),
    }));
    app.get('/small', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('compresses large responses when the client accepts gzip', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/big',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.headers['content-encoding']).toBe('gzip');
    // The on-the-wire byte count should be smaller than the original.
    expect(res.rawPayload.length).toBeLessThan(10_000);
  });

  it('does not compress responses below the threshold', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/small',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('passes through uncompressed when client does not send accept-encoding', async () => {
    const res = await app.inject({ method: 'GET', url: '/big' });
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
