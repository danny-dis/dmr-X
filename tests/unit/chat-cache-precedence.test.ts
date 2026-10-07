import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

const state = vi.hoisted(() => ({
  exact: vi.fn(), enabled: vi.fn(() => true), lookup: vi.fn(async () => null), store: vi.fn(async () => {}),
}));
vi.mock('@dmr-x/cache', () => ({
  semanticCacheService: { isEnabled: state.enabled, lookup: state.lookup, store: state.store },
  checkRouteCache: state.exact,
  storeRouteCache: vi.fn(),
}));
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('exact-first chat caching', () => {
  it('returns an exact hit without touching the semantic provider or router', async () => {
    vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({
      enabled: false, reversible: false, minTokensToCompress: 1, proxyUrl: 'http://localhost:8787',
    });
    vi.spyOn(compressionService, 'getTenantConfig').mockReturnValue(null);
    state.exact.mockReturnValue({ response: {
      modality: 'llm', modelId: 'fixture-model', providerId: 'fixture-provider', finishReason: 'stop',
      message: { role: 'assistant', content: 'The exact cached answer.' },
    } });
    const app = Fastify({ logger: false });
    apps.push(app);
    const route = vi.fn();
    app.decorate('router', { route });
    await app.register(chatRoutes);
    const result = await app.inject({ method: 'POST', url: '/chat/completions', payload: {
      model: 'auto', messages: [{ role: 'user', content: 'Explain this cached deployment decision.' }],
    } });
    expect(result.statusCode).toBe(200);
    expect(result.json().choices[0].message.content).toBe('The exact cached answer.');
    expect(result.headers['x-cache']).toBe('HIT');
    expect(state.exact).toHaveBeenCalledTimes(1);
    expect(state.enabled).not.toHaveBeenCalled();
    expect(state.lookup).not.toHaveBeenCalled();
    expect(state.store).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
  });
});
