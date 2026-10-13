import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicRoutes } from '../../apps/gateway/src/routes/anthropic.routes.js';
import { createAnthropicSSEStream } from '../../apps/gateway/src/converters/anthropic-stream-serializer.js';
vi.mock('../../apps/gateway/src/lib/godmode-guard.js', () => ({
  buildGodmodeWrapOrder: vi.fn(() => ['fixture']), ensureGodmodeProxy: vi.fn(async () => true),
  isGodmodeStrict: vi.fn(() => true), wrapAutoFreeViaGodmode: vi.fn(),
}));
vi.mock('@dmr-x/godmode', () => ({ getGodmodeService: vi.fn() }));
import { getGodmodeService } from '@dmr-x/godmode';
import { buildGodmodeWrapOrder } from '../../apps/gateway/src/lib/godmode-guard.js';
const body = { model: 'auto-free', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'Inspect literal a+b.ts.' }] };
const envKeys = ['DMRX_AUTOFREE_STREAM_TIMEOUT_MS', 'DMRX_AUTOFREE_TTFT_MS'];
let saved: Record<string, string | undefined>;
beforeEach(() => { vi.clearAllMocks(); saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]])); vi.mocked(buildGodmodeWrapOrder).mockReturnValue(['fixture']); });
afterEach(() => { vi.useRealTimers(); for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
async function appFor(stream: (...args: any[]) => AsyncIterable<any>) {
  vi.mocked(getGodmodeService).mockReturnValue({ isInitialized: () => true, chatStreamFull: stream } as any);
  const app = Fastify({ logger: false });
  app.decorate('router', { getCandidates: () => [], route: vi.fn() });
  app.decorate('getAdapter', () => undefined);
  await app.register(anthropicRoutes, { prefix: '/v1' });
  await app.ready(); return app;
}
function frames(text: string) { return text.split('\n\n').filter(Boolean).map(x => JSON.parse(x.match(/^data: (.+)$/m)![1])); }
async function* deltas(...xs: any[]) { for (const x of xs) yield x; }
describe('Anthropic GODMODE release gates', () => {
  it('preserves mixed text and fragmented tool IDs, names and literal arguments', async () => {
    const app = await appFor(() => deltas(
      { content: 'Read literal a+b.ts.', tool_calls: [{ index: 0, id: 'call_', function: { name: 'read_', arguments: '{"path":"a+' } }] },
      { tool_calls: [{ index: 0, id: 'exact', function: { name: 'file', arguments: 'b.ts"}' } }] },
      { finish_reason: 'tool_calls', usage: { prompt_tokens: 9, completion_tokens: 3 } },
    ));
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(r.statusCode).toBe(200); const xs = frames(r.body);
      expect(xs.filter(x => x.delta?.type === 'text_delta').map(x => x.delta.text).join('')).toBe('Read literal a+b.ts.');
      expect(xs.find(x => x.content_block?.type === 'tool_use').content_block).toMatchObject({ id: 'call_exact', name: 'read_file' });
      expect(JSON.parse(xs.find(x => x.delta?.type === 'input_json_delta').delta.partial_json)).toEqual({ path: 'a+b.ts' });
      expect(xs.find(x => x.type === 'message_delta').delta.stop_reason).toBe('tool_use');
      expect(xs.at(-1).type).toBe('message_stop');
    } finally { await app.close(); }
  });

  it.each([undefined, 'stop'])('reports tool_use for tool-only streams without a tool finish (%s)', async (finish) => {
    const app = await appFor(() => deltas(
      { tool_calls: [{ index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '{}' } }] },
      ...(finish ? [{ finish_reason: finish }] : []),
    ));
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(frames(r.body).find(x => x.type === 'message_delta').delta.stop_reason).toBe('tool_use');
    } finally { await app.close(); }
  });

  it('reports tool_use when the serializer receives tool-only EOF without done', async () => {
    let wire = '';
    for await (const event of createAnthropicSSEStream(deltas({ type: 'token', index: 0, data: {
      tool_calls: [{ index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '{}' } }],
    } }) as any, { model: 'fixture', requestId: 'fixture' })) wire += event;
    expect(frames(wire).find(x => x.type === 'message_delta').delta.stop_reason).toBe('tool_use');
  });

  it('fails an empty wrapped stream with native 503 and never invokes plain routing', async () => {
    const app = await appFor(() => deltas());
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ type: 'error', error: { type: 'overloaded_error' } });
      expect((app as any).router.route).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('maps a tool-only length-limited response to native blocks and max_tokens', async () => {
    const app = await appFor(() => deltas(
      { tool_calls: [{ index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '{"path":"a+b.ts"}' } }] },
      { finish_reason: 'length' },
    ));
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body }); const xs = frames(r.body);
      expect(r.statusCode).toBe(200);
      expect(xs[0].type).toBe('message_start');
      expect(xs.find(x => x.content_block?.type === 'tool_use').content_block.id).toBe('call_exact');
      expect(xs.find(x => x.type === 'message_delta').delta.stop_reason).toBe('max_tokens');
      expect(xs.at(-1).type).toBe('message_stop');
    } finally { await app.close(); }
  });

  it('returns a terminal native error after partial output without retrying', async () => {
    const service = vi.fn(() => (async function* () { yield { content: 'partial' }; throw new Error('fixture upstream failed'); })());
    vi.mocked(buildGodmodeWrapOrder).mockReturnValue(['first', 'second']);
    const app = await appFor(service);
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body }); const xs = frames(r.body);
      expect(service).toHaveBeenCalledTimes(1);
      expect(xs.at(-1)).toMatchObject({ type: 'error', error: { type: 'api_error' } });
      expect(xs.some(x => x.type === 'message_stop')).toBe(false);
    } finally { await app.close(); }
  });

  it('preserves consecutive identical identifier and name fragments', async () => {
    const app = await appFor(() => deltas(
      { tool_calls: [{ index: 0, id: 'a', function: { name: 'b', arguments: '{' } }] },
      { tool_calls: [{ index: 0, id: 'a', function: { name: 'b', arguments: '}' } }] },
      { finish_reason: 'tool_calls' },
    ));
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(frames(r.body).find(x => x.content_block?.type === 'tool_use').content_block).toMatchObject({ id: 'aa', name: 'bb' });
    } finally { await app.close(); }
  });

  it.each([
    { index: 0, id: 'call_exact', function: { arguments: '{}' } },
    { index: 0, function: { name: 'read_file', arguments: '{}' } },
    { index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '{' } },
    { index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '[]' } },
    { index: 0, id: 'call_exact', function: { name: 'read_file' } },
    { index: 0, id: 'call_exact', function: { name: 'read_file', arguments: '' } },
  ])('never signals success for incomplete or invalid tool calls (%j)', async (tool) => {
    const app = await appFor(() => deltas({ tool_calls: [tool] }, { finish_reason: 'tool_calls' }));
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body }); const xs = frames(r.body);
      expect(xs.at(-1).type).toBe('error');
      expect(xs.some(x => x.type === 'message_delta' || x.type === 'message_stop')).toBe(false);
    } finally { await app.close(); }
  });

  it('never emits success events after an explicit serializer error', async () => {
    const xs: any[] = [];
    const input = deltas(
      { type: 'token', index: 0, data: { content: 'partial' } },
      { type: 'error', index: 1, data: { message: 'fixture failure' } },
      { type: 'done', index: 2, data: { finishReason: 'stop' } },
    );
    for await (const event of createAnthropicSSEStream(input as any, { model: 'fixture', requestId: 'fixture' })) xs.push(...frames(event));
    expect(xs.at(-1).type).toBe('error');
    expect(xs.some(x => x.type === 'message_stop' || x.type === 'message_delta')).toBe(false);
  });

  it('shares one chain deadline across fallback models', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const budget = 100; const spent = 40;
    process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = String(budget); process.env.DMRX_AUTOFREE_TTFT_MS = '80';
    vi.mocked(buildGodmodeWrapOrder).mockReturnValue(['empty', 'second']);
    const seen: number[] = [];
    const app = await appFor((r, opts) => {
      seen.push(opts.timeoutMs);
      if (r.model === 'empty') return (async function* () { now += spent; })();
      return deltas({ content: 'ok' }, { finish_reason: 'stop' });
    });
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(r.statusCode).toBe(200); expect(seen).toEqual([budget, budget - spent]);
    } finally { clock.mockRestore(); await app.close(); }
  });

  it('bounds cleanup even when a custom stream ignores abort and iterator return', { timeout: 1500 }, async () => {
    process.env.DMRX_AUTOFREE_TTFT_MS = '20'; process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS = '80';
    let signal: AbortSignal | undefined;
    const app = await appFor((_r, options) => {
      signal = options.signal;
      return { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<any>>(() => {}), return: () => new Promise<IteratorResult<any>>(() => {}) }; } };
    });
    try {
      const r = await app.inject({ method: 'POST', url: '/v1/messages', payload: body });
      expect(r.statusCode).toBe(503); expect(signal?.aborted).toBe(true);
    } finally { await app.close(); }
  });
});
