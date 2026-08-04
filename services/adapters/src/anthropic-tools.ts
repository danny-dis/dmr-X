import type { Tool, ToolCall, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

/**
 * Shared Anthropic Messages API (`/v1/messages`) tool-calling helpers.
 *
 * Used by both AnthropicAdapter (native Anthropic API) and
 * GenericAnthropicAdapter (Anthropic-compatible proxies / self-hosted
 * providers) so tool forwarding and tool_use response parsing behave
 * identically instead of drifting between the two.
 */

export interface AnthropicToolParam {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: string; ttl?: string };
}

export type AnthropicToolChoiceParam =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

/**
 * Convert UnifiedRequest tools (OpenAI function-calling shape) to Anthropic's
 * `{name, description, input_schema}` shape. Returns `undefined` when there
 * are no tools so callers can spread the result straight into a JSON body
 * and have `JSON.stringify` drop the key entirely.
 *
 * Carries through `cache_control` when present: Anthropic renders tools first
 * in the prompt, so a breakpoint on a tool definition caches the tool block,
 * improving latency and cost for multi-turn conversations.
 */
export function toAnthropicTools(tools: Tool[] | undefined): AnthropicToolParam[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => {
    const tool: AnthropicToolParam = {
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? {},
    };
    if (t.cache_control !== undefined) {
      tool.cache_control = t.cache_control;
    }
    return tool;
  });
}

/**
 * Convert UnifiedRequest.tool_choice (OpenAI shape: 'auto' | 'none' |
 * 'required' | {type:'function', function:{name}}) to Anthropic's
 * {type:'auto'|'any'|'none'|'tool', name?} shape.
 */
export function toAnthropicToolChoice(
  toolChoice: UnifiedRequest['tool_choice'],
): AnthropicToolChoiceParam | undefined {
  if (toolChoice === undefined) return undefined;
  if (toolChoice === 'auto') return { type: 'auto' };
  if (toolChoice === 'none') return { type: 'none' };
  if (toolChoice === 'required') return { type: 'any' };
  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    return { type: 'tool', name: toolChoice.function.name };
  }
  return undefined;
}

export interface ParsedAnthropicContent {
  text: string;
  toolCalls?: ToolCall[];
}

/**
 * Parse a full Anthropic `content` response array (text + tool_use blocks)
 * into the adapter's unified message shape.
 *
 * Previously adapters read only `content[0].text`, so any response where
 * Claude emitted a `tool_use` block (with or without preceding text) was
 * silently discarded -- see AnthropicAdapter.execute() and
 * GenericAnthropicAdapter.execute() before this fix.
 */
export function parseAnthropicContentBlocks(content: unknown): ParsedAnthropicContent {
  if (!Array.isArray(content)) return { text: '' };

  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
    } else if (b.type === 'tool_use') {
      toolCalls.push({
        id: String(b.id ?? ''),
        type: 'function',
        function: {
          name: String(b.name ?? ''),
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
    }
  }

  return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

/**
 * Map an Anthropic `stop_reason` to the gateway's unified finishReason
 * vocabulary. Shared between non-streaming response parsing and the
 * streaming `message_stop` chunk (see createAnthropicSSEIterator).
 */
export function mapAnthropicStopReason(
  stopReason: string | null | undefined,
): NonNullable<UnifiedResponse['finishReason']> | null {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    default:
      return null;
  }
}
