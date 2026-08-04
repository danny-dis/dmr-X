import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';
import { EventStream, logger, type SseMessage } from '@dmr-x/utils';

import { mapAnthropicStopReason } from './anthropic-tools.js';
import { normalizeAnthropicUsage } from './cache-usage.js';

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
 * Parse an Anthropic-compatible SSE response (native `/v1/messages` wire
 * format) into StreamChunks.
 *
 * Anthropic's stream is event-typed rather than choice/delta-shaped like
 * OpenAI's: message_start / content_block_start / content_block_delta /
 * content_block_stop / message_delta / message_stop / ping / error. None of
 * those carry a `.choices` array, so `createOpenAISSEIterator` (which only
 * reads `parsed.choices?.[0]?.delta`) silently yields nothing for an
 * Anthropic-shaped stream -- this is what left GenericAnthropicAdapter's
 * streaming responses empty.
 *
 * Events that carry no chunk-worthy data (message_start, content_block_stop,
 * ping, unrecognized malformed JSON) make the parser return bare `undefined`
 * rather than an IteratorResult wrapping `undefined`. Returning the latter
 * would enqueue an `undefined` chunk into the stream -- in EventStream.pull,
 * `item && !item.done` is true for `{done:false, value:undefined}` and that
 * gets enqueued -- and every downstream consumer dereferences `chunk.type`
 * unconditionally, so an `undefined` chunk would throw.
 */
export function createAnthropicSSEIterator(
  response: Response,
  options?: { signal?: AbortSignal },
): AsyncIterable<StreamChunk> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  let index = 0;
  let requestId = '';
  let modelId = '';
  let outputTokens = 0;
  let stopReason: string | undefined;

  // Anthropic splits usage across two events: the input side (including cache
  // read/write counts) arrives once on `message_start`, while the final output
  // count only settles on `message_delta`. Both have to be held until
  // `message_stop` to emit a complete usage record.
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  const skip = undefined as unknown as IteratorResult<StreamChunk, undefined>;

  const eventStream = new EventStream<StreamChunk>(
    body,
    (msg: SseMessage<string>): IteratorResult<StreamChunk, undefined> => {
      if (!msg.data) return skip;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(msg.data);
      } catch (parseErr) {
        logger.debug({ err: parseErr }, 'Anthropic SSE: skipped malformed JSON chunk');
        return skip;
      }

      switch (parsed.type) {
        case 'message_start': {
          const message = parsed.message as Record<string, unknown> | undefined;
          if (typeof message?.id === 'string') requestId = message.id;
          if (typeof message?.model === 'string') modelId = message.model;

          const usage = message?.usage as Record<string, unknown> | undefined;
          if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens;
          if (typeof usage?.cache_read_input_tokens === 'number') {
            cacheReadTokens = usage.cache_read_input_tokens;
          }
          if (typeof usage?.cache_creation_input_tokens === 'number') {
            cacheWriteTokens = usage.cache_creation_input_tokens;
          }
          return skip;
        }

        case 'content_block_start': {
          const block = parsed.content_block as Record<string, unknown> | undefined;
          if (block?.type !== 'tool_use') return skip;
          return {
            done: false,
            value: {
              type: 'token',
              index: index++,
              data: {
                tool_calls: [{
                  index: (parsed.index as number) ?? 0,
                  id: block.id as string | undefined,
                  type: 'function' as const,
                  function: { name: block.name as string | undefined },
                }],
              },
            } as TokenStreamChunk,
          };
        }

        case 'content_block_delta': {
          const delta = parsed.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta') {
            return {
              done: false,
              value: {
                type: 'token',
                index: index++,
                data: { content: (delta.text as string) ?? '' },
              } as TokenStreamChunk,
            };
          }
          if (delta?.type === 'input_json_delta') {
            return {
              done: false,
              value: {
                type: 'token',
                index: index++,
                data: {
                  tool_calls: [{
                    index: (parsed.index as number) ?? 0,
                    function: { arguments: (delta.partial_json as string) ?? '' },
                  }],
                },
              } as TokenStreamChunk,
            };
          }
          return skip;
        }

        case 'message_delta': {
          const delta = parsed.delta as Record<string, unknown> | undefined;
          if (typeof delta?.stop_reason === 'string') stopReason = delta.stop_reason;
          const usage = parsed.usage as Record<string, unknown> | undefined;
          if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
          return skip;
        }

        case 'message_stop': {
          return {
            done: false,
            value: {
              type: 'done',
              index: index++,
              data: {
                requestId,
                modelId,
                finishReason: mapAnthropicStopReason(stopReason) ?? 'stop',
                // Routed through the shared normalizer so streamed responses
                // account for cached prompt tokens the same way non-streamed
                // ones do. `input_tokens` is Anthropic's uncached remainder,
                // so the cache components have to be added back in to get the
                // real prompt size -- reading it alone reported 0 here, which
                // zeroed out cost tracking for every streamed request.
                usage: normalizeAnthropicUsage({
                  input_tokens: inputTokens,
                  cache_read_input_tokens: cacheReadTokens,
                  cache_creation_input_tokens: cacheWriteTokens,
                  output_tokens: outputTokens,
                }),
              },
            } as DoneStreamChunk,
          };
        }

        case 'error': {
          const err = parsed.error as Record<string, unknown> | undefined;
          throw new Error(`Anthropic SSE error: ${(err?.message as string) ?? 'Unknown error'}`);
        }

        case 'content_block_stop':
        case 'ping':
        default:
          return skip;
      }
    },
    { dataRequired: true },
  );

  // Wire external abort signal → cancel the upstream ReadableStream. See
  // createOpenAISSEIterator for the full rationale.
  if (options?.signal) {
    const signal = options.signal;
    if (signal.aborted) {
      void eventStream.cancel(signal.reason);
    } else {
      const onAbort = () => { void eventStream.cancel(signal.reason); };
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
