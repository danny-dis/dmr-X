import type {
  UnifiedRequest,
  Message,
  ContentPart,
  Tool,
  ToolCall,
} from '@dmr-x/core';

// ---------------------------------------------------------------------------
// Cloud Code Wire Format Types
// ---------------------------------------------------------------------------

export interface CloudCodeRequest {
  project?: string;
  model?: string;
  request?: CloudCodeGenerateRequest;
  requestType?: string;
  userAgent?: string;
  requestId?: string;
}

export interface CloudCodeGenerateRequest {
  contents?: CloudCodeContent[];
  systemInstruction?: CloudCodeContent;
  tools?: CloudCodeTool[];
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
    thinkingConfig?: {
      includeThoughts?: boolean;
      thinkingBudget?: number;
    };
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

export interface CloudCodeContent {
  role: 'user' | 'model' | 'function';
  parts: CloudCodePart[];
}

export type CloudCodePart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; id?: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; id?: string; response: Record<string, unknown> } }
  | { inlineData: { mimeType: string; data: string } };

export interface CloudCodeTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}

// JSON Schema keywords not supported by Google/Gemini protobuf
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'patternProperties', 'additionalProperties', '$schema', '$id', '$ref',
  '$defs', 'definitions', 'examples', 'minLength', 'maxLength', 'minimum',
  'maximum', 'multipleOf', 'pattern', 'format', 'minItems', 'maxItems',
  'uniqueItems', 'minProperties', 'maxProperties', 'default',
]);

// ---------------------------------------------------------------------------
// Request conversion: Cloud Code -> Unified
// ---------------------------------------------------------------------------

export function convertCloudCodeRequestToUnified(
  body: CloudCodeRequest,
  metadata: Record<string, unknown> = {},
): UnifiedRequest {
  const req = body.request;
  const messages: Message[] = [];

  // Extract system instruction
  if (req?.systemInstruction) {
    const systemText = extractTextParts(req.systemInstruction.parts);
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Convert contents to messages
  if (req?.contents) {
    for (const content of req.contents) {
      const role = content.role === 'model' ? 'assistant' : content.role;

      // functionResponse parts become tool messages
      const functionResponseParts = content.parts.filter(
        (p): p is Extract<CloudCodePart, { functionResponse: unknown }> =>
          'functionResponse' in p,
      );
      for (const fr of functionResponseParts) {
        messages.push({
          role: 'tool',
          tool_call_id: fr.functionResponse.id ?? fr.functionResponse.name,
          content: JSON.stringify(fr.functionResponse.response),
        });
      }

      // Skip pure functionResponse contents (already emitted as tool messages)
      const nonFunctionResponseParts = content.parts.filter(
        (p) => !('functionResponse' in p),
      );
      if (nonFunctionResponseParts.length === 0 && functionResponseParts.length > 0) {
        continue;
      }

      // Build message from remaining parts
      const textParts: string[] = [];
      const thoughtParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      const imageParts: ContentPart[] = [];

      for (const part of nonFunctionResponseParts) {
        if ('text' in part) {
          if (part.thought) {
            thoughtParts.push(part.text);
          } else {
            textParts.push(part.text);
          }
        } else if ('functionCall' in part) {
          toolCalls.push({
            id: part.functionCall.id ?? part.functionCall.name,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          });
        } else if ('inlineData' in part) {
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            },
          });
        }
      }

      // Build the message
      const msg: Message = { role: role as Message['role'], content: '' };

      if (imageParts.length > 0) {
        const contentParts: ContentPart[] = [...imageParts];
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
  }

  // Convert tools (with schema sanitization for Google compatibility)
  const tools: Tool[] | undefined = req?.tools?.flatMap((t) =>
    t.functionDeclarations.map((fd) => ({
      type: 'function' as const,
      function: {
        name: fd.name,
        description: fd.description,
        parameters: fd.parameters ? sanitizeSchema(fd.parameters) : undefined,
      },
    })),
  );

  // Convert tool_choice
  let toolChoice: UnifiedRequest['tool_choice'];
  const fcConfig = req?.toolConfig?.functionCallingConfig;
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

  // Map generation config
  const genConfig = req?.generationConfig;

  return {
    modality: 'llm',
    model: body.model, // Cloud Code model ID (e.g., "gemini-2.5-flash")
    messages,
    tools,
    tool_choice: toolChoice,
    temperature: genConfig?.temperature,
    max_tokens: genConfig?.maxOutputTokens,
    top_p: genConfig?.topP,
    stop: genConfig?.stopSequences,
    stream: true, // Cloud Code always uses streaming
    response_format: genConfig?.responseMimeType === 'application/json'
      ? { type: 'json_object' }
      : undefined,
    metadata: {
      ...metadata,
      cloudCodeProject: body.project,
      cloudCodeRequestId: body.requestId,
      cloudCodeRequestType: body.requestType,
      cloudCodeUserAgent: body.userAgent,
      ...(genConfig?.thinkingConfig ? { thinkingConfig: genConfig.thinkingConfig } : {}),
      ...(req?.safetySettings ? { safetySettings: req.safetySettings } : {}),
      ...(genConfig?.topK ? { topK: genConfig.topK } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Schema sanitization for Google protobuf compatibility
// ---------------------------------------------------------------------------

function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      cleaned[key] = sanitizeSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map((item) =>
        item && typeof item === 'object'
          ? sanitizeSchema(item as Record<string, unknown>)
          : item,
      );
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTextParts(parts: CloudCodePart[]): string | undefined {
  const texts = parts
    .filter((p): p is { text: string; thought?: boolean } => 'text' in p && !p.thought)
    .map((p) => p.text);
  return texts.length > 0 ? texts.join('') : undefined;
}
