import type { CacheControl, ContentPart, Message } from '@dmr-x/core';
import type {
  ClaudeCacheControl,
  ClaudeImageBlockParam,
  ClaudeMessageParam,
  ClaudeSystemBlockParam,
  ClaudeTextBlockParam,
  ClaudeToolResultBlockParam,
  ClaudeToolUseBlockParam,
} from '@dmr-x/utils';
import type { PromptCachePlan } from './prompt-cache.js';

/**
 * Convert the gateway's internal Message[] into Anthropic Messages API
 * (`/v1/messages`) wire format: a top-level `system` (string or, once a cache
 * breakpoint applies, block array) plus a ClaudeMessageParam[] array.
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
  system?: string | ClaudeSystemBlockParam[];
  messages: ClaudeMessageParam[];
}

/**
 * `plan` is optional so call sites that predate prompt caching still compile
 * and behave exactly as before -- no plan means no breakpoints are injected
 * beyond whatever the caller already put on the internal Message/ContentPart
 * objects themselves (see the cache_control carry-through below).
 */
export function convertMessagesToAnthropic(
  messages: Message[],
  plan?: PromptCachePlan,
): ConvertedAnthropicMessages {
  // Anthropic's system prompt is a single field, but the internal Message[]
  // may carry more than one system-role entry (e.g. a base prompt plus a
  // per-request addendum). Collecting and joining avoids the previous bug
  // where only the last one survived.
  const systemTexts: string[] = [];
  const converted: ClaudeMessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'system') {
      systemTexts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      continue;
    }

    // The breakpoint plan.messages assigns to this message (by its index in
    // the original array), falling back to a caller-supplied cache_control
    // on the Message itself. planPromptCache never populates both a plan and
    // caller breakpoints at once -- it defers entirely when the caller has
    // already set any -- so this is never resolving a conflict, just picking
    // whichever source is live for this request.
    const breakpoint = plan?.messages.get(i) ?? msg.cache_control;

    if (msg.role === 'tool') {
      // Tool results become tool_result content blocks on a user message.
      const toolResult: ClaudeToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || '',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };
      if (breakpoint) toolResult.cache_control = toClaudeCacheControl(breakpoint);
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

      // tool_calls.length guarantees at least one block was pushed above.
      if (breakpoint) {
        contentBlocks[contentBlocks.length - 1].cache_control = toClaudeCacheControl(breakpoint);
      }

      converted.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    // Regular user/assistant messages.
    if (typeof msg.content === 'string') {
      if (breakpoint) {
        // A bare string has nowhere to hang a breakpoint -- promote it to a
        // single-block array so the cache_control has somewhere to live.
        converted.push({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text', text: msg.content, cache_control: toClaudeCacheControl(breakpoint) }],
        });
      } else {
        converted.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    } else {
      const contentBlocks: (ClaudeTextBlockParam | ClaudeImageBlockParam)[] =
        msg.content.map((part) => contentPartToClaudeBlock(part));
      if (breakpoint && contentBlocks.length) {
        contentBlocks[contentBlocks.length - 1].cache_control = toClaudeCacheControl(breakpoint);
      }
      converted.push({ role: msg.role as 'user' | 'assistant', content: contentBlocks });
    }
  }

  let system: string | ClaudeSystemBlockParam[] | undefined;
  if (systemTexts.length) {
    const joined = systemTexts.join('\n\n');
    // Render order is tools -> system -> messages, so the breakpoint belongs
    // on the last (and, since it's a single joined block, only) system
    // block -- that covers the tool definitions too.
    system = plan?.system
      ? [{ type: 'text', text: joined, cache_control: toClaudeCacheControl(plan.system) }]
      : joined;
  }

  return { system, messages: converted };
}

/** Map the internal CacheControl onto the wire shape, omitting `ttl` rather than sending it as `undefined`. */
function toClaudeCacheControl(cc: CacheControl): ClaudeCacheControl {
  return cc.ttl ? { type: cc.type, ttl: cc.ttl } : { type: cc.type };
}

/** Convert an internal ContentPart to a Claude content block. */
function contentPartToClaudeBlock(part: ContentPart): ClaudeTextBlockParam | ClaudeImageBlockParam {
  switch (part.type) {
    case 'text': {
      const cache_control = part.cache_control ? toClaudeCacheControl(part.cache_control) : undefined;
      return cache_control
        ? { type: 'text', text: part.text, cache_control }
        : { type: 'text', text: part.text };
    }
    case 'image_url': {
      const cache_control = part.cache_control ? toClaudeCacheControl(part.cache_control) : undefined;
      return cache_control
        ? { type: 'image', source: { type: 'url', url: part.image_url.url }, cache_control }
        : { type: 'image', source: { type: 'url', url: part.image_url.url } };
    }
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
