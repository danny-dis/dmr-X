import { afterEach, describe, expect, it, vi } from 'vitest';

import { GodmodeService } from '../../services/godmode/src/godmode.service.js';

const encoder = new TextEncoder();

async function serviceFor(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  const service = new GodmodeService({ baseUrl: 'http://godmode.test', llmBaseUrl: 'http://relay.test' });
  await service.initialize();
  return service;
}

function responseFrom(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GodmodeService chatStreamFull stream lifetime', () => {
  it('propagates caller abort after headers to a pending body read and cancels the reader', async () => {
    let cancelled = false;
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      start() {},
      cancel() { cancelled = true; },
    }))));
    const controller = new AbortController();
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    controller.abort(new Error('caller disconnected'));
    await expect(pending).rejects.toThrow(/abort|disconnect/i);
    expect(cancelled).toBe(true);
  });

  it('keeps its timeout active while waiting for body bytes', async () => {
    vi.useFakeTimers();
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({ start() {} }))));
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] }, { timeoutMs: 25 })[Symbol.asyncIterator]();
    const pending = iterator.next();
    const rejected = expect(pending).rejects.toThrow(/timed out|timeout/i);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
  });

  it('rejects a pre-aborted caller signal without starting fetch', async () => {
    const fetchMock = vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({ start() {} })));
    const service = await serviceFor(fetchMock);
    const controller = new AbortController();
    controller.abort(new Error('already disconnected'));
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/already disconnected|abort/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels and unlocks the response reader when the consumer returns early', async () => {
    let cancelled = false;
    const controller = new AbortController();
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"one"}}]}\n\n')); },
      cancel() { cancelled = true; },
    }))));
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ content: 'one' });
    await iterator.return?.();
    expect(cancelled).toBe(true);
    expect(controller.signal.onabort).toBeNull();
  });

  it('propagates an upstream error after partial content instead of finishing successfully', async () => {
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        stream.enqueue(encoder.encode('data: {"error":{"message":"upstream failed after output"}}\n\n'));
      },
    }))));
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ content: 'partial' });
    await expect(iterator.next()).rejects.toThrow(/upstream failed after output/);
  });

  it('preserves finish reason and usage from metadata-only frames and handles CRLF UTF-8 splits and final tail', async () => {
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"caf'),
      encoder.encode('é"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\r\n\r\ndata: [DONE]'),
    ];
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    }))));
    const values = [];
    for await (const value of service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] })) values.push(value);
    expect(values).toEqual([
      { content: 'café', finish_reason: null },
      { finish_reason: 'tool_calls', usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
    ]);
  });

  it('keeps parsed upstream errors distinct from malformed JSON syntax', async () => {
    const service = await serviceFor(vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"error":{"message":"upstream rejected"}}\n\ndata: {bad json}\n\n'));
        controller.close();
      },
    }))));
    const iterator = service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/upstream rejected/);
  });

  it('does not put stream options or signal into the upstream JSON payload', async () => {
    const fetchMock = vi.fn(async () => responseFrom(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); },
    })));
    const service = await serviceFor(fetchMock);
    const signal = new AbortController().signal;
    for await (const _chunk of service.chatStreamFull({ model: 'fixture-model', messages: [{ role: 'user', content: 'hi' }] }, { signal, timeoutMs: 50 })) {}
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty('signal');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('timeoutMs');
    expect((init.headers as Record<string, string>)['X-DMRX-Godmode-Proxy']).toBe('1');
  });
});
