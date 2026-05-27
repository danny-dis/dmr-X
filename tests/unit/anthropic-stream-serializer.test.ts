import { describe, it, expect } from 'vitest';
import { createAnthropicSSEStream } from '../../apps/gateway/src/converters/anthropic-stream-serializer.js';
import type { StreamChunk } from '../../packages/core/src/types/index.js';

async function collectStream(
  chunks: StreamChunk[],
  options = { model: 'test-model', requestId: 'msg_test123' }
): Promise<string[]> {
  async function* mockStream() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  const results: string[] = [];
  for await (const chunk of createAnthropicSSEStream(mockStream(), options)) {
    // Split each chunk into lines
    results.push(...chunk.split('\n').filter(l => l.trim()));
  }
  return results;
}

function parseEvents(lines: string[]): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('event: ')) {
      const event = line.replace('event: ', '').trim();
      const dataLine = lines[i + 1]?.trim();
      const data = dataLine?.startsWith('data: ')
        ? JSON.parse(dataLine.replace('data: ', ''))
        : {};
      events.push({ event, data });
    }
  }
  return events;
}

describe('createAnthropicSSEStream', () => {
  it('should emit correct event sequence for text streaming', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'Hello' }, index: 0 },
      { type: 'token', data: { content: ' world' }, index: 1 },
      {
        type: 'done',
        data: {
          requestId: 'msg_test123',
          modelId: 'test-model',
          finishReason: 'stop',
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        },
        index: 2,
      },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);

    expect(events).toHaveLength(7);

    // 1. message_start
    expect(events[0].event).toBe('message_start');
    expect(events[0].data.type).toBe('message_start');
    expect(events[0].data.message.id).toBe('msg_test123');
    expect(events[0].data.message.model).toBe('test-model');
    expect(events[0].data.message.role).toBe('assistant');
    expect(events[0].data.message.stop_reason).toBeNull();

    // 2. content_block_start
    expect(events[1].event).toBe('content_block_start');
    expect(events[1].data.index).toBe(0);
    expect(events[1].data.content_block).toEqual({ type: 'text', text: '' });

    // 3. content_block_delta (Hello)
    expect(events[2].event).toBe('content_block_delta');
    expect(events[2].data.index).toBe(0);
    expect(events[2].data.delta).toEqual({ type: 'text_delta', text: 'Hello' });

    // 4. content_block_delta ( world)
    expect(events[3].event).toBe('content_block_delta');
    expect(events[3].data.delta).toEqual({ type: 'text_delta', text: ' world' });

    // 5. content_block_stop
    expect(events[4].event).toBe('content_block_stop');
    expect(events[4].data.index).toBe(0);

    // 6. message_delta
    expect(events[5].event).toBe('message_delta');
    expect(events[5].data.delta.stop_reason).toBe('end_turn');
    expect(events[5].data.usage.output_tokens).toBe(2);

    // 7. message_stop
    expect(events[6].event).toBe('message_stop');
  });

  it('should emit message_stop after message_delta', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'Hi' }, index: 0 },
      {
        type: 'done',
        data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
        index: 1,
      },
    ];

    const lines = await collectStream(chunks);
    const eventNames = lines
      .filter(l => l.startsWith('event: '))
      .map(l => l.replace('event: ', '').trim());

    expect(eventNames).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('should map tool_calls finish reason to tool_use', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'Thinking...' }, index: 0 },
      {
        type: 'done',
        data: { requestId: 'msg_1', modelId: 'm', finishReason: 'tool_calls' },
        index: 1,
      },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);
    const messageDelta = events.find(e => e.event === 'message_delta');

    expect(messageDelta!.data.delta.stop_reason).toBe('tool_use');
  });

  it('should map length finish reason to max_tokens', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: '...' }, index: 0 },
      {
        type: 'done',
        data: { requestId: 'msg_1', modelId: 'm', finishReason: 'length' },
        index: 1,
      },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);
    const messageDelta = events.find(e => e.event === 'message_delta');

    expect(messageDelta!.data.delta.stop_reason).toBe('max_tokens');
  });

  it('should emit error event for error chunks', async () => {
    const chunks: StreamChunk[] = [
      { type: 'error', data: { code: 'rate_limit', message: 'Too many requests' }, index: 0 },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.type).toBe('error');
    expect(events[0].data.error.type).toBe('api_error');
    expect(events[0].data.error.message).toBe('Too many requests');
  });

  it('should close gracefully if stream ends without done chunk', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'Hello' }, index: 0 },
      // No done chunk
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);

    // Should have: message_start, content_block_start, content_block_delta,
    // content_block_stop, message_delta, message_stop
    expect(events).toHaveLength(6);
    expect(events[4].event).toBe('message_delta');
    expect(events[4].data.delta.stop_reason).toBe('end_turn');
    expect(events[5].event).toBe('message_stop');
  });

  it('should handle empty content in token chunk', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: '' }, index: 0 },
      { type: 'token', data: { content: 'Hello' }, index: 1 },
      {
        type: 'done',
        data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
        index: 2,
      },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);
    const deltas = events.filter(e => e.event === 'content_block_delta');

    // Empty content is skipped, only 'Hello' produces a delta
    expect(deltas).toHaveLength(1);
    expect(deltas[0].data.delta.text).toBe('Hello');
  });

  it('should count output tokens correctly', async () => {
    const chunks: StreamChunk[] = [
      { type: 'token', data: { content: 'a' }, index: 0 },
      { type: 'token', data: { content: 'b' }, index: 1 },
      { type: 'token', data: { content: 'c' }, index: 2 },
      {
        type: 'done',
        data: { requestId: 'msg_1', modelId: 'm', finishReason: 'stop' },
        index: 3,
      },
    ];

    const lines = await collectStream(chunks);
    const events = parseEvents(lines);
    const messageDelta = events.find(e => e.event === 'message_delta');

    expect(messageDelta!.data.usage.output_tokens).toBe(3);
  });
});
