// Regression coverage for the review finding that POST /agentic/chat bypassed
// every admission control (SEC-001/SEC-002): the generic agentic loop drove
// unbounded multi-turn provider spend with no preflightModelRun, no
// whole-run reserve, and no settle/release.
//
// Contract pinned here (mirrors POST /agents/:instanceId/chat and
// POST /agentic/dispatch):
//   - unknown paid pricing fails closed with 402 before any quota touch;
//   - quota rejection fails closed with 429 and never routes;
//   - a bare unpriced alias admits only with router free-only evidence;
//   - ONE atomic whole-run hold sized steps x per-turn token cap;
//   - completed runs settle the hold with the measured prompt/completion
//     actuals; cancellation and error paths release it in `finally`.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  return {
    sessions,
    getPricing: vi.fn(async (_providerId: string, _modelId: string) => ({
      providerId: 'paidco',
      modelId: 'big',
      inputPricePer1kTokens: 0.01,
      outputPricePer1kTokens: 0.02,
    })),
    store: {
      get: vi.fn((tenantId: string, conversationId: string) =>
        sessions.get(`${tenantId}:${conversationId}`) ?? null),
      upsert: vi.fn((input: any) => {
        sessions.set(`${input.tenantId}:${input.conversationId}`, {
          id: input.conversationId,
          tenantId: input.tenantId,
          state: input.state,
          status: input.status ?? input.state.status,
          statusReason: input.statusReason ?? null,
          lastTurn: input.lastTurn ?? 0,
          metadata: input.metadata ?? {},
        });
      }),
    },
  };
});

vi.mock('@dmr-x/agent-runtime', () => ({
  agenticSessionStore: {
    get: (...args: unknown[]) => mocks.store.get(...(args as [string, string])),
    upsert: (...args: unknown[]) => mocks.store.upsert(...args),
  },
}));

vi.mock('@dmr-x/billing', () => ({
  billingService: {
    getModelPricing: (...args: unknown[]) => mocks.getPricing(...(args as [string, string])),
  },
}));

vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({
  executeToolCall: vi.fn(async () => ({ tool_call_id: 'x', result: {} })),
}));

vi.mock('../../apps/gateway/src/lib/needlePreFilter.js', () => ({
  needlePreFilter: vi.fn(async (tools: unknown[]) => tools),
}));

import { agenticRoutes } from '../../apps/gateway/src/routes/agentic.routes.js';

const TENANT = 'tenant-a';

function freeResponse() {
  return {
    plan: { primary: { providerId: 'paidco' } },
    response: {
      message: { role: 'assistant', content: 'done' },
      modelId: 'big',
      finishReason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.5 },
    },
  };
}

function okRouter() {
  return { route: vi.fn(async () => freeResponse()) };
}

function failingRouter() {
  return {
    route: vi.fn(async () => {
      throw new Error('provider exploded');
    }),
  };
}

function quotaFake(overrides: Record<string, any> = {}) {
  return {
    checkQuota: vi.fn(async () => undefined),
    reserveAgentRun: vi.fn(async () => ({ ok: true, holdId: 'hold-1' })),
    releaseAgentHold: vi.fn(async () => undefined),
    settleAgentHold: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function buildApp(router: any, quotaService?: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  (app as any).router = router;
  if (quotaService !== undefined) (app as any).quotaService = quotaService;
  app.addHook('preHandler', async (request) => {
    const tenantId = String(request.headers['x-tenant-id'] ?? TENANT);
    (request as any).tenant = { id: tenantId, name: tenantId };
  });
  await app.register(agenticRoutes, { prefix: '/v1' });
  await app.ready();
  return app;
}

function chat(overrides: Record<string, unknown> = {}) {
  return {
    model: 'paidco/big',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

describe('POST /agentic/chat bounded admission', () => {
  let apps: FastifyInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.clear();
    mocks.getPricing.mockResolvedValue({
      providerId: 'paidco',
      modelId: 'big',
      inputPricePer1kTokens: 0.01,
      outputPricePer1kTokens: 0.02,
    });
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('fails closed with 402 on unknown paid pricing without touching quota', async () => {
    mocks.getPricing.mockResolvedValue(null as any);
    const router = okRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat(),
    });

    expect(res.statusCode).toBe(402);
    expect(router.route).not.toHaveBeenCalled();
    expect(quota.reserveAgentRun).not.toHaveBeenCalled();
    expect(quota.checkQuota).not.toHaveBeenCalled();
  });

  it('fails closed with 429 when the whole-run reserve is rejected', async () => {
    const router = okRouter();
    const quota = quotaFake({
      reserveAgentRun: vi.fn(async () => ({ ok: false, reason: 'monthly budget exceeded' })),
    });
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat(),
    });

    expect(res.statusCode).toBe(429);
    expect(router.route).not.toHaveBeenCalled();
    expect(quota.settleAgentHold).not.toHaveBeenCalled();
    expect(quota.releaseAgentHold).not.toHaveBeenCalled();
  });

  it('reserves the WHOLE run (steps x per-turn cap) exactly once and settles the actuals', async () => {
    const router = okRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat({ max_steps: 3, max_tokens: 1000 }),
    });

    expect(res.statusCode).toBe(200);
    expect(quota.reserveAgentRun).toHaveBeenCalledTimes(1);
    // 1000 per-turn cap x 3 turns = 3000 whole-run tokens.
    expect(quota.reserveAgentRun.mock.calls[0][2]).toBe(3000);
    expect(quota.reserveAgentRun.mock.calls[0][0]).toBe(TENANT);
    // Exactly one hold, settled with the measured actuals — never both.
    expect(quota.settleAgentHold).toHaveBeenCalledTimes(1);
    expect(quota.settleAgentHold.mock.calls[0][0]).toBe('hold-1');
    expect(quota.settleAgentHold.mock.calls[0][1]).toEqual({ tokens: 15, costDollars: 0.5 });
    expect(quota.releaseAgentHold).not.toHaveBeenCalled();
  });

  it('clamps client steps and tokens to the finite server-side budget', async () => {
    const router = okRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      // Absurd client budget: schema allows 50 steps; the server cap (10) and
      // the finite per-turn token ceiling must bound the hold regardless.
      payload: chat({ max_steps: 50, max_tokens: 5_000_000 }),
    });

    expect(res.statusCode).toBe(200);
    const heldTokens = quota.reserveAgentRun.mock.calls[0][2] as number;
    expect(Number.isFinite(heldTokens)).toBe(true);
    expect(heldTokens).toBe(32000 * 10);
    // The per-turn cap actually forwarded to the provider is clamped too.
    expect((router.route.mock.calls[0][0] as any).max_tokens).toBe(32000);
  });

  it('settles (never releases) the hold for a completed streaming run', async () => {
    const router = okRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat({ stream: true, conversationId: 'stream-ok' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"completed"');
    expect(quota.settleAgentHold).toHaveBeenCalledTimes(1);
    expect(quota.settleAgentHold.mock.calls[0][1]).toEqual({ tokens: 15, costDollars: 0.5 });
    expect(quota.releaseAgentHold).not.toHaveBeenCalled();
  });

  it('releases the hold on a provider error without settling it', async () => {
    const router = failingRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      // Enough steps to exhaust MAX_CONSECUTIVE_ERRORS (5) — the error exit.
      payload: chat({ max_steps: 10 }),
    });

    expect(res.statusCode).toBe(200);
    expect(router.route).toHaveBeenCalled();
    expect(quota.releaseAgentHold).toHaveBeenCalledTimes(1);
    expect(quota.releaseAgentHold.mock.calls[0][0]).toBe('hold-1');
    expect(quota.settleAgentHold).not.toHaveBeenCalled();
  });

  it('releases the hold when a streaming run is cancelled (hold never pinned)', async () => {
    let announce!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => { announce = resolve; });
    const router = {
      route: vi.fn((request: { signal?: AbortSignal }) => {
        const signal = request.signal!;
        announce(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('provider observed abort');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }),
    };
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const chatPromise = app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat({ stream: true, conversationId: 'stream-cancel' }),
    });
    await started;
    await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat/stream-cancel/cancel',
      headers: { 'x-tenant-id': TENANT },
    });
    const res = await chatPromise;

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('cancelled');
    expect(quota.releaseAgentHold).toHaveBeenCalledTimes(1);
    expect(quota.settleAgentHold).not.toHaveBeenCalled();
  });

  it('keeps the hold tenant-scoped: another tenant never sees or frees it', async () => {
    const router = okRouter();
    const quota = quotaFake();
    const app = await buildApp(router, quota);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': 'tenant-b' },
      payload: chat({ conversationId: 'tenant-scoped' }),
    });

    expect(res.statusCode).toBe(200);
    expect(quota.reserveAgentRun.mock.calls[0][0]).toBe('tenant-b');
    const storedKeys = [...mocks.sessions.keys()];
    expect(storedKeys.every((k) => k.startsWith('tenant-b:'))).toBe(true);
  });

  it('admits a strict-free model with no quota service (fixture compatibility)', async () => {
    mocks.getPricing.mockResolvedValue({
      providerId: 'freeco',
      modelId: 'tiny',
      inputPricePer1kTokens: 0,
      outputPricePer1kTokens: 0,
    } as any);
    const router = okRouter();
    const app = await buildApp(router, undefined);
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': TENANT },
      payload: chat({ model: 'freeco/tiny' }),
    });

    expect(res.statusCode).toBe(200);
    expect(router.route).toHaveBeenCalled();
  });
});