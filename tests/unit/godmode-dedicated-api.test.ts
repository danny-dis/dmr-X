import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dmr-x/server-manager', () => ({ serverManager: {}, getGodmodeRepoInfo: vi.fn(), getInstalledGodmodeRef: vi.fn() }));
vi.mock('@dmr-x/godmode', () => ({ getGodmodeService: vi.fn(), setGodmodeConfig: vi.fn() }));
vi.mock('../../apps/gateway/src/lib/godmode-guard.js', () => ({
  ensureGodmodeProxy: vi.fn(async () => true),
  isGodmodeStrict: vi.fn(() => false),
  buildGodmodeWrapOrder: vi.fn(() => ['fixture-free']),
  buildWrapOrderForModel: vi.fn((model: string) => [model === 'auto-free' ? 'fixture-free' : model]),
  wrapAutoFreeViaGodmode: vi.fn(),
  wrapViaGodmode: vi.fn(),
  isEmptyCompletion: vi.fn(() => false),
}));
import { godmodeRoutes } from '../../apps/gateway/src/routes/godmode.routes.js';
import { getGodmodeService } from '@dmr-x/godmode';
import { wrapViaGodmode } from '../../apps/gateway/src/lib/godmode-guard.js';

const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const call = { id: 'call_literal', type: 'function', function: { name: 'read_file', arguments: '{"path":"root/disable.ts"}' } };
const messages = [
  { role: 'system', content: 'Preserve literal code and paths.' },
  { role: 'user', content: [{ type: 'text', text: 'Read `root/disable.ts`.' }] },
  { role: 'assistant', content: null, tool_calls: [call] },
  { role: 'tool', tool_call_id: call.id, name: 'read_file', content: 'export const enabled = false;' },
  { role: 'user', content: 'Use the actual tool result.' },
];
const completion = { id: 'chatcmpl-fixture', object: 'chat.completion', created: 1, model: 'fixture-free', choices: [{ index: 0, message: { role: 'assistant', content: 'verified' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 } };
const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, healthCheck: async () => true, chat: vi.fn(async () => completion) } as any);
  vi.mocked(wrapViaGodmode).mockResolvedValue({ status: 'wrapped', completion, wrapModel: 'fixture-free' });
});
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function appFor() {
  const app = Fastify({ logger: false });
  app.decorate('router', { getCandidates: () => [], route: vi.fn(() => { throw new Error('plain routing must never run'); }) });
  await app.register(godmodeRoutes, { prefix: '/v1' });
  await app.ready(); apps.push(app); return app;
}

describe('dedicated GODMODE coding API', () => {
  it('upgrades legacy chat without stripping assistant/tool history or tool controls', async () => {
    const app = await appFor();
    const payload = { model: 'auto-free', messages, tools, tool_choice: 'none', autotune: false, parseltongue: false, contribute_to_dataset: false };
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat', payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe('verified');
    expect(wrapViaGodmode).toHaveBeenCalledWith(expect.objectContaining({ messages, tools, tool_choice: 'none', requestOptions: expect.objectContaining({ autotune: false, parseltongue: false, contribute_to_dataset: false }) }));
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it('exposes the OpenAI-compatible alias with a default model and concrete-model fidelity', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', payload: { model: 'fixture-concrete', messages, tools, tool_choice: 'none' } });
    expect(response.statusCode).toBe(200);
    expect(wrapViaGodmode).toHaveBeenCalledWith(expect.objectContaining({ model: 'fixture-concrete', costFilter: 'free' }));
    const defaultResponse = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(defaultResponse.statusCode).toBe(200);
    expect(wrapViaGodmode).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'auto-free' }));
  });

  it.each(['/v1/godmode/chat', '/v1/godmode/chat/completions'])('fails closed on unavailable wrapping even when global strict mode is off (%s)', async (url) => {
    vi.mocked(wrapViaGodmode).mockResolvedValue({ status: 'unavailable' });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url, payload: { model: 'fixture-concrete', messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('godmode_unavailable');
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it('refuses caller loop-breaker headers instead of bypassing required GODMODE', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', headers: { 'x-dmrx-godmode-proxy': '1' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(400);
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it('preserves tool-call null content and usage without inventing a text answer', async () => {
    vi.mocked(wrapViaGodmode).mockResolvedValue({ status: 'wrapped', wrapModel: 'fixture-free', completion: { ...completion, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] } });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', payload: { messages: [{ role: 'user', content: 'read' }], tools } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ object: 'chat.completion', created: 1, choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage: completion.usage });
  });

  it('streams exact tool fragments, terminal reason and usage through the dedicated alias', async () => {
    const stream = vi.fn(async function* () {
      yield { tool_calls: [{ index: 0, id: 'call_', type: 'function', function: { name: 'read_', arguments: '{"path":"root/' } }] };
      yield { tool_calls: [{ index: 0, id: 'literal', function: { name: 'file', arguments: 'disable.ts"}' } }] };
      yield { finish_reason: 'tool_calls', usage: completion.usage };
    });
    vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', payload: { model: 'fixture-concrete', messages, tools, tool_choice: 'auto', stream: true, max_tokens: 128, autotune_strategy: 'precise' } });
    expect(response.statusCode).toBe(200);
    const frames = response.body.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
    expect(response.body).toContain('data: [DONE]');
    expect(frames.some(frame => frame.error)).toBe(false);
    expect(frames.flatMap(frame => frame.choices ?? []).flatMap(choice => choice.delta?.tool_calls ?? []).map(tool => tool.function?.arguments ?? '').join('')).toBe(call.function.arguments);
    expect(frames.at(-1)).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }], usage: completion.usage });
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'fixture-concrete', messages, tools, max_tokens: 128, strategy: 'precise', contribute_to_dataset: false }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('preserves native Anthropic system/tool history through the dedicated Messages alias', async () => {
    const app = await appFor();
    const native = { model: 'fixture-concrete', max_tokens: 128, system: 'Preserve literal code and paths.', messages: [
      { role: 'user', content: 'Read `root/disable.ts`.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: 'read_file', input: { path: 'root/disable.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'export const enabled = false;' }] },
    ], tools: [{ name: 'read_file', input_schema: tools[0].function.parameters }], tool_choice: { type: 'none' }, autotune: false };
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/messages?beta=true', payload: native });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ type: 'message', content: [{ type: 'text', text: 'verified' }], stop_reason: 'end_turn' });
    const sent = vi.mocked(wrapViaGodmode).mock.calls.at(-1)![0];
    expect(sent).toMatchObject({ model: 'fixture-concrete', costFilter: 'free', tool_choice: 'none', requestOptions: { autotune: false } });
    expect(sent.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: native.system }),
      expect.objectContaining({ role: 'assistant', tool_calls: [call] }),
      expect.objectContaining({ role: 'tool', tool_call_id: call.id, content: 'export const enabled = false;' }),
    ]));
  });

  it('streams native message/tool blocks with matched IDs and a terminal tool_use', async () => {
    const stream = vi.fn(async function* () { yield { tool_calls: [{ index: 0, ...call }] }; yield { finish_reason: 'tool_calls', usage: completion.usage }; });
    vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/messages', payload: { model: 'fixture-concrete', max_tokens: 128, stream: true, messages: [{ role: 'user', content: 'Read the literal path.' }], tools: [{ name: 'read_file', input_schema: tools[0].function.parameters }] } });
    expect(response.statusCode).toBe(200);
    const frames = response.body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    expect(frames[0].type).toBe('message_start');
    expect(frames.find(frame => frame.content_block?.type === 'tool_use').content_block).toMatchObject({ id: call.id, name: 'read_file' });
    expect(frames.find(frame => frame.type === 'message_delta').delta.stop_reason).toBe('tool_use');
    expect(frames.at(-1).type).toBe('message_stop');
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'fixture-concrete', contribute_to_dataset: false }), expect.anything());
  });

  it('fails closed with native errors when required Messages wrapping is unavailable', async () => {
    vi.mocked(wrapViaGodmode).mockResolvedValue({ status: 'unavailable' });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/messages', payload: { model: 'fixture-concrete', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'error', error: { type: 'overloaded_error' } });
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it.each(['/v1/godmode/chat', '/v1/godmode/chat/completions'])('reports partial stream failures rather than a successful terminal choice (%s)', async (url) => {
    const stream = vi.fn(async function* () { yield { content: 'partial' }; throw new Error('controlled upstream failure'); });
    vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url, payload: { model: 'fixture-concrete', stream: true, messages: [{ role: 'user', content: 'hello' }] } });
    const frames = response.body.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(frames.some(frame => frame.error)).toBe(true);
    expect(frames.flatMap(frame => frame.choices ?? []).some(choice => choice.finish_reason)).toBe(false);
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it('returns a terminal native error after partial output with no plain fallback', async () => {
    const stream = vi.fn(async function* () { yield { content: 'partial' }; throw new Error('controlled native failure'); });
    vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/messages', payload: { model: 'fixture-concrete', max_tokens: 128, stream: true, messages: [{ role: 'user', content: 'hello' }] } });
    const frames = response.body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    expect(frames.at(-1).type).toBe('error');
    expect(frames.some(frame => frame.type === 'message_stop')).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it.each(['/v1/godmode/chat', '/v1/godmode/chat/completions', '/v1/godmode/messages'])('fails closed on preparation exceptions (%s)', async (url) => {
    const app = await appFor();
    vi.spyOn((app as any).router, 'getCandidates').mockImplementation(() => { throw new Error('controlled preparation failure'); });
    const response = await app.inject({ method: 'POST', url, payload: { model: 'fixture-concrete', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(503);
    expect((app as any).router.route).not.toHaveBeenCalled();
  });

  it('honors modern OpenAI max_completion_tokens in streamed coding requests', async () => {
    const stream = vi.fn(async function* () { yield { content: 'bounded' }; yield { finish_reason: 'stop' }; });
    vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/chat/completions', payload: { messages: [{ role: 'user', content: 'hello' }], max_completion_tokens: 256, stream: true } });
    expect(response.statusCode).toBe(200);
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 256 }), expect.anything());
  });

  it('accepts the native SDK path appended to a dedicated base URL', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/v1/godmode/v1/messages?beta=true', payload: { model: 'auto-free', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().type).toBe('message');
  });
});
