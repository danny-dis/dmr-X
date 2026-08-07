import type { CacheControl, CachePolicy, Message, Tool, UnifiedRequest } from '@dmr-x/core';

/**
 * Prompt-cache breakpoint planning.
 *
 * Provider prompt caching is a *prefix* match: the provider hashes the rendered
 * prompt up to each breakpoint and reuses it on the next request. Reads bill at
 * ~0.1x input price, writes at 1.25x (5m TTL) or 2x (1h TTL). For an agent loop
 * with a large fixed system prompt and tool list, this is the dominant cost lever.
 *
 * Render order is tools -> system -> messages, so a breakpoint on the last
 * system block covers tools and system together.
 *
 * This module decides *where* breakpoints go. Emitting them onto the wire is the
 * adapter's job, because only Anthropic accepts explicit breakpoints — OpenAI and
 * Gemini cache prefixes automatically with no request-side syntax.
 */

/**
 * Minimum cacheable prefix per model, in tokens. A prefix shorter than this is
 * silently not cached: no error, and `cache_creation_input_tokens` comes back 0.
 *
 * Deliberately not monotonic across generations — Opus 4.6 needs 8x the prefix
 * that Opus 5 does. Keyed by model-id prefix, longest match wins.
 */
const MIN_CACHEABLE_TOKENS: ReadonlyArray<readonly [string, number]> = [
  ['claude-opus-5', 512],
  ['claude-fable-5', 512],
  ['claude-mythos-5', 512],
  ['claude-mythos-preview', 2048],
  ['claude-opus-4-8', 1024],
  ['claude-opus-4-7', 2048],
  ['claude-opus-4-6', 4096],
  ['claude-opus-4-5', 4096],
  ['claude-opus-4-1', 1024],
  ['claude-opus-4', 1024],
  ['claude-sonnet-5', 1024],
  ['claude-sonnet-4-6', 1024],
  ['claude-sonnet-4-5', 1024],
  ['claude-sonnet-4', 1024],
  ['claude-haiku-4-5', 4096],
  ['claude-haiku-3-5', 2048],
];

/** Conservative default for models absent from the table above. */
const DEFAULT_MIN_CACHEABLE_TOKENS = 4096;

/** Anthropic caps explicit breakpoints per request. */
const MAX_BREAKPOINTS = 4;

/**
 * A breakpoint walks back at most this many content blocks to find a prior cache
 * entry. An agentic turn that appends more blocks than this in one go would step
 * over its own previous breakpoint and silently miss, so we insert an
 * intermediate breakpoint before that happens.
 */
const LOOKBACK_BLOCKS = 20;
const INTERMEDIATE_BLOCK_STRIDE = 15;

/**
 * A conversation needs at least one *completed* exchange before marking the tail
 * is worthwhile. Below this, the tail differs on every request, so a breakpoint
 * there would write a fresh entry each time and never read one — paying the
 * write premium for nothing.
 */
const MIN_MESSAGES_FOR_TAIL_BREAKPOINT = 3;

export interface PromptCachePlan {
  /** Breakpoint for the tools+system prefix, or null if that prefix is too small. */
  system: CacheControl | null;
  /** Message index -> breakpoint, applied to that message's final content block. */
  messages: Map<number, CacheControl>;
  /** True when the caller supplied their own breakpoints and we left them alone. */
  callerSupplied: boolean;
}

export const EMPTY_PLAN: PromptCachePlan = Object.freeze({
  system: null,
  messages: new Map<number, CacheControl>(),
  callerSupplied: false,
});

/** Minimum cacheable prefix for a model id, via longest-prefix match. */
export function minCacheableTokens(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_MIN_CACHEABLE_TOKENS;
  const id = modelId.toLowerCase();
  let best: number | null = null;
  let bestLen = -1;
  for (const [prefix, min] of MIN_CACHEABLE_TOKENS) {
    if (id.includes(prefix) && prefix.length > bestLen) {
      best = min;
      bestLen = prefix.length;
    }
  }
  return best ?? DEFAULT_MIN_CACHEABLE_TOKENS;
}

/**
 * Rough token estimate (~4 chars/token).
 *
 * Over-estimating is safe: if the real prefix falls under the model's minimum,
 * the provider declines to cache it and charges no write premium. Under-
 * estimating just forgoes a cache that would have worked. Neither is a
 * correctness problem, so an approximation is fine here — we are choosing
 * whether to *try*, not billing anyone.
 */
export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return Math.ceil(value.length / 4);
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return 0;
  }
}

function estimateMessageTokens(msg: Message): number {
  let total = estimateTokens(msg.content);
  if (msg.tool_calls?.length) total += estimateTokens(msg.tool_calls);
  return total + 4; // per-message role/framing overhead
}

/** Content blocks a message contributes, for lookback-window accounting. */
function blockCount(msg: Message): number {
  const contentBlocks = Array.isArray(msg.content) ? msg.content.length : 1;
  return contentBlocks + (msg.tool_calls?.length ?? 0);
}

function hasCallerBreakpoints(messages: Message[] | undefined, tools: Tool[] | undefined): boolean {
  if (tools?.some((t) => t.cache_control)) return true;
  if (!messages) return false;
  return messages.some(
    (m) =>
      m.cache_control ||
      (Array.isArray(m.content) &&
        m.content.some((part) => 'cache_control' in part && part.cache_control)),
  );
}

/**
 * Decide where prompt-cache breakpoints belong for a request.
 *
 * Placement under `auto`:
 *  1. One on the tools+system prefix — the largest genuinely stable span, and the
 *     one that repeats across every request rather than just within a conversation.
 *  2. One on the conversation tail, but only once a completed exchange exists, so
 *     the growing history accrues hits instead of thrashing.
 *  3. Intermediate ones when a single turn appends enough blocks to overshoot the
 *     provider's lookback window.
 */
export function planPromptCache(req: UnifiedRequest, policy?: CachePolicy): PromptCachePlan {
  const mode = policy?.mode ?? req.cache?.mode ?? 'auto';
  const ttl = policy?.ttl ?? req.cache?.ttl;
  const messages = req.messages ?? [];

  if (mode === 'off') return EMPTY_PLAN;

  // Caller knows their own prompt shape better than a heuristic does. Injecting
  // alongside their breakpoints also risks blowing the 4-breakpoint budget.
  if (hasCallerBreakpoints(messages, req.tools)) {
    return { system: null, messages: new Map(), callerSupplied: true };
  }

  if (mode === 'explicit') return EMPTY_PLAN;

  const minTokens = minCacheableTokens(req.model);
  const breakpoint: CacheControl = ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };

  const plan: PromptCachePlan = {
    system: null,
    messages: new Map<number, CacheControl>(),
    callerSupplied: false,
  };

  // --- 1. tools + system -----------------------------------------------------
  const toolTokens = estimateTokens(req.tools);
  const systemTokens = messages
    .filter((m) => m.role === 'system')
    .reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  let budget = MAX_BREAKPOINTS;
  let prefixTokens = toolTokens + systemTokens;

  if (prefixTokens >= minTokens) {
    plan.system = breakpoint;
    budget--;
  }

  // --- 2. conversation tail --------------------------------------------------
  const convo = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role !== 'system');

  if (convo.length < MIN_MESSAGES_FOR_TAIL_BREAKPOINT || budget <= 0) {
    return plan;
  }

  // Reserve one breakpoint for the tail; spend the rest on intermediates so a
  // long agentic turn cannot step over its own previous breakpoint.
  let blocksSinceBreakpoint = 0;
  for (let i = 0; i < convo.length - 1 && budget > 1; i++) {
    const { msg, index } = convo[i];
    prefixTokens += estimateMessageTokens(msg);
    blocksSinceBreakpoint += blockCount(msg);

    if (blocksSinceBreakpoint >= INTERMEDIATE_BLOCK_STRIDE && prefixTokens >= minTokens) {
      plan.messages.set(index, breakpoint);
      blocksSinceBreakpoint = 0;
      budget--;
    }
  }

  const tail = convo[convo.length - 1];
  prefixTokens += estimateMessageTokens(tail.msg);

  if (prefixTokens >= minTokens && budget > 0) {
    plan.messages.set(tail.index, breakpoint);
  }

  return plan;
}

/**
 * Strip every breakpoint from a request. Used for providers that do not accept
 * them on the wire, so a caller's Anthropic-shaped `cache_control` does not leak
 * into an OpenAI or Gemini payload as an unknown field.
 */
export function stripCacheControl(req: UnifiedRequest): void {
  for (const tool of req.tools ?? []) delete tool.cache_control;
  for (const msg of req.messages ?? []) {
    delete msg.cache_control;
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ('cache_control' in part) delete part.cache_control;
      }
    }
  }
}

export const LOOKBACK_WINDOW_BLOCKS = LOOKBACK_BLOCKS;
