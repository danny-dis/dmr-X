import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressionService } from '../../apps/gateway/src/services/compression.js';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { anthropicRoutes } from '../../apps/gateway/src/routes/anthropic.routes.js';
import { geminiRoutes } from '../../apps/gateway/src/routes/gemini.routes.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
});

describe('compression preserves provider wire context', () => {
  const cases = [
    {
      name: 'OpenAI image and tool context', plugin: chatRoutes, url: '/chat/completions',
      payload: { model: 'auto', tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }], messages: [
        { role: 'system', content: 'In the event that approval is missing, do not deploy.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
        { role: 'tool', content: 'actually failed', tool_call_id: 'call-1' },
        { role: 'user', content: [{ type: 'text', text: 'Explain.' }, { type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] },
      ] },
    },
    {
      name: 'Anthropic tool blocks', plugin: anthropicRoutes, url: '/messages',
      payload: { model: 'auto', max_tokens: 128, messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'lookup', input: { id: 'actually' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'actually failed' }, { type: 'text', text: 'Explain the failure.' }] },
      ] },
    },
    {
      name: 'Gemini image and function parts', plugin: geminiRoutes, url: '/gemini/generateContent',
      payload: { contents: [
        { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { id: 'actually' } } }] },
        { role: 'function', parts: [{ functionResponse: { name: 'lookup', response: { status: 'actually failed' } } }] },
        { role: 'user', parts: [{ text: 'Describe this.' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] },
      ] },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const tenant = vi.spyOn(compressionService, 'getTenantConfig').mockReturnValue({ enabled: false });
      vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({ enabled: false, engine: 'caveman', reversible: false, minTokensToCompress: 1, proxyUrl: 'http://localhost:8787' });
      const app = Fastify({ logger: false });
      apps.push(app);
      app.addHook('preHandler', async request => { (request as any).tenant = { id: 'compression-test' }; });
      const received: any[] = [];
      app.decorate('router', { route: vi.fn(async request => {
        received.push(structuredClone(request));
        return { plan: { primary: { providerId: 'fixture', modelId: 'fixture', score: 1 }, chain: [] }, response: {
          modality: 'llm', providerId: 'fixture', modelId: 'fixture', finishReason: 'stop',
          message: { role: 'assistant', content: 'A complete explanation.' },
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        } };
      }) });
      await app.register(testCase.plugin);
      const send = () => app.inject({ method: 'POST', url: testCase.url, payload: testCase.payload });
      expect((await send()).statusCode).toBe(200);
      tenant.mockReturnValue({ enabled: true });
      expect((await send()).statusCode).toBe(200);
      expect(received).toHaveLength(2);
      expect(received[1].messages).toEqual(received[0].messages);
      expect(received[1].tools).toEqual(received[0].tools);
    });
  }
});
