import { describe, it, expect } from 'vitest';

import { createAnthropicSSEIterator } from '../../services/adapters/src/stream-normalizer.js';
import type { DoneStreamChunk, StreamChunk } from '@dmr-x/core';

/**
 * Regression test for streamed Anthropic usage accounting.
 *
 * `message_stop` used to emit a hardcoded `prompt_tokens: 0`, because the
 * iterator read only `id` and `model` off `message_start` and ignored the
 * `usage` object sitting next to them. Every streamed Anthropic request
 * therefore reported no prompt tokens at all — zeroing out cost tracking on
 * the path most agent and chat traffic actually takes, and hiding prompt-cache
 * hits entirely.
 *
 * Anthropic splits usage across two events: the input side (plus cache read
 * and write counts) lands once on `message_start`, while the final output
 * count only settles on `message_delta`.
 */

/** Build a Response whose body streams the given Anthropic SSE events. */
function sseResponse(events: Array<{ type: string; [k: string]: unknown }>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function collectDone(events: Array<{ type: string; [k: string]: unknown }>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of createAnthropicSSEIterator(sseResponse(events))) {
    chunks.push(chunk);
  }
  const done = chunks.find((c): c is DoneStreamChunk => c.type === 'done');
  expect(done).toBeDefined();
  return done!.data.usage!;
}

function messageStart(usage: Record<string, number>) {
  return {
    type: 'message_start',
    message: { id: 'msg_01', model: 'claude-opus-5', role: 'assistant', usage },
  };
}

const MESSAGE_STOP = { type: 'message_stop' };

describe('createAnthropicSSEIterator — usage accounting', () => {
  it('reports prompt tokens from message_start instead of zero', async () => {
    const usage = await collectDone([
      messageStart({ input_tokens: 250, output_tokens: 1 }),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 80 } },
      MESSAGE_STOP,
    ]);

    expect(usage.prompt_tokens).toBe(250);
    expect(usage.completion_tokens).toBe(80);
    expect(usage.total_tokens).toBe(330);
  });

  it('adds cached prompt tokens back into the prompt total', async () => {
    // input_tokens is Anthropic's *uncached remainder*, so a mostly-cached
    // request reports a small input_tokens next to a large cache read. Summing
    // them is what makes a cache hit visible instead of looking like a
    // suspiciously cheap request.
    const usage = await collectDone([
      messageStart({ input_tokens: 120, cache_read_input_tokens: 8000, output_tokens: 1 }),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } },
      MESSAGE_STOP,
    ]);

    expect(usage.prompt_tokens).toBe(8120);
    expect(usage.cache_read_tokens).toBe(8000);
    expect(usage.total_tokens).toBe(8160);
  });

  it('records cache writes on the turn that populates the cache', async () => {
    const usage = await collectDone([
      messageStart({ input_tokens: 60, cache_creation_input_tokens: 5000, output_tokens: 1 }),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } },
      MESSAGE_STOP,
    ]);

    expect(usage.prompt_tokens).toBe(5060);
    expect(usage.cache_write_tokens).toBe(5000);
    expect(usage.cache_read_tokens).toBeUndefined();
  });

  it('omits cache fields entirely when the provider reported none', async () => {
    const usage = await collectDone([
      messageStart({ input_tokens: 40, output_tokens: 1 }),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      MESSAGE_STOP,
    ]);

    expect(usage.cache_read_tokens).toBeUndefined();
    expect(usage.cache_write_tokens).toBeUndefined();
  });

  it('does not throw when message_start carries no usage object', async () => {
    const usage = await collectDone([
      { type: 'message_start', message: { id: 'msg_02', model: 'claude-opus-5' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
      MESSAGE_STOP,
    ]);

    expect(usage.prompt_tokens).toBe(0);
    expect(usage.completion_tokens).toBe(12);
  });
});
