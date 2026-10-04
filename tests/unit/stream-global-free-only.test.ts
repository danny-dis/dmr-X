import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Router } from '../../services/router/src/router.service.js';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

/**
 * Candidate pool holding one free and one paid provider. The paid candidate is
 * healthy, so absent the free-only policy the streaming augmentation step would
 * happily append it to the chain.
 */
function mixedCandidates() {
  return [
    { providerId: 'free-provider', modelId: 'free-model', isHealthy: true, score: 1 },
    { providerId: 'paid-provider', modelId: 'paid-model', isHealthy: true, score: 0.9, pricingTier: 'paid' },
  ];
}

/**
 * Streaming harness: a real Fastify app wired to `chatRoutes` where the free
 * adapter always fails. Every attempted adapter call is recorded, so a policy
 * regression that leaks the paid candidate into the chain shows up as a
 * recorded attempt rather than only as response-body text.
 */
async function streamAgainst(router: Router, headers: Record<string, string> = {}) {
  router.setCandidates(mixedCandidates() as never);
  vi.spyOn(router, 'route').mockResolvedValue({
    plan: {
      primary: { providerId: 'free-provider', modelId: 'free-model', adapterType: 'openai', score: 1 },
      chain: [],
      timeoutMs: 30000,
      maxRetries: 1,
    },
  } as never);

  const attempted: string[] = [];
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('router', router);
  app.decorate('getAdapter', (providerId: string) => ({
    executeStream: async function* () {
      attempted.push(providerId);
      if (providerId === 'free-provider') throw new Error('free provider unavailable');
      yield { type: 'token', data: { content: 'paid response' } };
      yield { type: 'done' };
    },
  }));
  await app.register(chatRoutes);

  const response = await app.inject({
    method: 'POST',
    url: '/chat/completions',
    headers,
    payload: { model: 'auto', messages: [{ role: 'user', content: 'Hello' }], stream: true },
  });
  return { attempted, response };
}

describe('streaming fallback augmentation vs. router default free_only', () => {
  it('never reaches a paid candidate when the router is configured free_only', async () => {
    const { attempted, response } = await streamAgainst(new Router({ freeTierStrategy: 'free_only' }));

    expect(response.statusCode).toBe(200);
    expect(attempted).toEqual(['free-provider']);
    expect(attempted).not.toContain('paid-provider');
    expect(response.body).not.toContain('paid response');
  });

  it('still falls back to a paid candidate for an unconstrained all-cost router', async () => {
    const { attempted, response } = await streamAgainst(new Router());

    expect(response.statusCode).toBe(200);
    expect(attempted).toEqual(['free-provider', 'paid-provider']);
    expect(response.body).toContain('paid response');
  });

  it('honours a per-request override that relaxes the free_only default', async () => {
    const { attempted, response } = await streamAgainst(new Router({ freeTierStrategy: 'free_only' }), {
      'x-free-tier-strategy': 'prioritize',
    });

    expect(response.statusCode).toBe(200);
    expect(attempted).toEqual(['free-provider', 'paid-provider']);
  });

  it('keeps the free_only default strict when the request keeps all-cost semantics', async () => {
    const { attempted, response } = await streamAgainst(new Router({ freeTierStrategy: 'free_only' }), {
      'x-cost-filter': 'all',
    });

    expect(response.statusCode).toBe(200);
    expect(attempted).toEqual(['free-provider']);
  });
});

describe('Router.getEffectiveFreeTierStrategy', () => {
  it('falls back to the configured default when no request override is given', () => {
    expect(new Router({ freeTierStrategy: 'free_only' }).getEffectiveFreeTierStrategy()).toBe('free_only');
    expect(new Router().getEffectiveFreeTierStrategy()).toBeUndefined();
    expect(new Router().getEffectiveFreeTierStrategy(undefined)).toBeUndefined();
  });

  it('prefers the per-request override over the configured default', () => {
    const router = new Router({ freeTierStrategy: 'free_only' });
    expect(router.getEffectiveFreeTierStrategy('prioritize')).toBe('prioritize');
    expect(router.getEffectiveFreeTierStrategy('fallback')).toBe('fallback');
    expect(new Router().getEffectiveFreeTierStrategy('free_only')).toBe('free_only');
  });

  it('ignores an empty override so the configured default still applies', () => {
    expect(new Router({ freeTierStrategy: 'free_only' }).getEffectiveFreeTierStrategy('' as never)).toBe('free_only');
  });
});