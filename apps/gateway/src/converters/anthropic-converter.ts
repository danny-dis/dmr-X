import type {
  UnifiedRequest,
  UnifiedResponse,
  Message,
  ContentPart,
  Tool,
  ToolCall,
  CacheControl,
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
  system?: string | { type: 'text'; text: string; cache_control?: { type: string; ttl?: string } | null }[];
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
// Inbound cache_control reconstruction
// ---------------------------------------------------------------------------

/**
 * `fromClaudeMessages` (packages/utils) intentionally drops `cache_control` --
 * it has no internal representation for it. Recovering it here means walking
 * the original wire blocks a second time, in lockstep with the same
 * grouping/ordering rules `fromClaudeMessages` + `inputsUnionToMessages` use,
 * so a cursor over the already-built `messages` array lines up with the wire
 * blocks that produced each entry.
 */
function blocksOfType<T extends AnthropicContentBlock['type']>(
  content: AnthropicContentBlock[],
  type: T,
): Extract<AnthropicContentBlock, { type: T }>[] {
  return content.filter((b): b is Extract<AnthropicContentBlock, { type: T }> => b.type === type);
}

/** Only 'ephemeral' is a defined type on the wire, and only '5m'/'1h' are defined TTLs -- anything else is ignored rather than forwarded as an opaque string. */
function toInternalCacheControl(
  cc: { type: string; ttl?: string } | null | undefined,
): CacheControl | undefined {
  if (!cc || cc.type !== 'ephemeral') return undefined;
  return cc.ttl === '5m' || cc.ttl === '1h' ? { type: 'ephemeral', ttl: cc.ttl } : { type: 'ephemeral' };
}

/** Total length of a tool_result block's text output, mirroring fromClaudeMessages' own computation -- it only emits a message for non-empty output, so this must match exactly or the cursor drifts. */
function toolResultOutputLength(block: Extract<AnthropicContentBlock, { type: 'tool_result' }>): number {
  if (typeof block.content === 'string') return block.content.length;
  if (!block.content) return 0;
  return blocksOfType(block.content, 'text').reduce((n, b) => n + b.text.length, 0);
}

/**
 * Re-attach `cache_control` from `body.messages` onto the already-converted
 * `messages`, mutating in place.
 *
 * `cursor` tracks the next unclaimed index in `messages` and only advances
 * where `fromClaudeMessages` + `inputsUnionToMessages` are known to push a
 * new entry -- tool_result blocks with non-empty output (one message each,
 * in order), then at most one message for a wire message's text/image
 * content, then tool_use blocks (which attach onto that same message, or
 * onto the prior message if it's already the tail of an assistant turn,
 * exactly like `inputsUnionToMessages`'s function_call case).
 *
 * Document blocks fold into the text stream ahead of the real text blocks'
 * positions inside `fromClaudeMessages`, which would misalign a precise
 * block-by-block zip against the resulting ContentPart array. Rather than
 * replicate that placeholder text verbatim here too, a message containing a
 * document block still advances the cursor correctly but skips per-part
 * cache_control assignment for that message -- documents are already a
 * placeholder-only feature (see fromClaudeMessages' document handling).
 */
function applyInboundCacheControl(body: AnthropicMessagesRequest, messages: Message[]): void {
  let cursor = 0;

  for (const anthMsg of body.messages) {
    if (typeof anthMsg.content === 'string') continue; // no block to carry cache_control

    const textBlocks = blocksOfType(anthMsg.content, 'text');
    const imageBlocks = blocksOfType(anthMsg.content, 'image');
    const toolUseBlocks = blocksOfType(anthMsg.content, 'tool_use');
    const toolResultBlocks = blocksOfType(anthMsg.content, 'tool_result');
    const documentBlocks = blocksOfType(anthMsg.content, 'document');

    // tool_result -> one 'tool' message per block, in order, skipping the
    // ones fromClaudeMessages drops entirely (empty text output).
    for (const block of toolResultBlocks) {
      if (toolResultOutputLength(block) === 0) continue;
      const cc = toInternalCacheControl(block.cache_control);
      if (cc && messages[cursor]) messages[cursor].cache_control = cc;
      cursor++;
    }

    // text/image -> at most one message. Documents fold into the text
    // stream too (as non-empty placeholder text), so their presence alone
    // can trigger a push even with no real text/image blocks.
    const realTextLength = textBlocks.map((b) => b.text).join('').length;
    let combinedMessageIndex: number | null = null;

    if (imageBlocks.length > 0) {
      combinedMessageIndex = cursor;
      if (documentBlocks.length === 0) {
        const ordered = [...textBlocks, ...imageBlocks];
        const target = messages[cursor];
        if (Array.isArray(target?.content)) {
          target.content.forEach((part, idx) => {
            // input_audio never appears here -- this branch only ever holds
            // parts built from text/image blocks -- but the union type needs
            // the narrowing since input_audio has no cache_control field.
            if (part.type === 'input_audio') return;
            const cc = toInternalCacheControl(ordered[idx]?.cache_control);
            if (cc) part.cache_control = cc;
          });
        }
      }
      cursor++;
    } else if (realTextLength > 0 || documentBlocks.length > 0) {
      combinedMessageIndex = cursor;
      if (documentBlocks.length === 0 && textBlocks.length > 0 && messages[cursor]) {
        const cc = toInternalCacheControl(textBlocks[textBlocks.length - 1].cache_control);
        if (cc) messages[cursor].cache_control = cc;
      }
      cursor++;
    }

    // tool_use -> attaches to the text/image message from this same wire
    // message when there was one, else to the prior message if that's
    // already an assistant turn, else starts a fresh assistant message.
    if (toolUseBlocks.length > 0) {
      const cc = toInternalCacheControl(toolUseBlocks[toolUseBlocks.length - 1].cache_control);
      let targetIndex: number;
      if (combinedMessageIndex !== null) {
        targetIndex = combinedMessageIndex;
      } else if (cursor > 0 && messages[cursor - 1]?.role === 'assistant') {
        targetIndex = cursor - 1;
      } else {
        targetIndex = cursor;
        cursor++;
      }
      if (cc && messages[targetIndex]) messages[targetIndex].cache_control = cc;
    }
  }
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
  let systemCacheControl: CacheControl | undefined;
  if (body.system) {
    if (typeof body.system === 'string') {
      systemContent = body.system;
    } else {
      systemContent = body.system.map(b => b.text).join('');
      // Render order is tools -> system -> messages, so the breakpoint that
      // matters is the one on the LAST system block -- it's the one that
      // covers everything before it.
      systemCacheControl = toInternalCacheControl(body.system[body.system.length - 1]?.cache_control);
    }
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

  // Recover cache_control that fromClaudeMessages dropped, before the
  // system message is unshifted (the cursor walk only covers body.messages).
  applyInboundCacheControl(body, messages);

  // Prepend system message if present
  if (systemContent) {
    const systemMessage: Message = { role: 'system', content: systemContent };
    if (systemCacheControl) systemMessage.cache_control = systemCacheControl;
    messages.unshift(systemMessage);
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
