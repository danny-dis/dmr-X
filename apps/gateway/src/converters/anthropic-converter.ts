import type {
  UnifiedRequest,
  UnifiedResponse,
  Message,
  ContentPart,
  Tool,
  ToolCall,
} from '@dmr-x/core';
import {
  fromClaudeMessages,
  type ClaudeMessageParam,
  type ClaudeTextBlockParam,
  type ClaudeImageBlockParam,
  type ClaudeToolUseBlockParam,
  type ClaudeToolResultBlockParam,
  type ClaudeThinkingBlock,
  type ClaudeRedactedThinkingBlockParam,
  type ClaudeDocumentBlockParam,
  type InputsUnion,
  type EasyInputMessage,
  type InputMessageItem,
  type FunctionCallOutputItem,
  type FunctionCallItem,
} from '@dmr-x/utils';

// --- Anthropic Wire Format Types ---
// These remain as the external API contract types.

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | { type: 'text'; text: string }[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: { user_id?: string };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: string; ttl?: string } | null }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
      cache_control?: { type: string; ttl?: string } | null;
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
      cache_control?: { type: string; ttl?: string } | null;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content?: string | AnthropicContentBlock[];
      cache_control?: { type: string; ttl?: string } | null;
    }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
      cache_control?: { type: string; ttl?: string } | null;
    };

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export interface AnthropicMessagesResponse {
  type: 'message';
  id: string;
  role: 'assistant';
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicResponseContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Bridge: InputsUnion -> Message[]
// ---------------------------------------------------------------------------

/**
 * Convert OpenResponses InputsUnion items (produced by fromClaudeMessages)
 * back to the gateway's internal Message[] format for UnifiedRequest.
 */
function inputsUnionToMessages(inputs: InputsUnion): Message[] {
  const messages: Message[] = [];

  for (const item of inputs) {
    // EasyInputMessage has no 'type' field -- it's { role, content }
    if (!('type' in item)) {
      const simple = item as EasyInputMessage;
      messages.push({ role: simple.role, content: simple.content });
      continue;
    }

    switch (item.type) {
      case 'message': {
        // InputMessageItem -- structured content with text/image parts
        const msgItem = item as InputMessageItem;
        const contentParts: ContentPart[] = msgItem.content.map((part) => {
          if (part.type === 'input_text') {
            return { type: 'text' as const, text: part.text };
          }
          // input_image
          return {
            type: 'image_url' as const,
            image_url: { url: part.imageUrl, detail: part.detail },
          };
        });
        // Map 'developer' role to 'assistant' (Anthropic doesn't have 'developer')
        const role = msgItem.role === 'developer' ? 'assistant' : msgItem.role;
        messages.push({ role: role as Message['role'], content: contentParts });
        break;
      }

      case 'function_call': {
        // FunctionCallItem -- assistant tool call
        const fcItem = item as FunctionCallItem;
        const toolCall: ToolCall = {
          id: fcItem.callId,
          type: 'function',
          function: {
            name: fcItem.name,
            arguments: fcItem.arguments,
          },
        };

        // Attach to the last assistant message if it exists,
        // otherwise create a new assistant message
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'assistant') {
          if (!lastMsg.tool_calls) {
            lastMsg.tool_calls = [];
          }
          lastMsg.tool_calls.push(toolCall);
        } else {
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [toolCall],
          });
        }
        break;
      }

      case 'function_call_output': {
        // FunctionCallOutputItem -- tool result from user
        const fcOutput = item as FunctionCallOutputItem;
        messages.push({
          role: 'tool',
          tool_call_id: fcOutput.callId,
          content: fcOutput.output,
        });
        break;
      }

      case 'image_generation_call': {
        // Not directly representable as a Message -- skip
        break;
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Request conversion: Anthropic -> Unified
// ---------------------------------------------------------------------------

export function convertAnthropicRequestToUnified(
  body: AnthropicMessagesRequest,
  metadata: Record<string, unknown>
): UnifiedRequest {
  // Extract system prompt before passing messages to fromClaudeMessages
  // (Anthropic's system is a top-level field, not a message)
  let systemContent: string | undefined;
  if (body.system) {
    systemContent = typeof body.system === 'string'
      ? body.system
      : body.system.map(b => b.text).join('');
  }

  // Use fromClaudeMessages to parse Anthropic message content blocks
  // into the OpenResponses InputsUnion format.
  // AnthropicContentBlock is a subset of ClaudeContentBlockParam, so the cast is safe.
  type ClaudeContentBlockUnion =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam
    | ClaudeToolUseBlockParam
    | ClaudeToolResultBlockParam
    | ClaudeThinkingBlock
    | ClaudeRedactedThinkingBlockParam
    | ClaudeDocumentBlockParam;
  const claudeMessages: ClaudeMessageParam[] = body.messages.map(msg => ({
    role: msg.role,
    content: msg.content as string | ClaudeContentBlockUnion[],
  }));
  const inputs = fromClaudeMessages(claudeMessages);

  // Bridge from InputsUnion to internal Message[] format
  const messages = inputsUnionToMessages(inputs);

  // Prepend system message if present
  if (systemContent) {
    messages.unshift({ role: 'system', content: systemContent });
  }

  // Convert tools (DMR-X specific -- fromClaudeMessages doesn't handle tools)
  const tools: Tool[] | undefined = body.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // Convert tool_choice (DMR-X specific)
  let toolChoice: UnifiedRequest['tool_choice'];
  if (body.tool_choice) {
    switch (body.tool_choice.type) {
      case 'auto':
        toolChoice = 'auto';
        break;
      case 'any':
        toolChoice = 'required';
        break;
      case 'none':
        toolChoice = 'none';
        break;
      case 'tool':
        toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
        break;
    }
  }

  return {
    modality: 'llm',
    model: body.model,
    messages,
    tools,
    tool_choice: toolChoice,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stop: body.stop_sequences,
    stream: body.stream ?? false,
    user: body.metadata?.user_id,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Response conversion: Unified -> Anthropic
// ---------------------------------------------------------------------------

// Stop reason mapping shared between response and stream serializer
export const ANTHROPIC_STOP_REASON_MAP: Record<string, AnthropicMessagesResponse['stop_reason']> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'end_turn',
};

export function convertUnifiedResponseToAnthropic(
  response: UnifiedResponse
): AnthropicMessagesResponse {
  const content: AnthropicResponseContentBlock[] = [];

  // Add text content
  if (response.message?.content) {
    content.push({ type: 'text', text: response.message.content as string });
  }

  // Add tool_use blocks
  if (response.message?.tool_calls) {
    for (const tc of response.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  const stopReason = response.finishReason
    ? (ANTHROPIC_STOP_REASON_MAP[response.finishReason] ?? null)
    : null;

  return {
    type: 'message',
    id: response.requestId,
    role: 'assistant',
    content,
    model: response.modelId,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
