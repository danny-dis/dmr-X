import { describe, it, expect } from 'vitest';

import {
  normalizeAnthropicUsage,
  normalizeOpenAIUsage,
  normalizeGeminiUsage,
} from '../../services/adapters/src/cache-usage.js';

/**
 * Prompt-cache token accounting across provider wire formats.
 *
 * Anthropic counts `input_tokens` as the *uncached remainder* only, so the
 * cache read/write components must be added back in for `prompt_tokens` to
 * mean the full prompt — the meaning OpenAI and Gemini already use. These
 * tests pin that normalization down so a cached request can never again look
 * like a suspiciously cheap one.
 */
describe('normalizeAnthropicUsage', () => {
  it('adds the cached prefix back into the prompt count', () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
      output_tokens: 50,
    });

    expect(usage.prompt_tokens).toBe(1000);
    expect(usage.completion_tokens).toBe(50);
    expect(usage.total_tokens).toBe(1050);
    expect(usage.cache_read_tokens).toBe(900);
    // Zero writes are not a "no cache write" signal worth emitting a field for.
    expect(usage.cache_write_tokens).toBeUndefined();
  });

  it('reports input_tokens as-is when the provider sent no cache fields', () => {
    const usage = normalizeAnthropicUsage({ input_tokens: 100, output_tokens: 20 });

    expect(usage.prompt_tokens).toBe(100);
    expect(usage.completion_tokens).toBe(20);
    expect(usage.total_tokens).toBe(120);
    expect(usage.cache_read_tokens).toBeUndefined();
    expect(usage.cache_write_tokens).toBeUndefined();
  });

  it('records cache writes on the turn that populates the cache', () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 60,
      cache_creation_input_tokens: 5000,
      output_tokens: 25,
    });

    expect(usage.prompt_tokens).toBe(5060);
    expect(usage.cache_write_tokens).toBe(5000);
    expect(usage.cache_read_tokens).toBeUndefined();
  });
});

describe('normalizeOpenAIUsage', () => {
  it('passes prompt_tokens through and lands cached_tokens in cache_read_tokens', () => {
    const usage = normalizeOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 900 },
    });

    expect(usage.prompt_tokens).toBe(1000);
    expect(usage.completion_tokens).toBe(50);
    expect(usage.total_tokens).toBe(1050);
    expect(usage.cache_read_tokens).toBe(900);
    expect(usage.cache_write_tokens).toBeUndefined();
  });

  it('leaves prompt_tokens untouched when there are no cached tokens', () => {
    const usage = normalizeOpenAIUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    });

    expect(usage.prompt_tokens).toBe(100);
    expect(usage.total_tokens).toBe(120);
    expect(usage.cache_read_tokens).toBeUndefined();
  });
});

describe('normalizeGeminiUsage', () => {
  it('passes promptTokenCount through and lands cachedContentTokenCount in cache_read_tokens', () => {
    const usage = normalizeGeminiUsage({
      promptTokenCount: 1000,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
      cachedContentTokenCount: 900,
    });

    expect(usage.prompt_tokens).toBe(1000);
    expect(usage.completion_tokens).toBe(50);
    expect(usage.total_tokens).toBe(1050);
    expect(usage.cache_read_tokens).toBe(900);
    expect(usage.cache_write_tokens).toBeUndefined();
  });
});

describe('robustness', () => {
  it('returns all-zero usage for missing, null, or malformed usage objects', () => {
    const normalizers = [normalizeAnthropicUsage, normalizeOpenAIUsage, normalizeGeminiUsage];
    const malformed = [undefined, null, {}, 'garbage', 42, { input_tokens: -5 }, { input_tokens: 'not-a-number' }];

    for (const normalize of normalizers) {
      for (const input of malformed) {
        const usage = normalize(input);
        expect(usage.prompt_tokens).toBe(0);
        expect(usage.completion_tokens).toBe(0);
        expect(usage.total_tokens).toBe(0);
        expect(usage.cache_read_tokens).toBeUndefined();
        expect(usage.cache_write_tokens).toBeUndefined();
      }
    }
  });
});
