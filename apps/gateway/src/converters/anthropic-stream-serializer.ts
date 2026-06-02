import type { StreamChunk, TokenStreamChunk, DoneStreamChunk, ErrorStreamChunk } from '@dmr-x/core';
import type { ClaudeStopReason } from '@dmr-x/utils';
import { ANTHROPIC_STOP_REASON_MAP } from './anthropic-converter.js';

interface AnthropicStreamOptions {
  model: string;
  requestId: string;
}

/**
 * Converts internal StreamChunk stream to Anthropic SSE event format.
 *
 * Anthropic streaming protocol:
 * 1. message_start - message envelope
 * 2. content_block_start - start of a content block
 * 3. content_block_delta - incremental content (one or more)
 * 4. content_block_stop - end of a content block
 * 5. message_delta - final stop_reason and usage
 * 6. message_stop - stream complete
 */
export async function* createAnthropicSSEStream(
  chunks: AsyncIterable<StreamChunk>,
  options: AnthropicStreamOptions
): AsyncGenerator<string> {
  let started = false;
  let blockStarted = false;
  let outputTokens = 0;

  const formatEvent = (eventType: string, data: object): string =>
    `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const data = (chunk as TokenStreamChunk).data;

      // Emit message_start on first token
      if (!started) {
        started = true;
        yield formatEvent('message_start', {
          type: 'message_start',
          message: {
            type: 'message',
            id: options.requestId,
            role: 'assistant',
            content: [],
            model: options.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });

        // Start first content block
        blockStarted = true;
        yield formatEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });
      }

      // Emit token delta
      const text = data.content ?? '';
      if (text) {
        outputTokens++;
        yield formatEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        });
      }
    } else if (chunk.type === 'done') {
      const data = (chunk as DoneStreamChunk).data;

      // Close content block if open
      if (blockStarted) {
        yield formatEvent('content_block_stop', {
          type: 'content_block_stop',
          index: 0,
        });
        blockStarted = false;
      }

      // Map finish reason using shared mapping from anthropic-converter
      const finishReason = data.finishReason ?? 'stop';
      const stopReason: ClaudeStopReason =
        (ANTHROPIC_STOP_REASON_MAP[finishReason] as ClaudeStopReason) ?? 'end_turn';

      // Emit message_delta with stop_reason and usage
      yield formatEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });

      // Emit message_stop
      yield formatEvent('message_stop', {
        type: 'message_stop',
      });
    } else if (chunk.type === 'error') {
      const data = (chunk as ErrorStreamChunk).data;

      // Emit error in Anthropic format
      yield formatEvent('error', {
        type: 'error',
        error: {
          type: 'api_error',
          message: data.message ?? 'Unknown error',
        },
      });
    }
  }

  // If stream ended without a done chunk, close gracefully
  if (started && blockStarted) {
    yield formatEvent('content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    });
    yield formatEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
    yield formatEvent('message_stop', {
      type: 'message_stop',
    });
  }
}
