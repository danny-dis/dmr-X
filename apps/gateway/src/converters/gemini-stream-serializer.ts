import type { StreamChunk, TokenStreamChunk, DoneStreamChunk, ErrorStreamChunk } from '@dmr-x/core';

import { GEMINI_FINISH_REASON_MAP } from './gemini-converter.js';
import type { GeminiGenerateContentResponse, GeminiPart } from './gemini-converter.js';

interface GeminiStreamOptions {
  model: string;
  requestId: string;
}

/**
 * Converts internal StreamChunk stream to Gemini SSE format.
 *
 * Gemini streaming protocol:
 * - Uses plain `data: {JSON}\n\n` lines (no named events like Anthropic)
 * - Each SSE event contains a complete GenerateContentResponse with
 *   the accumulated text so far (not incremental deltas)
 * - Final event includes finishReason and usageMetadata
 */
export async function* createGeminiSSEStream(
  chunks: AsyncIterable<StreamChunk>,
  options: GeminiStreamOptions
): AsyncGenerator<string> {
  let started = false;
  let outputTokens = 0;
  let finishReason = 'STOP';

  // Accumulate text across tokens (Gemini sends complete growing responses)
  const textParts: string[] = [];

  // Accumulate tool calls
  const toolCallParts: GeminiPart[] = [];

  const formatResponse = (
    parts: GeminiPart[],
    done: boolean,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  ): string => {
    const response: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: { role: 'model', parts },
          ...(done ? { finishReason } : {}),
          index: 0,
        },
      ],
      modelVersion: options.model,
    };

    if (done && usage) {
      response.usageMetadata = {
        promptTokenCount: usage.prompt_tokens,
        candidatesTokenCount: usage.completion_tokens,
        totalTokenCount: usage.total_tokens,
      };
    }

    return `data: ${JSON.stringify(response)}\n\n`;
  };

  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      const data = (chunk as TokenStreamChunk).data;
      started = true;

      // Accumulate text content
      if (data.content) {
        textParts.push(data.content);
        outputTokens++;
      }

      // Accumulate tool calls
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          if (tc.function?.name && tc.function?.arguments) {
            // Check if we already have a tool call with this name
            const existing = toolCallParts.find(
              p => 'functionCall' in p && p.functionCall.name === tc.function!.name
            );
            if (!existing) {
              toolCallParts.push({
                functionCall: {
                  name: tc.function.name,
                  args: JSON.parse(tc.function.arguments),
                },
              });
            }
          }
        }
      }

      // Emit complete response with accumulated state
      const parts: GeminiPart[] = [];
      if (textParts.length > 0) {
        parts.push({ text: textParts.join('') });
      }
      parts.push(...toolCallParts);

      yield formatResponse(parts, false);

    } else if (chunk.type === 'done') {
      const data = (chunk as DoneStreamChunk).data;
      started = true;

      // Map finish reason
      if (data.finishReason) {
        finishReason = GEMINI_FINISH_REASON_MAP[data.finishReason] ?? 'STOP';
      }

      // Build final parts
      const parts: GeminiPart[] = [];
      if (textParts.length > 0) {
        parts.push({ text: textParts.join('') });
      }
      parts.push(...toolCallParts);

      yield formatResponse(parts, true, data.usage);

    } else if (chunk.type === 'error') {
      const data = (chunk as ErrorStreamChunk).data;
      yield `data: ${JSON.stringify({ error: { message: data.message ?? 'Unknown error', code: 500 } })}\n\n`;
    }
  }

  // If stream ended without a done chunk, close gracefully
  if (started) {
    const parts: GeminiPart[] = [];
    if (textParts.length > 0) {
      parts.push({ text: textParts.join('') });
    }
    parts.push(...toolCallParts);

    yield formatResponse(parts, true);
  }
}
