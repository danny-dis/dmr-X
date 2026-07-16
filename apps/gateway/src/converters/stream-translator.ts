import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';
import type { WireFormat } from './crossformat.js';

/**
 * Re-encode an internal StreamChunk stream into the target wire format.
 * Used when an OpenAI-format request is served by an Anthropic provider
 * and the response must be re-encoded as OpenAI SSE.
 */
export async function* translateStream(
  chunks: AsyncIterable<StreamChunk>,
  targetFormat: WireFormat,
  requestId: string,
  model: string,
): AsyncGenerator<string> {
  if (targetFormat === 'openai') {
    yield* toOpenAIStream(chunks, requestId);
  } else if (targetFormat === 'anthropic') {
    yield* toAnthropicStream(chunks, requestId, model);
  } else if (targetFormat === 'gemini') {
    yield* toGeminiStream(chunks, requestId);
  }
}

async function* toOpenAIStream(chunks: AsyncIterable<StreamChunk>, requestId: string): AsyncGenerator<string> {
  let sentRole = false;
  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const data = (chunk as TokenStreamChunk).data;
      const content = data?.content;
      if (!sentRole && content) {
        sentRole = true;
        yield `data: ${JSON.stringify({
          id: requestId,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        })}\n\n`;
      }
      if (content) {
        yield `data: ${JSON.stringify({
          id: requestId,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`;
      }
    } else if (chunk.type === 'done') {
      const done = chunk as DoneStreamChunk;
      const usage = done.data?.usage;
      yield `data: ${JSON.stringify({
        id: requestId,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: usage ? {
          prompt_tokens: usage.prompt_tokens ?? 0,
          completion_tokens: usage.completion_tokens ?? 0,
          total_tokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        } : undefined,
      })}\n\n`;
      yield 'data: [DONE]\n\n';
    }
  }
}

async function* toAnthropicStream(chunks: AsyncIterable<StreamChunk>, requestId: string, model: string): AsyncGenerator<string> {
  const fmt = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  // Build the SSE lines for all accumulated (completed) tool calls. Returns a
  // string[] so it can be `yield*`-ed without nesting a generator helper
  // (illegal inside an async generator).
  const flushToolCalls = (
    toolCallsByIndex: Map<number, { id?: string; name?: string; args: string }>,
    state: { nextIndex: number }
  ): string[] => {
    const out: string[] = [];
    for (const [, tc] of toolCallsByIndex) {
      if (tc.name === undefined) continue;
      const index = state.nextIndex++;
      out.push(fmt('content_block_start', {
        type: 'content_block_start', index,
        content_block: { type: 'tool_use', id: tc.id ?? `toolu_${index}`, name: tc.name, input: {} },
      }));
      out.push(fmt('content_block_delta', {
        type: 'content_block_delta', index,
        delta: { type: 'input_json_delta', partial_json: tc.args || '{}' },
      }));
      out.push(fmt('content_block_stop', { type: 'content_block_stop', index }));
    }
    toolCallsByIndex.clear();
    return out;
  };

  yield fmt('message_start', {
    type: 'message_start',
    message: {
      type: 'message', id: requestId, role: 'assistant',
      content: [], model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  yield fmt('content_block_start', {
    type: 'content_block_start', index: 0,
    content_block: { type: 'text', text: '' },
  });

  let outputTokens = 0;
  let textBlockOpen = true;
  const state = { nextIndex: 1 }; // 0 reserved for the opening text block

  // Accumulated streamed tool calls, keyed by OpenAI tool-call index.
  const toolCallsByIndex = new Map<number, { id?: string; name?: string; args: string }>();

  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const data = (chunk as TokenStreamChunk).data;

      // Tool calls: accumulate so they can be replayed as tool_use blocks.
      const toolCalls = data?.tool_calls;
      if (toolCalls && toolCalls.length) {
        for (const tc of toolCalls) {
          const idx = tc.index ?? 0;
          const existing = toolCallsByIndex.get(idx) ?? { args: '' };
          if (tc.id !== undefined) existing.id = tc.id;
          if (tc.function?.name !== undefined) existing.name = tc.function.name;
          if (tc.function?.arguments !== undefined) existing.args += tc.function.arguments;
          toolCallsByIndex.set(idx, existing);
        }
        continue;
      }

      const text = data?.content ?? '';
      if (text) {
        outputTokens++;
        yield fmt('content_block_delta', {
          type: 'content_block_delta', index: 0,
          delta: { type: 'text_delta', text },
        });
      }
    } else if (chunk.type === 'done') {
      if (textBlockOpen) {
        yield fmt('content_block_stop', { type: 'content_block_stop', index: 0 });
        textBlockOpen = false;
      }
      // Replay accumulated tool calls as tool_use content blocks so a
      // streaming Anthropic client doesn't hang on a tool_use stop_reason
      // with no tool_use block.
      if (toolCallsByIndex.size) {
        yield* flushToolCalls(toolCallsByIndex, state);
      }
      yield fmt('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });
      yield fmt('message_stop', { type: 'message_stop' });
    }
  }
}

async function* toGeminiStream(chunks: AsyncIterable<StreamChunk>, requestId: string): AsyncGenerator<string> {
  const fmt = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

  yield fmt({
    candidates: [{
      content: { role: 'model', parts: [] },
      index: 0,
    }],
    modelVersion: requestId,
  });

  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const text = (chunk as TokenStreamChunk).data?.content ?? '';
      if (text) {
        yield fmt({
          candidates: [{
            content: { role: 'model', parts: [{ text }] },
            index: 0,
          }],
        });
      }
    } else if (chunk.type === 'done') {
      const done = chunk as DoneStreamChunk;
      yield fmt({
        candidates: [{
          content: { role: 'model', parts: [] },
          finishReason: 'STOP',
          index: 0,
        }],
        usageMetadata: {
          promptTokenCount: done.data?.usage?.prompt_tokens ?? 0,
          candidatesTokenCount: done.data?.usage?.completion_tokens ?? 0,
          totalTokenCount: (done.data?.usage?.prompt_tokens ?? 0) + (done.data?.usage?.completion_tokens ?? 0),
        },
      });
    }
  }
}
