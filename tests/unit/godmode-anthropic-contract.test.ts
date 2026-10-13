import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicRoutes } from '../../apps/gateway/src/routes/anthropic.routes.js';

vi.mock('../../apps/gateway/src/lib/godmode-guard.js', () => ({
  buildGodmodeWrapOrder: vi.fn(),
  ensureGodmodeProxy: vi.fn(),
  isGodmodeStrict: vi.fn(),
  wrapAutoFreeViaGodmode: vi.fn(),
}));
vi.mock('@dmr-x/godmode', () => ({ getGodmodeService: vi.fn() }));

import {
  buildGodmodeWrapOrder,
  ensureGodmodeProxy,
  isGodmodeStrict,
  wrapAutoFreeViaGodmode,
} from '../../apps/gateway/src/lib/godmode-guard.js';
import { getGodmodeService } from '@dmr-x/godmode';

const requestBody = (stream: boolean) => ({
  model: 'auto-free',
  max_tokens: 80,
  stream,
  system: [{ type: 'text', text: 'Keep code literal: `a+b`.' }],
  messages: [
    { role: 'user', content: 'Inspect this.' },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'call_exact', name: 'inspect', input: { path: 'a.ts' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_exact', content: [{ type: 'text', text: 'const x = 1;' }] }] },
  ],
  tools: [{ name: 'inspect', description: 'Read file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
  tool_choice: { type: 'tool', name: 'inspect' },
  temperature: 0.2,
  top_p: 0.8,
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('router', { getCandidates: () => [], route: vi.fn(async () => ({ plan: { primary: null } })) });
  app.decorate('getAdapter', () => undefined);
  await app.register(anthropicRoutes, { prefix: '/v1' });
  return app;
}

async function* streamOf(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DMRX_GODMODE_STRICT;
  vi.mocked(isGodmodeStrict).mockReturnValue(true);
  vi.mocked(buildGodmodeWrapOrder).mockReturnValue(['fixture-free-model']);
  vi.mocked(ensureGodmodeProxy).mockResolvedValue(true);
  vi.mocked(getGodmodeService).mockReturnValue({
    isInitialized: () => true,
    chatStreamFull: vi.fn(),
  } as any);
});

afterEach(() => vi.restoreAllMocks());

describe('Anthropic GODMODE /v1/messages contract', () => {
  it('passes system and structured tool-use/tool-result history to the wrapped completion', async () => {
    vi.mocked(wrapAutoFreeViaGodmode).mockResolvedValue({
      status: 'wrapped',
      wrapModel: 'fixture-free-model',
      completion: { id: 'msg_fixture', model: 'fixture-free-model', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] },
    } as any);
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/messages', payload: requestBody(false) });
      expect(response.statusCode).toBe(200);
      const sent = vi.mocked(wrapAutoFreeViaGodmode).mock.calls[0][0] as any;
      expect(sent.messages[0]).toMatchObject({ role: 'system', content: 'Keep code literal: `a+b`.' });
      expect(sent.messages[2].tool_calls[0]).toMatchObject({ id: 'call_exact', function: { name: 'inspect' } });
      expect(sent.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_exact' });
      expect(sent.tools[0].function.parameters.properties.path.type).toBe('string');
      expect(sent.tool_choice).toEqual({ type: 'function', function: { name: 'inspect' } });
      expect(sent.temperature).toBe(0.2);
      expect(sent.topP).toBe(0.8);
    } finally { await app.close(); }
  });

  it('streams native Anthropic message and text-block lifecycle with finish and usage', async () => {
    vi.mocked(getGodmodeService).mockReturnValue({
      isInitialized: () => true,
      chatStreamFull: () => streamOf(
        { content: 'const x = 1;' },
        { finish_reason: 'stop', usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
      ),
    } as any);
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/messages', payload: requestBody(true) });
      const frames = response.body.split('\n\n').filter(Boolean).map((frame) => {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        return { event, data: data ? JSON.parse(data) : undefined };
      });
      expect(vi.mocked(buildGodmodeWrapOrder)).toHaveBeenCalled();
      expect(vi.mocked(ensureGodmodeProxy).mock.results).toHaveLength(1);
      expect(await vi.mocked(ensureGodmodeProxy).mock.results[0].value).toBe(true);
      expect(vi.mocked(getGodmodeService)).toHaveBeenCalled();
      expect(response.statusCode, response.body).toBe(200);
      expect(frames.map((frame) => frame.event)).toEqual([
        'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
      ]);
      expect(frames[1].data.content_block.type).toBe('text');
      expect(frames[2].data.delta.text).toBe('const x = 1;');
      expect(frames[4].data.delta.stop_reason).toBe('end_turn');
      expect(frames[4].data.usage).toMatchObject({ input_tokens: 8, output_tokens: 4 });
    } finally { await app.close(); }
  });

  it('fails closed on GODMODE preparation exceptions in strict mode', async () => {
    process.env.DMRX_GODMODE_STRICT = 'true';
    const app = await buildApp();
    const route = vi.mocked((app as any).router.route);
    vi.spyOn((app as any).router, 'getCandidates').mockImplementation(() => { throw new Error('fixture preparation failure'); });
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/messages', payload: requestBody(false) });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ type: 'error', error: { type: 'overloaded_error' } });
      expect(route).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
