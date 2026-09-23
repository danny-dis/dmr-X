import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';

describe('streaming free-only fallback', () => {
  it.each([
    ['free', undefined, false],
    ['auto', 'free', false],
    ['auto', undefined, true],
  ])('applies stream fallback policy for model %s with cost filter %s', async (model, costFilter, allowPaidFallback) => {
    const app = Fastify({ logger: false });
    const attempted: string[] = [];
    app.decorate('router', {
      route: async () => ({
        plan: {
          primary: { providerId: 'free-provider', modelId: 'free-model', adapterType: 'openai', score: 1 },
          chain: [], timeoutMs: 30000, maxRetries: 1,
        },
      }),
      getCandidates: () => [
        { providerId: 'free-provider', modelId: 'free-model', isHealthy: true, score: 1 },
        { providerId: 'paid-provider', modelId: 'paid-model', isHealthy: true, score: 1, pricingTier: 'paid' },
      ],
    });
    app.decorate('getAdapter', (providerId: string) => ({
      executeStream: async function* () {
        attempted.push(providerId);
        if (providerId === 'free-provider') throw new Error('free provider unavailable');
        yield { type: 'token', data: { content: 'paid response' } };
        yield { type: 'done' };
      },
    }));
    await app.register(chatRoutes);
    try {
      const response = await app.inject({
        method: 'POST', url: '/chat/completions',
        headers: costFilter ? { 'x-cost-filter': costFilter } : {},
        payload: { model, messages: [{ role: 'user', content: 'Hello' }], stream: true },
      });
      expect(response.statusCode).toBe(200);
      expect(attempted).toEqual(allowPaidFallback
        ? ['free-provider', 'paid-provider'] : ['free-provider']);
      expect(response.body.includes('paid response')).toBe(allowPaidFallback);
    } finally {
      await app.close();
    }
  });
});
