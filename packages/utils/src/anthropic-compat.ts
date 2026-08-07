/**
 * Anthropic Claude message format <-> OpenResponses input format conversion.
 *
 * Provides `fromClaudeMessages()` to convert Anthropic-style ClaudeMessageParam[]
 * into the OpenResponses InputsUnion format used by the gateway, and re-exports
 * `toClaudeMessage` (alias for `convertToClaudeMessage`) for the reverse direction.
 *
 * Ported from OpenRouter SDK's anthropic-compat.ts with adaptations for DMR-X.
 */

import { convertToClaudeMessage, type ClaudeThinkingBlock } from './stream-transformers.js';

// ---------------------------------------------------------------------------
// Anthropic SDK types (locally defined to avoid @anthropic-ai/sdk dependency)
// ---------------------------------------------------------------------------

/**
 * A prompt-cache breakpoint. `ttl` defaults to 5 minutes; "1h" costs 2x to
 * write instead of 1.25x, so it only pays off across more requests.
 */
export interface ClaudeCacheControl {
  type: string;
  ttl?: string;
}

/**
 * A system prompt block. Anthropic accepts `system` as either a plain string or
 * an array of text blocks, but only the array form can carry a cache
 * breakpoint — and since render order is tools -> system -> messages, a
 * breakpoint on the last system block covers the tool definitions too.
 */
export interface ClaudeSystemBlockParam {
  type: 'text';
  text: string;
  cache_control?: ClaudeCacheControl | null;
}

/** A text content block in Anthropic message format. */
export interface ClaudeTextBlockParam {
  type: 'text';
  /** The text content. */
  text: string;
  /** Optional cache control directive. */
  cache_control?: ClaudeCacheControl | null;
}

/** An image content block in Anthropic message format. */
export interface ClaudeImageBlockParam {
  type: 'image';
  /** The image source — either a URL or base64-encoded data. */
  source:
    | { type: 'url'; url: string }
    | { type: 'base64'; media_type: string; data: string };
  /** Optional cache control directive. */
  cache_control?: ClaudeCacheControl | null;
}

/** A tool_use content block emitted by an Anthropic assistant turn. */
export interface ClaudeToolUseBlockParam {
  type: 'tool_use';
  /** Unique tool-call identifier. */
  id: string;
  /** Tool name. */
  name: string;
  /** Tool input as a JSON-serializable object. */
  input: Record<string, unknown>;
  /** Optional cache control directive. */
  cache_control?: ClaudeCacheControl | null;
}

/**
 * A redacted_thinking block: an encrypted extended-thinking block Anthropic
 * flags as unsafe to show the user. Clients must replay it back verbatim on
 * the next turn (alongside any `thinking` blocks) or the API rejects the
 * request -- see anthropic.routes.ts AnthropicContentBlockSchema.
 */
export interface ClaudeRedactedThinkingBlockParam {
  type: 'redacted_thinking';
  data: string;
}

/**
 * A native document (PDF) content block.
 *
 * NOTE: forwarding the document bytes/URL through to the upstream provider
 * is not implemented -- see fromClaudeMessages, which folds this into a
 * placeholder text note so requests containing it don't fail. Full plumbing
 * (a `document` ContentPart on the internal Message type, adapter support)
 * is tracked as follow-up work.
 */
export interface ClaudeDocumentBlockParam {
  type: 'document';
  source:
    | { type: 'url'; url: string }
    | { type: 'base64'; media_type: string; data: string };
  /** Optional cache control directive. */
  cache_control?: ClaudeCacheControl | null;
}

/** A tool_result content block supplied by the user to report tool output. */
export interface ClaudeToolResultBlockParam {
  type: 'tool_result';
  /** The tool_use_id this result corresponds to. */
  tool_use_id: string;
  /**
   * Result content — either a plain string or an array of text/image blocks.
   * When the tool produced an image, the image block is included here.
   */
  content:
    | string
    | (ClaudeTextBlockParam | ClaudeImageBlockParam)[];
  /** Whether the tool call resulted in an error. */
  is_error?: boolean;
  /** Optional cache control directive. */
  cache_control?: ClaudeCacheControl | null;
}

/** Union of all Anthropic content block types within a message. */
type ClaudeContentBlockParam =
  | ClaudeTextBlockParam
  | ClaudeImageBlockParam
  | ClaudeToolUseBlockParam
  | ClaudeToolResultBlockParam
  | ClaudeThinkingBlock
  | ClaudeRedactedThinkingBlockParam
  | ClaudeDocumentBlockParam;

/**
 * An Anthropic-style message parameter.
 *
 * - When `role` is "user", `content` may be a string or an array of content blocks
 *   (text, image, tool_result).
 * - When `role` is "assistant", `content` may be a string or an array of content blocks
 *   (text, tool_use).
 */
export interface ClaudeMessageParam {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlockParam[];
}

// ---------------------------------------------------------------------------
// OpenResponses types (locally defined to avoid @dmr-x/models dependency)
// ---------------------------------------------------------------------------

/**
 * Role for a simple input message targeting the user turn.
 */
export type EasyInputMessageRoleUser = 'user';

/**
 * Role for a simple input message targeting the assistant turn.
 */
export type EasyInputMessageRoleAssistant = 'assistant';

/**
 * A simple message input with a string role and text content.
 * Used for plain text-only messages that need no structured content blocks.
 */
export interface EasyInputMessage {
  role: EasyInputMessageRoleUser | EasyInputMessageRoleAssistant;
  content: string;
}

/**
 * Text content part within a structured input message.
 */
export interface InputText {
  type: 'input_text';
  text: string;
}

/**
 * Image content part within a structured input message.
 * `imageUrl` is a data-URI or HTTP URL.
 */
export interface InputImage {
  type: 'input_image';
  detail: 'auto' | 'low' | 'high';
  imageUrl: string;
}

/**
 * A structured input message item with multi-part content.
 * Used when the message contains images or mixed content.
 */
export interface InputMessageItem {
  type: 'message';
  role: 'user' | 'developer';
  content: (InputText | InputImage)[];
}

/**
 * A function call item representing a tool invocation by the model.
 */
export interface FunctionCallItem {
  type: 'function_call';
  /** Unique call identifier (also used as `callId` in Responses format). */
  callId: string;
  /** Tool name. */
  name: string;
  /** JSON-stringified arguments. */
  arguments: string;
  /** Optional opaque item id. */
  id?: string;
  /** Completion status. */
  status?: string;
}

/**
 * A function call output item representing the result of a tool invocation.
 */
export interface FunctionCallOutputItem {
  type: 'function_call_output';
  /** The callId this output corresponds to. */
  callId: string;
  /** The tool output as a string. */
  output: string;
}

/**
 * An image generation call output item.
 * Represents an image produced by a tool and attached to the conversation.
 */
export interface OutputImageGenerationCallItem {
  type: 'image_generation_call';
  /** Unique identifier for this image generation call. */
  id: string;
  /** The image result — typically a data-URI or URL. */
  result: string;
  /** Completion status. */
  status: string;
}

/**
 * Union of all OpenResponses input item types accepted by `callModel()`.
 */
export type InputsUnion = (
  | EasyInputMessage
  | InputMessageItem
  | FunctionCallOutputItem
  | FunctionCallItem
  | OutputImageGenerationCallItem
)[];

// ---------------------------------------------------------------------------
// Role mapping helpers
// ---------------------------------------------------------------------------

/** Role constant for user messages in structured format. */
const ROLE_USER: 'user' = 'user';

/** Role constant for developer (assistant-originated) messages in structured format. */
const ROLE_DEVELOPER: 'developer' = 'developer';

// ---------------------------------------------------------------------------
// Conversion: Claude -> OpenResponses
// ---------------------------------------------------------------------------

/**
 * Creates a simple EasyInputMessage (plain text, no structured content).
 */
function createEasyInputMessage(
  role: 'user' | 'assistant',
  content: string,
): EasyInputMessage {
  return { role, content };
}

/**
 * Creates a FunctionCallOutputItem from a tool_result block's text output.
 */
function createFunctionCallOutput(
  callId: string,
  output: string,
): FunctionCallOutputItem {
  return {
    type: 'function_call_output',
    callId,
    output,
  };
}

/**
 * Convert an image source to a data-URI or URL string.
 */
function resolveImageSource(source: ClaudeImageBlockParam['source']): string {
  if (source.type === 'url') {
    return source.url;
  }
  if (source.type === 'base64') {
    return `data:${source.media_type};base64,${source.data}`;
  }
  // Exhaustiveness check -- TypeScript errors if source is not handled
  const _exhaustive: never = source;
  throw new Error(`Unhandled image source type: ${JSON.stringify(_exhaustive)}`);
}

/**
 * Convert Anthropic Claude-style messages to OpenResponses input format.
 *
 * Transforms `ClaudeMessageParam[]` (Anthropic SDK format) into the
 * `InputsUnion` format consumed by the gateway's `callModel()` pipeline.
 *
 * **Conversion notes:**
 * - `cache_control` on content blocks is silently dropped (not supported).
 * - `is_error` on `tool_result` blocks is silently dropped.
 * - Images in `tool_result` content are mapped to `image_generation_call` items.
 * - Text-only user/assistant messages use the simple `EasyInputMessage` shape.
 * - Messages with images use the structured `InputMessageItem` shape.
 *
 * @param messages - Array of Anthropic Claude message parameters.
 * @returns Array of OpenResponses input items ready for `callModel()`.
 *
 * @example
 * ```typescript
 * const claudeMessages: ClaudeMessageParam[] = [
 *   { role: 'user', content: 'Hello!' },
 *   { role: 'assistant', content: 'Hi there!' },
 * ];
 *
 * const input = fromClaudeMessages(claudeMessages);
 * // input is an InputsUnion array
 * ```
 */
export function fromClaudeMessages(messages: ClaudeMessageParam[]): InputsUnion {
  const result: InputsUnion = [];

  for (const msg of messages) {
    const { role, content } = msg;

    // Simple string content -- emit an EasyInputMessage
    if (typeof content === 'string') {
      result.push(createEasyInputMessage(role, content));
      continue;
    }

    // Separate content blocks into categories for clearer processing
    const textBlocks: ClaudeTextBlockParam[] = [];
    const imageBlocks: ClaudeImageBlockParam[] = [];
    const toolUseBlocks: ClaudeToolUseBlockParam[] = [];
    const toolResultBlocks: ClaudeToolResultBlockParam[] = [];
    const documentBlocks: ClaudeDocumentBlockParam[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text':
          textBlocks.push(block);
          break;
        case 'image':
          imageBlocks.push(block);
          break;
        case 'tool_use':
          toolUseBlocks.push(block);
          break;
        case 'tool_result':
          toolResultBlocks.push(block);
          break;
        case 'document':
          documentBlocks.push(block);
          break;
        case 'thinking':
        case 'redacted_thinking':
          // Extended-thinking blocks replayed from a prior assistant turn.
          // There's no `thinking` ContentPart on the internal Message model
          // and most non-Anthropic providers reject them as input anyway,
          // so they're dropped here rather than crashing the request. The
          // surrounding text/tool_use blocks in the same message are kept.
          break;
        default: {
          // Exhaustiveness check -- TypeScript errors if a block type is unhandled
          const exhaustiveCheck: never = block;
          throw new Error(
            `Unhandled content block type: ${JSON.stringify(exhaustiveCheck)}`,
          );
        }
      }
    }

    // Document blocks have no internal representation yet (see
    // ClaudeDocumentBlockParam) -- fold them into a placeholder text note so
    // the request succeeds instead of silently losing the block or crashing.
    for (const doc of documentBlocks) {
      const mediaType = doc.source.type === 'base64' ? doc.source.media_type : doc.source.url;
      textBlocks.push({ type: 'text', text: `[document: ${mediaType}]` });
    }

    // Process tool_result blocks (user-supplied tool outputs)
    for (const toolResultBlock of toolResultBlocks) {
      let toolOutput = '';

      if (typeof toolResultBlock.content === 'string') {
        toolOutput = toolResultBlock.content;
      } else {
        // Extract text and handle images separately
        const textParts: string[] = [];
        const imageParts: ClaudeImageBlockParam[] = [];

        for (const part of toolResultBlock.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'image') {
            imageParts.push(part);
          }
        }

        toolOutput = textParts.join('');

        // Map images to image_generation_call items
        imageParts.forEach((imagePart, i) => {
          const imageUrl = resolveImageSource(imagePart.source);
          result.push({
            type: 'image_generation_call',
            id: `${toolResultBlock.tool_use_id}-image-${i}`,
            result: imageUrl,
            status: 'completed',
          });
        });
      }

      // Add the function call output for the text portion (if any)
      if (toolOutput.length > 0) {
        result.push(createFunctionCallOutput(toolResultBlock.tool_use_id, toolOutput));
      }
    }

    // Process text and image blocks (these become message content)
    if (textBlocks.length > 0 || imageBlocks.length > 0) {
      const contentItems: (InputText | InputImage)[] = [];

      // Add text blocks
      for (const textBlock of textBlocks) {
        contentItems.push({
          type: 'input_text',
          text: textBlock.text,
        });
      }

      // Add image blocks
      for (const imageBlock of imageBlocks) {
        const imageUrl = resolveImageSource(imageBlock.source);
        contentItems.push({
          type: 'input_image',
          detail: 'auto',
          imageUrl,
        });
      }

      if (imageBlocks.length > 0) {
        // Use structured format for messages with images
        result.push({
          type: 'message',
          role: role === 'user' ? ROLE_USER : ROLE_DEVELOPER,
          content: contentItems,
        });
      } else {
        // Use simple string format for text-only messages
        const textContent = contentItems
          .filter((item): item is InputText => item.type === 'input_text')
          .map((item) => item.text)
          .join('');

        if (textContent.length > 0) {
          result.push(createEasyInputMessage(role, textContent));
        }
      }
    }

    // Process tool_use blocks (assistant-initiated tool calls)
    // Emit AFTER text so that inputsUnionToMessages can attach them to the preceding assistant message
    for (const toolUseBlock of toolUseBlocks) {
      result.push({
        type: 'function_call',
        callId: toolUseBlock.id,
        name: toolUseBlock.name,
        arguments: JSON.stringify(toolUseBlock.input),
        id: toolUseBlock.id,
        status: 'completed',
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Conversion: OpenResponses -> Claude (re-export)
// ---------------------------------------------------------------------------

/**
 * Convert an OpenResponses response to Anthropic Claude message format.
 *
 * This is an alias for `convertToClaudeMessage` from `./stream-transformers.js`,
 * re-exported here for ergonomic imports alongside `fromClaudeMessages`.
 *
 * @example
 * ```typescript
 * import { toClaudeMessage, fromClaudeMessages } from '@dmr-x/utils';
 *
 * const claudeMessage = toClaudeMessage(openResponsesResult);
 * ```
 */
export const toClaudeMessage = convertToClaudeMessage;
