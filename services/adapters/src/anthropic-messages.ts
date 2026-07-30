import type { ContentPart, Message } from '@dmr-x/core';
import type {
  ClaudeImageBlockParam,
  ClaudeMessageParam,
  ClaudeTextBlockParam,
  ClaudeToolResultBlockParam,
  ClaudeToolUseBlockParam,
} from '@dmr-x/utils';

/**
 * Convert the gateway's internal Message[] into Anthropic Messages API
 * (`/v1/messages`) wire format: a top-level `system` string plus a
 * ClaudeMessageParam[] array.
 *
 * Shared by every adapter that talks to an Anthropic-shaped endpoint --
 * AnthropicAdapter (native API) and GenericAnthropicAdapter
 * (Anthropic-compatible proxies / self-hosted providers) -- so tool_use /
 * tool_result history and image content blocks are preserved instead of
 * being flattened to text via JSON.stringify. GenericAnthropicAdapter used
 * to stringify structured content wholesale, which destroyed image blocks
 * and multi-turn tool history.
 */
export interface ConvertedAnthropicMessages {
  system?: string;
  messages: ClaudeMessageParam[];
}

export function convertMessagesToAnthropic(messages: Message[]): ConvertedAnthropicMessages {
  let system: string | undefined;
  const converted: ClaudeMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results become tool_result content blocks on a user message.
      const toolResult: ClaudeToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || '',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };
      const lastMsg = converted[converted.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        lastMsg.content.push(toolResult);
      } else {
        converted.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Assistant message with tool calls: text (if any) followed by tool_use blocks.
      const contentBlocks: (ClaudeTextBlockParam | ClaudeToolUseBlockParam)[] = [];

      const textContent = typeof msg.content === 'string'
        ? msg.content
        : extractTextFromContentParts(msg.content);
      if (textContent) {
        contentBlocks.push({ type: 'text', text: textContent });
      }

      for (const tc of msg.tool_calls) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeParseJson(tc.function.arguments),
        });
      }

      converted.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    // Regular user/assistant messages.
    if (typeof msg.content === 'string') {
      converted.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    } else {
      const contentBlocks: (ClaudeTextBlockParam | ClaudeImageBlockParam)[] =
        msg.content.map((part) => contentPartToClaudeBlock(part));
      converted.push({ role: msg.role as 'user' | 'assistant', content: contentBlocks });
    }
  }

  return { system, messages: converted };
}

/** Convert an internal ContentPart to a Claude content block. */
function contentPartToClaudeBlock(part: ContentPart): ClaudeTextBlockParam | ClaudeImageBlockParam {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image_url':
      return { type: 'image', source: { type: 'url', url: part.image_url.url } };
    case 'input_audio':
      // Anthropic doesn't support audio content blocks natively;
      // fall back to a text description.
      return { type: 'text', text: `[audio: ${part.input_audio.format}]` };
    default:
      return { type: 'text', text: '[unsupported content part]' };
  }
}

/** Extract concatenated text from ContentPart[]. */
function extractTextFromContentParts(parts: ContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** Safely parse a JSON string, returning a wrapped raw string on failure. */
function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { _raw: str };
  }
}
