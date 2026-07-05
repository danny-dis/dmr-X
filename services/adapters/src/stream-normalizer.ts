import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';
import { EventStream, logger, type SseMessage } from '@dmr-x/utils';

/**
 * Parse an OpenAI-compatible SSE response into StreamChunks.
 * Uses the robust EventStream parser that handles multiple boundary formats.
 *
 * If `options.signal` is provided and aborts while we're still reading the
 * upstream body, the underlying ReadableStream is cancelled. This is what
 * lets a client-disconnect AbortController in a streaming route propagate
 * all the way down to the provider connection — without it, the body would
 * keep draining into the void after the response had already been torn down.
 */
export function createOpenAISSEIterator(
  response: Response,
  options?: { signal?: AbortSignal },
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

      // Handle SSE error events
      if (msg.event === 'error') {
        throw new Error(`SSE error from upstream: ${msg.data || 'Unknown error'}`);
      }

      try {
        const parsed = JSON.parse(msg.data!);

        // Check for error in parsed data (some providers send {error: ...} in data)
        if (parsed.error) {
          throw new Error(
            `Upstream streaming error: ${typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)}`
          );
        }

        // Check for finish_reason error indicators
        if (parsed.choices?.[0]?.finish_reason === 'content_filter' || parsed.choices?.[0]?.finish_reason === 'safety') {
          throw new Error(`Stream blocked by content safety filters: ${parsed.choices[0].finish_reason}`);
        }

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
      } catch (parseErr) {
        // Only skip parse errors for non-error events
        if (parseErr instanceof SyntaxError) {
          logger.warn({ err: parseErr }, 'SSE stream: malformed JSON chunk, skipping');
        } else {
          // Re-throw meaningful errors (content filter, upstream error, etc.)
          throw parseErr;
        }
      }

      return { done: false, value: undefined as unknown as StreamChunk };
    },
  );

  // Wire external abort signal → cancel the upstream ReadableStream.
  // This is the propagation point for client-disconnect AbortControllers
  // in the streaming routes. If the signal fires after the stream has
  // already finished, the cancel is a no-op.
  if (options?.signal) {
    const signal = options.signal;
    if (signal.aborted) {
      // Already aborted — cancel synchronously and let the consumer
      // observe a done iterator.
      void eventStream.cancel(signal.reason);
    } else {
      const onAbort = () => {
        void eventStream.cancel(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

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
