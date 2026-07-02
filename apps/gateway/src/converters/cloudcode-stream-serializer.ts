import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';
import type { CloudCodePart } from './cloudcode-converter.js';
import type { CloudCodeResponse } from './cloudcode-response-converter.js';

interface CloudCodeStreamOptions {
  model: string;
  requestId: string;
}

/**
 * Converts internal StreamChunk stream to Cloud Code SSE format.
 *
 * Cloud Code streaming protocol:
 * - Uses plain `data: {JSON}\n\n` lines
 * - Each SSE event contains a CloudCodeResponse with the accumulated text so far
 * - Final event includes finishReason and usageMetadata
 * - Stream ends when connection closes (no explicit [DONE] sentinel)
 */
export async function* createCloudCodeSSEStream(
  chunks: AsyncIterable<StreamChunk>,
  options: CloudCodeStreamOptions,
): AsyncGenerator<string> {
  let outputTokens = 0;
  let finishReason = 'STOP';

  // Accumulate text across tokens (Cloud Code sends complete growing responses)
  const textParts: string[] = [];

  // Accumulate tool calls
  const toolCallParts: CloudCodePart[] = [];

  const formatResponse = (
    parts: CloudCodePart[],
    done: boolean,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  ): string => {
    const response: CloudCodeResponse = {
      response: {
        candidates: [
          {
            content: { role: 'model', parts },
            ...(done ? { finishReason } : {}),
            index: 0,
          },
        ],
        modelVersion: options.model,
        responseId: options.requestId,
      },
      traceId: options.requestId,
      metadata: {},
    };

    if (done && usage) {
      response.response.usageMetadata = {
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
              (p) => 'functionCall' in p && p.functionCall.name === tc.function!.name,
            );
            if (!existing) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                // If JSON parsing fails, use empty args
              }
              toolCallParts.push({
                functionCall: {
                  name: tc.function.name,
                  id: tc.id,
                  args,
                },
              });
            }
          }
        }
      }

      // Emit complete response with accumulated state
      const parts: CloudCodePart[] = [];
      if (textParts.length > 0) {
        parts.push({ text: textParts.join('') });
      }
      parts.push(...toolCallParts);

      yield formatResponse(parts, false);
    } else if (chunk.type === 'done') {
      const doneChunk = chunk as DoneStreamChunk;
      const usage = doneChunk.data as any;

      // Emit final response with usage metadata
      const parts: CloudCodePart[] = [];
      if (textParts.length > 0) {
        parts.push({ text: textParts.join('') });
      }
      parts.push(...toolCallParts);

      yield formatResponse(parts, true, {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? outputTokens,
        total_tokens: usage?.total_tokens ?? outputTokens,
      });
    } else if (chunk.type === 'error') {
      // Error chunks are handled by the caller; skip here
    }
  }
}
