/**
 * Anthropic Claude message format <-> OpenResponses input format conversion.
 *
 * Provides `fromClaudeMessages()` to convert Anthropic-style ClaudeMessageParam[]
 * into the OpenResponses InputsUnion format used by the gateway, and re-exports
 * `toClaudeMessage` (alias for `convertToClaudeMessage`) for the reverse direction.
 *
 * Ported from OpenRouter SDK's anthropic-compat.ts with adaptations for DMR-X.
 */
import { convertToClaudeMessage } from './stream-transformers.js';
// ---------------------------------------------------------------------------
// Role mapping helpers
// ---------------------------------------------------------------------------
/** Role constant for user messages in structured format. */
const ROLE_USER = 'user';
/** Role constant for developer (assistant-originated) messages in structured format. */
const ROLE_DEVELOPER = 'developer';
// ---------------------------------------------------------------------------
// Conversion: Claude -> OpenResponses
// ---------------------------------------------------------------------------
/**
 * Creates a simple EasyInputMessage (plain text, no structured content).
 */
function createEasyInputMessage(role, content) {
    return { role, content };
}
/**
 * Creates a FunctionCallOutputItem from a tool_result block's text output.
 */
function createFunctionCallOutput(callId, output) {
    return {
        type: 'function_call_output',
        callId,
        output,
    };
}
/**
 * Convert an image source to a data-URI or URL string.
 */
function resolveImageSource(source) {
    if (source.type === 'url') {
        return source.url;
    }
    if (source.type === 'base64') {
        return `data:${source.media_type};base64,${source.data}`;
    }
    // Exhaustiveness check -- TypeScript errors if source is not handled
    const _exhaustive = source;
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
export function fromClaudeMessages(messages) {
    const result = [];
    for (const msg of messages) {
        const { role, content } = msg;
        // Simple string content -- emit an EasyInputMessage
        if (typeof content === 'string') {
            result.push(createEasyInputMessage(role, content));
            continue;
        }
        // Separate content blocks into categories for clearer processing
        const textBlocks = [];
        const imageBlocks = [];
        const toolUseBlocks = [];
        const toolResultBlocks = [];
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
                default: {
                    // Exhaustiveness check -- TypeScript errors if a block type is unhandled
                    const exhaustiveCheck = block;
                    throw new Error(`Unhandled content block type: ${JSON.stringify(exhaustiveCheck)}`);
                }
            }
        }
        // Process tool_result blocks (user-supplied tool outputs)
        for (const toolResultBlock of toolResultBlocks) {
            let toolOutput = '';
            if (typeof toolResultBlock.content === 'string') {
                toolOutput = toolResultBlock.content;
            }
            else {
                // Extract text and handle images separately
                const textParts = [];
                const imageParts = [];
                for (const part of toolResultBlock.content) {
                    if (part.type === 'text') {
                        textParts.push(part.text);
                    }
                    else if (part.type === 'image') {
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
            const contentItems = [];
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
            }
            else {
                // Use simple string format for text-only messages
                const textContent = contentItems
                    .filter((item) => item.type === 'input_text')
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
//# sourceMappingURL=anthropic-compat.js.map