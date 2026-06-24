/**
 * Telemetry Integration Tests
 *
 * Verifies that the gateway's onResponse hook correctly records request
 * metrics, latency, tokens, and errors when route handlers populate
 * `request.metrics`.
 *
 * These tests use a stub `TelemetryService` so we don't depend on the
 * real OTel SDK or the underlying metrics registry — the wiring of
 * the hook to recordRequest/recordLatency/recordTokens/recordError is
 * what we're validating.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface RecordedCall {
  method: 'recordRequest' | 'recordLatency' | 'recordTokens' | 'recordError' | 'recordHealth';
  args: any;
}

function createStubTelemetry() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    isStarted: () => true,
    recordRequest: vi.fn((args: any) => calls.push({ method: 'recordRequest', args })),
    recordLatency: vi.fn((args: any) => calls.push({ method: 'recordLatency', args })),
    recordTokens: vi.fn((args: any) => calls.push({ method: 'recordTokens', args })),
    recordError: vi.fn((args: any) => calls.push({ method: 'recordError', args })),
    recordHealth: vi.fn((args: any) => calls.push({ method: 'recordHealth', args })),
    getHealthResponse: () => ({ status: 'ok', uptime: 1, providers: { total: 0, healthy: 0, unhealthy: 0 } }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function attachTelemetryHook(app: FastifyInstance, telemetry: ReturnType<typeof createStubTelemetry>) {
  app.decorate('telemetry', telemetry);

  // Mirror the real server's startTime stamp
  app.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      const metrics = (request as any).metrics as
        | {
            providerId?: string;
            modelId?: string;
            modality?: string;
            tokens?: { prompt: number; completion: number; total: number; costUsd?: number };
            errorCode?: string;
          }
        | undefined;
      if (!metrics?.providerId || !metrics.modelId) return;

      const statusCode = reply.statusCode;
      const latencyMs = Date.now() - ((request as any).startTime ?? Date.now());

      telemetry.recordRequest({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', statusCode });
      telemetry.recordLatency({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', latencyMs });
      if (metrics.errorCode) {
        telemetry.recordError({ providerId: metrics.providerId, modelId: metrics.modelId, modality: metrics.modality ?? 'unknown', errorCode: metrics.errorCode });
      }
      if (metrics.tokens) {
        telemetry.recordTokens({ providerId: metrics.providerId, modelId: metrics.modelId, promptTokens: metrics.tokens.prompt, completionTokens: metrics.tokens.completion, totalTokens: metrics.tokens.total, costUsd: metrics.tokens.costUsd });
      }
    } catch {
      // ignore
    }
  });
}

describe('Telemetry onResponse hook', () => {
  let app: FastifyInstance;
  let telemetry: ReturnType<typeof createStubTelemetry>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    telemetry = createStubTelemetry();
    attachTelemetryHook(app, telemetry);
  });

  afterEach(async () => {
    await app.close();
  });

  it('records request + latency when handler populates metrics', async () => {
    app.get('/route', async (request) => {
      (request as any).metrics = { providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' };
      return { ok: true };
    });
    const res = await app.inject({ method: 'GET', url: '/route' });
    expect(res.statusCode).toBe(200);

    const requestCall = telemetry.calls.find((c) => c.method === 'recordRequest');
    const latencyCall = telemetry.calls.find((c) => c.method === 'recordLatency');
    expect(requestCall).toBeDefined();
    expect(requestCall!.args).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o',
      modality: 'llm',
      statusCode: 200,
    });
    expect(latencyCall).toBeDefined();
    expect(latencyCall!.args.providerId).toBe('openai');
    expect(typeof latencyCall!.args.latencyMs).toBe('number');
    expect(latencyCall!.args.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records token usage when handler provides tokens', async () => {
    app.get('/route', async (request) => {
      (request as any).metrics = {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        modality: 'llm',
        tokens: { prompt: 100, completion: 50, total: 150, costUsd: 0.0023 },
      };
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/route' });

    const tokensCall = telemetry.calls.find((c) => c.method === 'recordTokens');
    expect(tokensCall).toBeDefined();
    expect(tokensCall!.args).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.0023,
    });
  });

  it('records error when handler sets errorCode', async () => {
    app.get('/route', async (request, reply) => {
      (request as any).metrics = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'llm',
        errorCode: 'rate_limit',
      };
      reply.status(429);
      return { error: 'rate limited' };
    });
    const res = await app.inject({ method: 'GET', url: '/route' });
    expect(res.statusCode).toBe(429);

    const errorCall = telemetry.calls.find((c) => c.method === 'recordError');
    const requestCall = telemetry.calls.find((c) => c.method === 'recordRequest');
    expect(errorCall).toBeDefined();
    expect(errorCall!.args).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o',
      modality: 'llm',
      errorCode: 'rate_limit',
    });
    // The request is still recorded (with 429 status), alongside the error
    expect(requestCall!.args.statusCode).toBe(429);
  });

  it('does NOT record anything when handler leaves metrics empty', async () => {
    app.get('/route', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/route' });
    expect(telemetry.calls).toHaveLength(0);
  });

  it('does NOT record when metrics lacks providerId', async () => {
    app.get('/route', async (request) => {
      (request as any).metrics = { modelId: 'gpt-4o' };
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/route' });
    expect(telemetry.calls).toHaveLength(0);
  });

  it('defaults modality to "unknown" when not provided', async () => {
    app.get('/route', async (request) => {
      (request as any).metrics = { providerId: 'openai', modelId: 'gpt-4o' };
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/route' });
    const requestCall = telemetry.calls.find((c) => c.method === 'recordRequest');
    expect(requestCall!.args.modality).toBe('unknown');
  });

  it('records every request that populates metrics exactly once', async () => {
    app.get('/route', async (request) => {
      (request as any).metrics = { providerId: 'openai', modelId: 'gpt-4o', modality: 'llm' };
      return { ok: true };
    });
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/route' });
    }
    const requestCalls = telemetry.calls.filter((c) => c.method === 'recordRequest');
    expect(requestCalls).toHaveLength(3);
  });
});
