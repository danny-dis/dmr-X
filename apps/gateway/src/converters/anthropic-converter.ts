import type { UnifiedRequest, UnifiedResponse, Message, Tool, ToolCall } from '@dmr-x/core';

// --- Anthropic Wire Format Types ---

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | AnthropicContentBlock[];
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
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: string | AnthropicContentBlock[] };

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

// --- Conversion Functions ---

export function convertAnthropicRequestToUnified(
  body: AnthropicMessagesRequest,
  metadata: Record<string, unknown>
): UnifiedRequest {
  const messages: Message[] = [];

  // Extract system prompt into a message
  if (body.system) {
    const systemContent = typeof body.system === 'string'
      ? body.system
      : body.system.map(b => b.type === 'text' ? b.text : '').join('');
    messages.push({ role: 'system', content: systemContent });
  }

  // Convert messages
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Handle content blocks
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const toolResults: Message[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          textParts.push(block.text);
          break;
        case 'image':
          // Convert Anthropic image to unified image_url format
          textParts.push(''); // placeholder, images go in content parts
          break;
        case 'tool_use':
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
          break;
        case 'tool_result':
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content),
          });
          break;
      }
    }

    // For assistant messages with tool_calls
    if (msg.role === 'assistant' && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: textParts.join('') || '',
        tool_calls: toolCalls,
      });
      continue;
    }

    // For user messages, emit text first, then tool results as separate messages
    if (textParts.join('').trim()) {
      messages.push({ role: msg.role, content: textParts.join('') });
    }
    for (const tr of toolResults) {
      messages.push(tr);
    }
  }

  // Convert tools
  const tools: Tool[] | undefined = body.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // Convert tool_choice
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

  // Map finish reason
  const stopReasonMap: Record<string, AnthropicMessagesResponse['stop_reason']> = {
    stop: 'end_turn',
    tool_calls: 'tool_use',
    length: 'max_tokens',
    content_filter: 'end_turn',
  };
  const stopReason = response.finishReason
    ? (stopReasonMap[response.finishReason] ?? null)
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
