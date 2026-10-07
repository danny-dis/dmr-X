import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

const cache = vi.hoisted(() => ({
  checkRouteCache: vi.fn(), storeRouteCache: vi.fn(),
  semanticCacheService: { isEnabled: vi.fn(() => true), lookup: vi.fn(async () => null), store: vi.fn(async () => undefined) },
}));
vi.mock('@dmr-x/cache', () => cache);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const fixtureResponse = {
  id: 'fixture-cache-response', requestId: 'fixture-cache-request', modality: 'llm',
  providerId: 'fixture', model: 'fixture-model',
  message: { role: 'assistant', content: 'This is not JSON.' }, finishReason: 'stop',
  usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6 }, cost: { input: 0, output: 0, total: 0 }, latencyMs: 1,
};

async function fixture() {
  const app = Fastify();
  vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({ enabled: false, engine: 'rtk', reversible: false, minTokensToCompress: 1, proxyUrl: 'http://127.0.0.1:8899' });
  const correct = { ...fixtureResponse, message: { role: 'assistant', content: '{"ok":true}' } };
  const route = vi.fn(async () => ({ response: correct, plan: { primary: { providerId: 'fixture', modelId: 'fixture-model', score: 1 }, chain: [] } }));
  app.decorate('router', { route } as any);
  cache.checkRouteCache.mockReturnValue({ response: fixtureResponse, tokensSaved: 0 });
  await app.register(chatRoutes);
  return { app, route };
}

describe('cache output acceptance and routing policy', () => {
  it('rejects a cached response that violates requested JSON mode', async () => {
    const { app, route } = await fixture();
    try {
      const reply = await app.inject({ method: 'POST', url: '/chat/completions', payload: { model: 'fixture-model', messages: [{ role: 'user', content: 'Return JSON.' }], response_format: { type: 'json_object' } } });
      expect(reply.statusCode).toBe(200);
      expect(route).toHaveBeenCalledOnce();
      expect(JSON.parse(reply.json().choices[0].message.content)).toEqual({ ok: true });
    } finally { await app.close(); }
  });
  it('scopes cache identity to effective quality controls', async () => {
    const { app } = await fixture();
    try {
      const reply = await app.inject({ method: 'POST', url: '/chat/completions', headers: { 'x-quality-target': 'frontier' }, payload: { model: 'fixture-model', messages: [{ role: 'user', content: 'A cached response.' }] } });
      expect(reply.statusCode).toBe(200);
      const identityBody = cache.checkRouteCache.mock.calls.at(-1)?.[2] as Record<string, any>;
      expect(identityBody.metadata.__dmrxRoutingPolicy.qualityTarget).toBe('frontier');
    } finally { await app.close(); }
  });
});
