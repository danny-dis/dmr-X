import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  return {
    sessions,
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
  };
});

vi.mock('@dmr-x/agent-runtime', () => ({
  agenticSessionStore: {
    get: (...args: unknown[]) => mocks.get(...args as [string, string]),
    upsert: (...args: unknown[]) => mocks.upsert(...args),
  },
}));

vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({
  executeToolCall: vi.fn(),
}));

vi.mock('../../apps/gateway/src/lib/needlePreFilter.js', () => ({
  needlePreFilter: vi.fn(async (tools: unknown[]) => tools),
}));

import { agenticRoutes } from '../../apps/gateway/src/routes/agentic.routes.js';

interface DelayedRoute {
  router: { route: ReturnType<typeof vi.fn> };
  started: Promise<AbortSignal>;
}

function delayedRouter(): DelayedRoute {
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
  return { router, started };
}

async function buildApp(router: DelayedRoute['router']): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  (app as any).router = router;
  app.addHook('preHandler', async (request) => {
    const tenantId = String(request.headers['x-tenant-id'] ?? 'tenant-a');
    (request as any).tenant = { id: tenantId, name: tenantId };
  });
  await app.register(agenticRoutes, { prefix: '/v1' });
  await app.ready();
  return app;
}

function chatPayload(conversationId: string, stream: boolean) {
  return {
    model: 'free-test-model',
    messages: [{ role: 'user', content: 'wait for cancellation' }],
    conversationId,
    stream,
  };
}

describe('agentic in-flight cancellation', () => {
  let apps: FastifyInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.clear();
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it.each([
    { stream: false, label: 'non-streaming' },
    { stream: true, label: 'streaming' },
  ])('aborts the active $label provider request and persists cancelled as terminal', async ({ stream }) => {
    const delayed = delayedRouter();
    const app = await buildApp(delayed.router);
    apps.push(app);
    const conversationId = `cancel-${stream ? 'stream' : 'plain'}`;

    const chatResponsePromise = app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': 'tenant-a' },
      payload: chatPayload(conversationId, stream),
    });
    const providerSignal = await delayed.started;

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/v1/agentic/chat/${conversationId}/cancel`,
      headers: { 'x-tenant-id': 'tenant-a' },
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toEqual({ status: 'cancelled', conversationId });
    expect(providerSignal.aborted).toBe(true);

    const chatResponse = await chatResponsePromise;
    expect(chatResponse.statusCode).toBe(200);
    if (stream) {
      expect(chatResponse.body).toContain('"status":"cancelled"');
    } else {
      expect(chatResponse.json()).toMatchObject({ status: 'cancelled', conversationId });
    }

    const persisted = mocks.sessions.get(`tenant-a:${conversationId}`);
    expect(persisted).toMatchObject({
      tenantId: 'tenant-a',
      status: 'cancelled',
      statusReason: 'cancelled',
      state: { id: conversationId, status: 'cancelled' },
    });
    expect(mocks.upsert.mock.calls.some(([input]) => input.status === 'completed' || input.status === 'error')).toBe(false);
  });

  it('does not let another tenant cancel a conversation with the same id', async () => {
    const delayed = delayedRouter();
    const app = await buildApp(delayed.router);
    apps.push(app);
    const conversationId = 'shared-id';

    const chatResponsePromise = app.inject({
      method: 'POST',
      url: '/v1/agentic/chat',
      headers: { 'x-tenant-id': 'tenant-a' },
      payload: chatPayload(conversationId, false),
    });
    const providerSignal = await delayed.started;

    const crossTenantCancel = await app.inject({
      method: 'POST',
      url: `/v1/agentic/chat/${conversationId}/cancel`,
      headers: { 'x-tenant-id': 'tenant-b' },
    });

    expect(crossTenantCancel.statusCode).toBe(404);
    expect(providerSignal.aborted).toBe(false);

    const ownerCancel = await app.inject({
      method: 'POST',
      url: `/v1/agentic/chat/${conversationId}/cancel`,
      headers: { 'x-tenant-id': 'tenant-a' },
    });
    expect(ownerCancel.statusCode).toBe(200);
    expect(providerSignal.aborted).toBe(true);
    await chatResponsePromise;
  });
});
