import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';
import { EventStream, type SseMessage } from '@dmr-x/utils';

/**
 * Parse an OpenAI-compatible SSE response into StreamChunks.
 * Uses the robust EventStream parser that handles multiple boundary formats.
 */
export function createOpenAISSEIterator(
  response: Response
): AsyncIterable<StreamChunk> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  let index = 0;

  const eventStream = new EventStream<StreamChunk>(
    body,
    (msg: SseMessage<string>): IteratorResult<StreamChunk, undefined> => {
      if (msg.data === '[DONE]') {
        return {
          done: false,
          value: { type: 'done', data: {}, index: index++ } as DoneStreamChunk,
        };
      }

      try {
        const parsed = JSON.parse(msg.data!);
        const delta = parsed.choices?.[0]?.delta;

        if (delta) {
          return {
            done: false,
            value: {
              type: 'token',
              data: {
                content: delta.content,
                tool_calls: delta.tool_calls,
                role: delta.role,
              },
              index: index++,
            } as TokenStreamChunk,
          };
        }
      } catch {
        // Skip malformed JSON chunks
      }

      return { done: false, value: undefined as unknown as StreamChunk };
    },
  );

  return eventStream;
}

/**
 * Convert StreamChunks back to SSE text format for writing to HTTP responses.
 * Uses the EventStream-based SSE serializer from @dmr-x/utils for robust parsing,
 * then re-serializes into OpenAI-compatible SSE format.
 */
export async function* createSSESerializer(chunks: AsyncIterable<StreamChunk>): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const delta = (chunk as TokenStreamChunk).data;
      const data = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: { content: delta.content, role: delta.role },
          finish_reason: null,
        }],
      };
      yield `data: ${JSON.stringify(data)}\n\n`;
    } else if (chunk.type === 'done') {
      const data = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      yield `data: ${JSON.stringify(data)}\n\n`;
      yield 'data: [DONE]\n\n';
    } else if (chunk.type === 'error') {
      yield `data: ${JSON.stringify({ error: (chunk as any).data })}\n\n`;
    }
  }
}

/**
 * Format a single StreamChunk as an OpenAI-compatible SSE data line.
 * Returns the formatted string or undefined for unrecognized chunk types.
 * Does NOT include the [DONE] marker -- callers handle stream termination.
 */
export function formatSSEChunk(chunk: StreamChunk, requestId: string): string | undefined {
  if (chunk.type === 'token') {
    const delta = (chunk as TokenStreamChunk).data;
    return `data: ${JSON.stringify({
      id: requestId,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: delta.content, role: delta.role }, finish_reason: null }],
    })}\n\n`;
  }
  if (chunk.type === 'done') {
    return `data: ${JSON.stringify({
      id: requestId,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`;
  }
  return undefined;
}
