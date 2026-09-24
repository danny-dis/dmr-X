import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { routeDecisionRoutes } from '../../apps/gateway/src/routes/route.routes.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
});

const payload = { model: 'auto', temperature: 0, messages: [{ role: 'user', content: 'route-body-policy-test' }] };

describe('gateway cost filter input', () => {
  it.each(['/chat/completions', '/route'])(
    '%s reads body costFilter and lets the header override it', async (path) => {
      const app = Fastify({ logger: false });
      apps.push(app);
      const route = vi.fn(async () => ({
        plan: { primary: { providerId: 'free-provider', modelId: 'test-model', score: 1 }, chain: [], timeoutMs: 30000, maxRetries: 1 },
        response: { modality: 'llm', providerId: 'free-provider', modelId: 'test-model', message: { role: 'assistant', content: 'OK' } },
      }));
      app.decorate('router', { route });
      await app.register(path === '/route' ? routeDecisionRoutes : chatRoutes);

      const bodyOnly = await app.inject({ method: 'POST', url: path, payload: { ...payload, costFilter: 'free' } });
      expect(bodyOnly.statusCode).toBe(200);
      expect(route).toHaveBeenLastCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ costFilter: 'free' }) }),
        expect.anything(),
      );

      const header = await app.inject({
        method: 'POST', url: path, payload: { ...payload, costFilter: 'free' },
        headers: { 'x-cost-filter': 'all' },
      });
      expect(header.statusCode).toBe(200);
      expect(route).toHaveBeenLastCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ costFilter: 'all' }) }),
        expect.anything(),
      );
    },
  );
});
