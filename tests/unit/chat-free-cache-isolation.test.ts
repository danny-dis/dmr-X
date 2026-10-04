import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { semanticCacheService } from '@dmr-x/cache';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('chat cache routing policy', () => {
  it('does not reuse or overwrite default exact and semantic caches for free-only requests', async () => {
    const semanticEnabled = vi.spyOn(semanticCacheService, 'isEnabled').mockReturnValue(false);
    const app = Fastify({ logger: false });
    apps.push(app);
    const route = vi.fn(async (request: { metadata?: { costFilter?: string } }) => {
      const free = request.metadata?.costFilter === 'free';
      return {
        plan: {
          primary: { providerId: free ? 'free-provider' : 'paid-provider', modelId: 'model', score: 1 },
          chain: [],
        },
        response: {
          modality: 'llm',
          providerId: free ? 'free-provider' : 'paid-provider',
          modelId: 'model',
          message: { role: 'assistant', content: free ? 'free answer' : 'paid answer' },
        },
      };
    });
    app.decorate('router', { route });
    await app.register(chatRoutes);

    const payload = { model: 'auto', messages: [{ role: 'user', content: `cache isolation ${crypto.randomUUID()}` }] };
    const inject = (headers: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/chat/completions', payload, headers });

    const paid = await inject();
    expect(paid.statusCode).toBe(200);
    expect(paid.json().choices[0].message.content).toBe('paid answer');
    expect(paid.headers['x-cache']).toBe('MISS');

    const free = await inject({ 'x-cost-filter': 'free' });
    expect(free.statusCode).toBe(200);
    expect(free.json().choices[0].message.content).toBe('free answer');
    expect(free.headers['x-cache']).toBeUndefined();
    expect(route).toHaveBeenCalledTimes(2);

    semanticEnabled.mockReturnValue(true);
    const store = vi.spyOn(semanticCacheService, 'store');
    const lookup = vi.spyOn(semanticCacheService, 'lookup').mockResolvedValue({
      similarity: 1,
      entry: { response: { modelId: 'model', message: { role: 'assistant', content: 'paid answer' } } },
    } as never);
    const freeAgain = await inject({ 'x-cost-filter': 'free' });
    expect(freeAgain.json().choices[0].message.content).toBe('free answer');
    expect(freeAgain.headers['x-cache']).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledTimes(3);

    semanticEnabled.mockReturnValue(false);
    const paidAgain = await inject();
    expect(paidAgain.json().choices[0].message.content).toBe('paid answer');
    expect(paidAgain.headers['x-cache']).toBe('HIT');
    expect(route).toHaveBeenCalledTimes(3);
  });
});
