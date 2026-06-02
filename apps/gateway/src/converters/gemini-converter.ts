import type {
  UnifiedRequest,
  UnifiedResponse,
  Message,
  ContentPart,
  Tool,
  ToolCall,
} from '@dmr-x/core';

// --- Gemini Wire Format Types ---

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: 'AUTO' | 'ANY' | 'NONE';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
    thinkingConfig?: { thinkingBudget?: number };
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  stream?: boolean;
}

export interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string; thought?: boolean }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }
  | { inlineData: { mimeType: string; data: string } };

export interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}

export interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content: GeminiContent;
    finishReason?: string;
    index?: number;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

// ---------------------------------------------------------------------------
// Finish reason mapping (shared with stream serializer)
// ---------------------------------------------------------------------------

export const GEMINI_FINISH_REASON_MAP: Record<string, string> = {
  stop: 'STOP',
  length: 'MAX_TOKENS',
  tool_calls: 'STOP',
  content_filter: 'SAFETY',
};

const GEMINI_FINISH_REASON_REVERSE: Record<string, UnifiedResponse['finishReason']> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  OTHER: 'stop',
};

// ---------------------------------------------------------------------------
// Request conversion: Gemini -> Unified
// ---------------------------------------------------------------------------

export function convertGeminiRequestToUnified(
  body: GeminiGenerateContentRequest,
  metadata: Record<string, unknown>
): UnifiedRequest {
  const messages: Message[] = [];
  const thoughts: string[] = [];

  // Extract system instruction
  if (body.systemInstruction) {
    const systemParts = extractTextParts(body.systemInstruction.parts);
    if (systemParts) {
      messages.push({ role: 'system', content: systemParts });
    }
  }

  // Convert contents to messages
  for (const content of body.contents) {
    const role = content.role === 'model' ? 'assistant' : content.role;

    // Separate text, tool calls, tool responses, and images
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const imageParts: ContentPart[] = [];

    for (const part of content.parts) {
      if ('text' in part) {
        if (part.thought) {
          thoughts.push(part.text);
        } else {
          textParts.push(part.text);
        }
      } else if ('functionCall' in part) {
        toolCalls.push({
          id: part.functionCall.name,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      } else if ('functionResponse' in part) {
        // Tool result -> separate tool message
        messages.push({
          role: 'tool',
          tool_call_id: part.functionResponse.name,
          content: JSON.stringify(part.functionResponse.response),
        });
        continue; // Don't create a message for this part
      } else if ('inlineData' in part) {
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          },
        });
      }
    }

    // Build message from collected parts
    if (role === 'function') {
      // functionResponse parts already emitted as tool messages above
      continue;
    }

    const msg: Message = { role: role as Message['role'], content: '' };

    // Combine text and image parts into content
    if (imageParts.length > 0) {
      const contentParts: ContentPart[] = imageParts.slice();
      if (textParts.length > 0) {
        contentParts.unshift({ type: 'text', text: textParts.join('') });
      }
      msg.content = contentParts;
    } else if (textParts.length > 0) {
      msg.content = textParts.join('');
    }

    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
    }

    messages.push(msg);
  }

  // Convert tools
  const tools: Tool[] | undefined = body.tools?.flatMap(t =>
    t.functionDeclarations.map(fd => ({
      type: 'function' as const,
      function: {
        name: fd.name,
        description: fd.description,
        parameters: fd.parameters,
      },
    }))
  );

  // Convert tool_choice
  let toolChoice: UnifiedRequest['tool_choice'];
  const fcConfig = body.toolConfig?.functionCallingConfig;
  if (fcConfig) {
    switch (fcConfig.mode) {
      case 'AUTO':
        toolChoice = fcConfig.allowedFunctionNames?.length === 1
          ? { type: 'function', function: { name: fcConfig.allowedFunctionNames[0] } }
          : 'auto';
        break;
      case 'ANY':
        toolChoice = 'required';
        break;
      case 'NONE':
        toolChoice = 'none';
        break;
    }
  }

  // Map generationConfig
  const genConfig = body.generationConfig;

  return {
    modality: 'llm',
    model: undefined, // model is determined by the router, not the request body for Gemini
    messages,
    tools,
    tool_choice: toolChoice,
    temperature: genConfig?.temperature,
    max_tokens: genConfig?.maxOutputTokens,
    top_p: genConfig?.topP,
    stop: genConfig?.stopSequences,
    stream: body.stream ?? false,
    response_format: genConfig?.responseMimeType === 'application/json'
      ? { type: 'json_object' }
      : undefined,
    metadata: {
      ...metadata,
      ...(thoughts.length > 0 ? { thoughts: thoughts.join('') } : {}),
      ...(body.safetySettings ? { safetySettings: body.safetySettings } : {}),
      ...(genConfig?.topK ? { topK: genConfig.topK } : {}),
      ...(genConfig?.candidateCount ? { candidateCount: genConfig.candidateCount } : {}),
      ...(genConfig?.thinkingConfig ? { thinkingConfig: genConfig.thinkingConfig } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Response conversion: Unified -> Gemini
// ---------------------------------------------------------------------------

export function convertUnifiedResponseToGemini(
  response: UnifiedResponse
): GeminiGenerateContentResponse {
  const parts: GeminiPart[] = [];

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
      parts.push({
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        },
      });
    }
  }

  // Map finish reason
  const finishReason = response.finishReason
    ? (GEMINI_FINISH_REASON_MAP[response.finishReason] ?? 'STOP')
    : 'STOP';

  // Add thought parts from metadata if present
  const thoughtsText = response.message?.content
    ? undefined
    : undefined; // thoughts are in metadata, not in the message

  return {
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
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTextParts(parts: GeminiPart[]): string | undefined {
  const texts = parts
    .filter((p): p is { text: string; thought?: boolean } => 'text' in p && !p.thought)
    .map(p => p.text);
  return texts.length > 0 ? texts.join('') : undefined;
}
