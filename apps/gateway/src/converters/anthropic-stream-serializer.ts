import type { StreamChunk, TokenStreamChunk, DoneStreamChunk, ErrorStreamChunk } from '@dmr-x/core';
import type { ClaudeStopReason } from '@dmr-x/utils';

import { ANTHROPIC_STOP_REASON_MAP } from './anthropic-converter.js';

interface AnthropicStreamOptions {
  model: string;
  requestId: string;
}

type ToolCallAcc = { id?: string; name?: string; args: string };

/**
 * Converts internal StreamChunk stream to Anthropic SSE event format.
 *
 * Anthropic streaming protocol:
 * 1. message_start - message envelope
 * 2. content_block_start - start of a content block (text OR tool_use)
 * 3. content_block_delta - incremental content (text_delta or input_json_delta)
 * 4. content_block_stop - end of a content block
 * 5. message_delta - final stop_reason and usage
 * 6. message_stop - stream complete
 *
 * CRITICAL: when `tools[]` is present the model emits `tool_calls` inside the
 * `token` chunk's `data`. Previously these were silently dropped, so a streaming
 * Anthropic client received `stop_reason: tool_use` with NO `tool_use` content
 * block and hung forever waiting for a block that never arrived. We now
 * accumulate streamed tool calls and replay them as proper `tool_use` content
 * blocks (content_block_start / input_json_delta / content_block_stop) before
 * `message_delta`. The index is monotonically increasing so text and tool_use
 * blocks are correctly interleaved.
 */
export async function* createAnthropicSSEStream(
  chunks: AsyncIterable<StreamChunk>,
  options: AnthropicStreamOptions
): AsyncGenerator<string> {
  const formatEvent = (eventType: string, data: object): string =>
    `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  // Build the SSE lines for all accumulated (completed) tool calls. Returned
  // as a string[] rather than yielded directly so it can be reused from both
  // the `done` branch and the graceful-close branch without nesting generator
  // helpers (which is illegal in async generators).
  const flushToolCalls = (
    toolCallsByIndex: Map<number, ToolCallAcc>,
    state: { nextIndex: number }
  ): string[] => {
    const out: string[] = [];
    for (const [, tc] of toolCallsByIndex) {
      if (tc.name === undefined) continue; // incomplete streamed call, skip
      const index = state.nextIndex++;
      out.push(formatEvent('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: tc.id ?? `toolu_${index}`, name: tc.name, input: {} },
      }));
      out.push(formatEvent('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: tc.args || '{}' },
      }));
      out.push(formatEvent('content_block_stop', {
        type: 'content_block_stop',
        index,
      }));
    }
    toolCallsByIndex.clear();
    return out;
  };

  let started = false;
  let blockStarted = false;
  let outputTokens = 0;
  let doneReceived = false;
  const state = { nextIndex: 0 };

  // Accumulated tool calls, keyed by the OpenAI tool-call index.
  const toolCallsByIndex = new Map<number, ToolCallAcc>();

  for await (const chunk of chunks) {
    // Emit message_start on the first non-error chunk. Previously this fired
    // only on the first *text* token, which meant a tool-call-only stream
    // (model emits tool_calls with no text) never opened the message and the
    // client hung. Errors still short-circuit without a message envelope.
    if (!started && chunk.type !== 'error') {
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
    }

    if (chunk.type === 'token') {
      const data = (chunk as TokenStreamChunk).data;

      // --- Tool calls: accumulate so we can replay them as tool_use blocks ---
      const toolCalls = (data as { tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }> }).tool_calls;
      if (toolCalls && toolCalls.length) {
        for (const tc of toolCalls) {
          const idx = tc.index ?? 0;
          const existing = toolCallsByIndex.get(idx) ?? { args: '' };
          if (tc.id !== undefined) existing.id = tc.id;
          if (tc.function?.name !== undefined) existing.name = tc.function.name;
          if (tc.function?.arguments !== undefined) existing.args += tc.function.arguments;
          toolCallsByIndex.set(idx, existing);
        }
        continue; // tool-call chunks carry no text content
      }

      // --- Plain text delta ---
      if (!blockStarted) {
        blockStarted = true;
        yield formatEvent('content_block_start', {
          type: 'content_block_start',
          index: state.nextIndex++,
          content_block: { type: 'text', text: '' },
        });
      }

      const text = data.content ?? '';
      if (text) {
        outputTokens++;
        yield formatEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.nextIndex - 1,
          delta: { type: 'text_delta', text },
        });
      }
    } else if (chunk.type === 'done') {
      const data = (chunk as DoneStreamChunk).data;
      doneReceived = true;
      // Close the open text block (if any) before emitting tool_use blocks.
      if (blockStarted) {
        yield formatEvent('content_block_stop', {
          type: 'content_block_stop',
          index: state.nextIndex - 1,
        });
        blockStarted = false;
      }

      // Replay accumulated tool calls as tool_use content blocks. This is the
      // missing piece: without it the client gets a tool_use stop_reason but
      // no tool_use block and hangs.
      if (toolCallsByIndex.size) {
        yield* flushToolCalls(toolCallsByIndex, state);
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

  // If stream ended without a done chunk, close gracefully.
  if (started && !doneReceived) {
    if (blockStarted) {
      yield formatEvent('content_block_stop', {
        type: 'content_block_stop',
        index: state.nextIndex - 1,
      });
      blockStarted = false;
    }
    if (toolCallsByIndex.size) {
      yield* flushToolCalls(toolCallsByIndex, state);
    }
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
