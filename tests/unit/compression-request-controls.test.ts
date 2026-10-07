import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressionService } from '../../apps/gateway/src/services/compression.js';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.restoreAllMocks(); });

async function fixture(globalEnabled = false, keyEnabled?: boolean) {
  vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({ enabled: globalEnabled, reversible: false, engine: 'caveman', minTokensToCompress: 1, proxyUrl: 'http://localhost:8787' });
  vi.spyOn(compressionService, 'getTenantConfig').mockReturnValue(null);
  const getKey = vi.spyOn(compressionService, 'getApiKeyConfig').mockReturnValue(keyEnabled === undefined ? null : { enabled: keyEnabled });
  const compress = vi.spyOn(compressionService, 'compressPrompt').mockImplementation(async messages => ({ compressed: messages, metadata: { originalTokens: 1, compressedTokens: 1, saved: 0, algorithmUsed: 'fixture' } }));
  const app = Fastify(); apps.push(app);
  app.addHook('onRequest', async request => { (request as any).tenant = { id: 'tenant-control', apiKeyId: 'key-control' }; });
  app.decorate('router', { route: vi.fn(async () => ({ plan: { primary: { providerId: 'fixture', modelId: 'fixture' }, chain: [] }, response: { modality: 'llm', modelId: 'fixture', message: { role: 'assistant', content: 'Complete fixture answer.' }, finishReason: 'stop', usage: { total_tokens: 1 } } })) });
  await app.register(chatRoutes);
  const send = (compression?: string) => app.inject({ method: 'POST', url: '/chat/completions', headers: compression === undefined ? {} : { 'x-compression': compression }, payload: { model: 'auto', messages: [{ role: 'user', content: 'current intent' }] } });
  return { compress, getKey, send };
}

describe('effective request compression controls', () => {
  it('inherits a global enabled configuration for authenticated requests', async () => {
    const { compress, send } = await fixture(true);
    expect((await send()).statusCode).toBe(200);
    expect(compress).toHaveBeenCalledTimes(1);
  });
  it('reads the authenticated API-key scope rather than an absent top-level property', async () => {
    const { getKey, send } = await fixture(false, true);
    expect((await send()).statusCode).toBe(200);
    expect(getKey).toHaveBeenCalledWith('key-control');
  });
  it('allows an explicit per-request disable without rewriting context', async () => {
    const { compress, send } = await fixture(true, true);
    expect((await send('off')).statusCode).toBe(200);
    expect(compress).not.toHaveBeenCalled();
  });
  it('lets a validated engine override take precedence over key defaults', async () => {
    const { compress, send } = await fixture(false, false);
    expect((await send('rtk')).statusCode).toBe(200);
    expect(compress).toHaveBeenCalledWith(expect.any(Array), null, { enabled: true, engine: 'rtk' }, { tenantId: 'tenant-control', apiKeyId: 'key-control' });
  });
  it('rejects an unknown engine instead of silently using a different algorithm', async () => {
    const { compress, send } = await fixture(false);
    expect((await send('not-a-supported-engine')).statusCode).toBe(400);
    expect(compress).not.toHaveBeenCalled();
  });
});
