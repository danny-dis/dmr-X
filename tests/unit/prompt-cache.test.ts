import { describe, it, expect } from 'vitest';

import type { Message, UnifiedRequest } from '../../packages/core/src/types/index.js';
import {
  planPromptCache,
  minCacheableTokens,
  stripCacheControl,
} from '../../services/adapters/src/prompt-cache.js';

/** ~4 chars per token, so 4x the token count gives a prefix of roughly that size. */
function text(tokens: number): string {
  return 'x'.repeat(tokens * 4);
}

function makeRequest(overrides: Partial<UnifiedRequest> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'claude-opus-5',
    stream: false,
    metadata: {},
    ...overrides,
  };
}

function turn(role: Message['role'], tokens: number): Message {
  return { role, content: text(tokens) };
}

describe('minCacheableTokens', () => {
  it('uses the longest matching model prefix, not the first', () => {
    // "claude-opus-4" also matches, but the longer key must win or Opus 4.8
    // would be assigned Opus 4's minimum.
    expect(minCacheableTokens('claude-opus-4-8')).toBe(1024);
    expect(minCacheableTokens('claude-opus-4-6')).toBe(4096);
    expect(minCacheableTokens('claude-opus-5')).toBe(512);
  });

  it('matches models carrying a vendor prefix or date suffix', () => {
    expect(minCacheableTokens('anthropic.claude-opus-5')).toBe(512);
    expect(minCacheableTokens('claude-haiku-4-5-20251001')).toBe(4096);
  });

  it('falls back to the most conservative minimum for unknown models', () => {
    expect(minCacheableTokens('some-unknown-model')).toBe(4096);
    expect(minCacheableTokens(undefined)).toBe(4096);
  });
});

describe('planPromptCache — system prefix', () => {
  it('marks the tools+system prefix once it clears the model minimum', () => {
    const req = makeRequest({
      messages: [turn('system', 2000), turn('user', 10)],
    });
    expect(planPromptCache(req).system).toEqual({ type: 'ephemeral' });
  });

  it('leaves a sub-minimum prefix unmarked', () => {
    // 100 tokens is well under Opus 5's 512 floor; the provider would silently
    // decline to cache it anyway.
    const req = makeRequest({ messages: [turn('system', 100), turn('user', 10)] });
    expect(planPromptCache(req).system).toBeNull();
  });

  it('counts tool definitions toward the prefix, since tools render first', () => {
    const tools = Array.from({ length: 30 }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: text(20), parameters: {} },
    }));
    const req = makeRequest({ messages: [turn('system', 50), turn('user', 10)], tools });
    expect(planPromptCache(req).system).toEqual({ type: 'ephemeral' });
  });

  it('honours a requested 1h TTL', () => {
    const req = makeRequest({
      messages: [turn('system', 2000), turn('user', 10)],
      cache: { ttl: '1h' },
    });
    expect(planPromptCache(req).system).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

describe('planPromptCache — conversation tail', () => {
  it('does not mark the tail of a single-turn request', () => {
    // The lone user turn differs on every request. A breakpoint there would
    // write a fresh entry each time and never read one — pure write premium.
    const req = makeRequest({ messages: [turn('system', 2000), turn('user', 2000)] });
    const plan = planPromptCache(req);
    expect(plan.system).toEqual({ type: 'ephemeral' });
    expect(plan.messages.size).toBe(0);
  });

  it('marks the tail once a completed exchange exists', () => {
    const req = makeRequest({
      messages: [turn('system', 600), turn('user', 600), turn('assistant', 600), turn('user', 600)],
    });
    const plan = planPromptCache(req);
    // Index 3 is the final user turn — the growing history behind it caches.
    expect(plan.messages.get(3)).toEqual({ type: 'ephemeral' });
  });

  it('indexes against the original messages array, not the filtered conversation', () => {
    const req = makeRequest({
      messages: [
        turn('system', 600),
        turn('system', 600),
        turn('user', 600),
        turn('assistant', 600),
        turn('user', 600),
      ],
    });
    const plan = planPromptCache(req);
    // Two system messages are skipped, so the tail is at index 4 — not index 2,
    // which is where a conversation-relative index would land.
    expect(plan.messages.has(4)).toBe(true);
    expect(plan.messages.has(2)).toBe(false);
  });

  it('never exceeds the provider cap of four breakpoints', () => {
    const messages: Message[] = [turn('system', 2000)];
    for (let i = 0; i < 60; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: Array.from({ length: 10 }, () => ({ type: 'text' as const, text: text(60) })),
      });
    }
    const plan = planPromptCache(makeRequest({ messages }));
    const total = (plan.system ? 1 : 0) + plan.messages.size;
    expect(total).toBeLessThanOrEqual(4);
  });

  it('inserts intermediate breakpoints when a turn outruns the lookback window', () => {
    // Turns of 25 blocks each overshoot the 20-block lookback, so a tail-only
    // breakpoint would step over the previous one and silently miss.
    const messages: Message[] = [turn('system', 2000)];
    for (let i = 0; i < 6; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: Array.from({ length: 25 }, () => ({ type: 'text' as const, text: text(40) })),
      });
    }
    const plan = planPromptCache(makeRequest({ messages }));
    expect(plan.messages.size).toBeGreaterThan(1);
  });
});

describe('planPromptCache — policy modes', () => {
  const conversation = makeRequest({
    messages: [turn('system', 2000), turn('user', 600), turn('assistant', 600), turn('user', 600)],
  });

  it('injects nothing in explicit mode', () => {
    const plan = planPromptCache({ ...conversation, cache: { mode: 'explicit' } });
    expect(plan.system).toBeNull();
    expect(plan.messages.size).toBe(0);
  });

  it('injects nothing in off mode', () => {
    const plan = planPromptCache({ ...conversation, cache: { mode: 'off' } });
    expect(plan.system).toBeNull();
    expect(plan.messages.size).toBe(0);
  });

  it('defers entirely to caller-supplied breakpoints', () => {
    // Injecting alongside the caller risks blowing the four-breakpoint budget,
    // and they know their own prompt shape better than a heuristic does.
    const req = makeRequest({
      messages: [
        turn('system', 2000),
        {
          role: 'user',
          content: [{ type: 'text', text: text(600), cache_control: { type: 'ephemeral' } }],
        },
        turn('assistant', 600),
        turn('user', 600),
      ],
    });
    const plan = planPromptCache(req);
    expect(plan.callerSupplied).toBe(true);
    expect(plan.system).toBeNull();
    expect(plan.messages.size).toBe(0);
  });

  it('treats a tool-level breakpoint as caller-supplied', () => {
    const req = makeRequest({
      messages: [turn('system', 2000), turn('user', 600), turn('assistant', 600), turn('user', 600)],
      tools: [
        {
          type: 'function',
          function: { name: 'search', parameters: {} },
          cache_control: { type: 'ephemeral' },
        },
      ],
    });
    expect(planPromptCache(req).callerSupplied).toBe(true);
  });

  it('handles a request with no messages at all', () => {
    const plan = planPromptCache(makeRequest({ messages: undefined }));
    expect(plan.system).toBeNull();
    expect(plan.messages.size).toBe(0);
  });
});

describe('stripCacheControl', () => {
  it('removes every breakpoint so none leaks into a non-Anthropic payload', () => {
    const req = makeRequest({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'search', parameters: {} },
          cache_control: { type: 'ephemeral' },
        },
      ],
    });

    stripCacheControl(req);

    expect(req.tools?.[0].cache_control).toBeUndefined();
    expect(req.messages?.[0].cache_control).toBeUndefined();
    const part = req.messages?.[0].content as Array<{ cache_control?: unknown }>;
    expect(part[0].cache_control).toBeUndefined();
  });
});
