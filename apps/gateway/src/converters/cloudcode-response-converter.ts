import type { UnifiedResponse } from '@dmr-x/core';
import type { CloudCodePart } from './cloudcode-converter.js';

// ---------------------------------------------------------------------------
// Cloud Code Response Types
// ---------------------------------------------------------------------------

export interface CloudCodeResponse {
  response: {
    candidates: Array<{
      content: {
        role: 'model';
        parts: CloudCodePart[];
      };
      finishReason?: string;
      index: number;
      safetyRatings?: Array<{ category: string; probability: string }>;
      citationMetadata?: Record<string, unknown>;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
    modelVersion?: string;
    responseId?: string;
  };
  traceId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Finish reason mapping (Unified -> Cloud Code)
// ---------------------------------------------------------------------------

const FINISH_REASON_MAP: Record<string, string> = {
  stop: 'STOP',
  length: 'MAX_TOKENS',
  tool_calls: 'STOP',
  content_filter: 'SAFETY',
};

// ---------------------------------------------------------------------------
// Response conversion: Unified -> Cloud Code
// ---------------------------------------------------------------------------

export function convertUnifiedResponseToCloudCode(
  response: UnifiedResponse,
  requestId: string,
): CloudCodeResponse {
  const parts: CloudCodePart[] = [];

  // Add text content
  if (response.message?.content) {
    if (typeof response.message.content === 'string') {
      parts.push({ text: response.message.content });
    } else {
      for (const part of response.message.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        }
      }
    }
  }

  // Add function calls
  if (response.message?.tool_calls) {
    for (const tc of response.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // If JSON parsing fails, use empty args
      }
      parts.push({
        functionCall: {
          name: tc.function.name,
          id: tc.id,
          args,
        },
      });
    }
  }

  // Map finish reason
  const finishReason = response.finishReason
    ? (FINISH_REASON_MAP[response.finishReason] ?? 'STOP')
    : 'STOP';

  return {
    response: {
      candidates: [
        {
          content: { role: 'model', parts },
          finishReason,
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: response.usage?.prompt_tokens ?? 0,
        candidatesTokenCount: response.usage?.completion_tokens ?? 0,
        totalTokenCount: response.usage?.total_tokens ?? 0,
      },
      modelVersion: response.modelId,
      responseId: response.requestId,
    },
    traceId: requestId,
    metadata: {},
  };
}
