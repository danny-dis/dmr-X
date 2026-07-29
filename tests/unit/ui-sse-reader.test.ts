import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { streamSSE, type SSEFrame } from '../../apps/ui/src/lib/sse.js';

/**
 * The UI's SSE reader. The regression under test is chunk-boundary handling:
 * the parsers this replaces did
 *
 *     chunk.split('\n').filter(l => l.startsWith('data: '))
 *
 * per network chunk with no residual buffer, so any `data:` line delivered in
 * two pieces vanished silently — streamed text was lost with no error.
 */

function streamFrom(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(chunks: string[]): Promise<SSEFrame[]> {
  const frames: SSEFrame[] = [];
  await streamSSE('/v1/test', { onFrame: (f) => frames.push(f) });
  return frames;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // fetchAuthenticated reads localStorage and window.location.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockStream(chunks: string[]) {
  fetchMock.mockResolvedValue(streamFrom(chunks));
}

describe('streamSSE', () => {
  it('parses well-formed frames', async () => {
    mockStream(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']);

    const frames = await collect([]);

    expect(frames).toHaveLength(2);
    expect(frames[0].data).toBe('{"a":1}');
    expect(frames[1].data).toBe('{"a":2}');
    expect(frames[0].event).toBe('message');
  });

  it('reassembles a data line split across chunks (the regression)', async () => {
    // One logical frame delivered in three pieces, splitting mid-token.
    mockStream(['data: {"cont', 'ent":"hello wo', 'rld"}\n\n']);

    const frames = await collect([]);

    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data).content).toBe('hello world');
  });

  it('reassembles when the blank-line separator itself is split', async () => {
    mockStream(['data: {"a":1}\n', '\ndata: {"a":2}\n\n']);

    const frames = await collect([]);

    expect(frames.map((f) => f.data)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('does not emit a partial frame that never completes', async () => {
    // No trailing separator on the second frame, and the stream ends — the
    // flush path should still emit it exactly once.
    mockStream(['data: {"a":1}\n\n', 'data: {"a":2}']);

    const frames = await collect([]);

    expect(frames).toHaveLength(2);
    expect(frames[1].data).toBe('{"a":2}');
  });

  it('reads named events', async () => {
    mockStream(['event: turn\ndata: {"step":1}\n\n', 'event: done\ndata: {}\n\n']);

    const frames = await collect([]);

    expect(frames[0].event).toBe('turn');
    expect(frames[1].event).toBe('done');
  });

  it('joins multi-line data per the SSE spec', async () => {
    mockStream(['data: line one\ndata: line two\n\n']);

    const frames = await collect([]);

    expect(frames[0].data).toBe('line one\nline two');
  });

  it('ignores comment heartbeats', async () => {
    mockStream([':heartbeat\n\n', 'data: {"a":1}\n\n', ':ping\n\n']);

    const frames = await collect([]);

    expect(frames).toHaveLength(1);
  });

  it('handles CRLF line endings', async () => {
    mockStream(['data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n']);

    const frames = await collect([]);

    expect(frames.map((f) => f.data)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('handles a multi-byte character split across chunks', async () => {
    const encoder = new TextEncoder();
    const full = encoder.encode('data: {"content":"日本語"}\n\n');
    // Cut inside the first multi-byte codepoint.
    const cut = 20;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(full.slice(0, cut));
        controller.enqueue(full.slice(cut));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const frames: SSEFrame[] = [];
    await streamSSE('/v1/test', { onFrame: (f) => frames.push(f) });

    expect(JSON.parse(frames[0].data).content).toBe('日本語');
  });

  it('surfaces the server error message on a non-200', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }),
    );

    await expect(streamSSE('/v1/test', { onFrame: () => {} })).rejects.toThrow('model not found');
  });

  it('calls onDone once when the stream closes', async () => {
    mockStream(['data: {"a":1}\n\n']);
    const onDone = vi.fn();

    await streamSSE('/v1/test', { onFrame: () => {}, onDone });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('treats an abort as a clean stop rather than an error', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
        controller.abort();
        c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const onDone = vi.fn();
    // A user pressing Stop must not surface as a failure.
    await expect(
      streamSSE('/v1/test', { onFrame: () => {}, onDone, signal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(onDone).toHaveBeenCalled();
  });
});
