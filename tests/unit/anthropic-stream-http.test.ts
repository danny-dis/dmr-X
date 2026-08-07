import { describe, it, expect } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';

import { createAnthropicSSEStream } from '../../apps/gateway/src/converters/anthropic-stream-serializer.js';
import type { StreamChunk } from '@dmr-x/core';

/**
 * HTTP-layer regression test for the tool-call streaming hang.
 *
 * The unit tests in `anthropic-stream-serializer.test.ts` assert the shape of
 * the SSE events. This test goes one level higher: it serves the serializer's
 * output over a real HTTP SSE connection — exactly what a streaming Anthropic
 * client like `pi` consumes — and asserts that:
 *
 *   1. The connection does NOT hang: the stream terminates with `message_stop`
 *      and the response body ends (the old bug left the client waiting forever
 *      at `message_start` because no `tool_use` block was ever emitted).
 *   2. A `tool_use` content block is actually present on the wire when the
 *      model emits `tool_calls`.
 *   3. The event order matches the Anthropic streaming contract
 *      (message_start -> ... -> message_delta -> message_stop).
 *
 * No real model is contacted; a static `StreamChunk` sequence stands in for the
 * adapter output, so the test is deterministic and fast while still covering
 * the serialization + HTTP framing seam where the original bug lived.
 *
 * Uses node:http's own client (not the global `fetch`) to consume the
 * response: under CI's resource pressure (single-fork vitest pool running
 * the full ~1256-test suite), `fetch` was observed to intermittently resolve
 * `undefined` instead of a Response or a rejection, failing this test with no
 * code change involved. node:http is what the test server itself is built
 * on, so round-tripping through it too removes that layer of doubt entirely
 * rather than papering over it with retries.
 */

// Parse SSE bytes into [{ event, data }] pairs.
function parseSSE(raw: string): Array<{ event: string; data: any }> {
  const out: Array<{ event: string; data: any }> = [];
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) out.push({ event, data: JSON.parse(data) });
  }
  return out;
}

// Build an async iterable of StreamChunk from an array (mirrors the adapter output).
function asAsyncIterable(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

// Stand up a real HTTP server that streams the serializer output for a given chunk list.
function startStreamServer(chunks: StreamChunk[]): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(async (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        for await (const sse of createAnthropicSSEStream(asAsyncIterable(chunks), {
          model: 'test-model',
          requestId: 'req_test',
        })) {
          res.write(sse);
        }
      } finally {
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        url: `http://127.0.0.1:${port}/v1/messages`,
        close: () =>
          new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// Fetch the full response body over a real node:http client connection, with
// a hard abort budget so a genuine hang (the bug this suite guards against)
// still fails loudly instead of blocking the suite.
function requestFullBody(url: string, timeoutMs = 5000): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const req = httpRequest(url, { signal: ac.signal }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
      res.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

describe('Anthropic streaming over HTTP (tool-call hang regression)', () => {
  it('terminates and emits a tool_use block when the model emits tool_calls', async () => {
    const chunks: StreamChunk[] = [
      // Model streams a tool call (no text) — the exact shape the adapters emit.
      { type: 'token', data: { tool_calls: [
        { index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"city":' } },
      ] }, index: 0 },
      { type: 'token', data: { tool_calls: [
        { index: 0, function: { arguments: ' "Berlin"}' } },
      ] }, index: 1 },
      { type: 'done', data: { finishReason: 'tool_calls' }, index: 2 },
    ];

    const { url, close } = await startStreamServer(chunks);
    try {
      // Abort after 5s — if the stream never ends, the test fails loudly
      // (reproducing the original hang rather than passing silently).
      const { statusCode, body } = await requestFullBody(url);

      expect(statusCode).toBe(200);
      expect(body).toBeTruthy();

      const events = parseSSE(body);
      const eventNames = events.map((e) => e.event);

      // 1. Stream terminates in the proper order (no hang).
      expect(eventNames[0]).toBe('message_start');
      expect(eventNames[eventNames.length - 1]).toBe('message_stop');

      // 2. A tool_use content block is present on the wire.
      const toolStart = events.find((e) => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
      expect(toolStart).toBeDefined();
      expect(toolStart!.data.content_block.name).toBe('get_weather');
      expect(toolStart!.data.content_block.id).toBe('call_abc');

      // The streamed JSON args were reassembled and delivered via input_json_delta.
      const toolDelta = events.find((e) => e.event === 'content_block_delta' && e.data.delta?.type === 'input_json_delta');
      expect(toolDelta).toBeDefined();
      expect(JSON.parse(toolDelta!.data.delta.partial_json)).toEqual({ city: 'Berlin' });

      // 3. stop_reason reflects the tool call (the cue the client was blocked on).
      const messageDelta = events.find((e) => e.event === 'message_delta');
      expect(messageDelta!.data.delta.stop_reason).toBe('tool_use');
    } finally {
      await close();
    }
  });

  it('still terminates cleanly for a text-only stream', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'Hello' }, index: 0 },
      { type: 'token', data: { content: ' world' }, index: 1 },
      { type: 'done', data: { finishReason: 'stop' }, index: 2 },
    ];

    const { url, close } = await startStreamServer(chunks);
    try {
      const { statusCode, body } = await requestFullBody(url);
      expect(statusCode).toBe(200);
      const events = parseSSE(body);
      const eventNames = events.map((e) => e.event);
      expect(eventNames[0]).toBe('message_start');
      expect(eventNames[eventNames.length - 1]).toBe('message_stop');
      expect(events.some((e) => e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta')).toBe(true);
      // No tool_use block should appear for a text-only stream.
      expect(events.some((e) => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use')).toBe(false);
    } finally {
      await close();
    }
  });
});
