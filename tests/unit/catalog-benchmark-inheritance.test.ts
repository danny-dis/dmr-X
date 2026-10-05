import { describe, it, expect } from 'vitest';

import {
  getBenchmarkIntelligenceRank,
  getBenchmarkCodingIndex,
  getBenchmarkAgenticIndex,
} from '../../packages/provider-catalog/src/index.ts';

describe('catalog benchmark inheritance (conservative exact-base only)', () => {
  it('keeps exact direct hits unchanged', () => {
    // Base and :free twin both exist in the snapshot with identical indices.
    expect(getBenchmarkIntelligenceRank('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(
      getBenchmarkIntelligenceRank('nvidia/nemotron-3-ultra-550b-a55b'),
    );
  });

  it('inherits the base rank for an absent :free variant (intelligence)', () => {
    // 'anthropic/claude-sonnet-5.5:free' is absent from the snapshot; the base
    // carries intelligenceIndex 56 -> rank 9. Verified against the live file,
    // not a hardcoded leaderboard.
    expect(getBenchmarkIntelligenceRank('anthropic/claude-sonnet-5.5')).toBe(9);
    expect(getBenchmarkIntelligenceRank('anthropic/claude-sonnet-5.5:free')).toBe(9);
  });

  it('inherits the base rank for an absent -free variant (intelligence)', () => {
    // 'openai/gpt-5.5-free' is absent; base intelligenceIndex 38.4 -> rank 6.
    expect(getBenchmarkIntelligenceRank('openai/gpt-5.5')).toBe(6);
    expect(getBenchmarkIntelligenceRank('openai/gpt-5.5-free')).toBe(6);
  });

  it('NEVER approximates: version/name near-misses stay unknown', () => {
    // None of these ids exist in the snapshot; no prefix/version fuzzy match
    // may promote them to a neighbour's rank.
    expect(getBenchmarkIntelligenceRank('openai/gpt-5.5-turbo')).toBeUndefined();
    expect(getBenchmarkIntelligenceRank('openai/gpt-5.5:free:batch')).toBeUndefined();
    expect(getBenchmarkIntelligenceRank('provider/unknown-model-xyz')).toBeUndefined();
  });

  it('resolves provider-namespaced bare ids exactly', () => {
    // Registry candidates carry catalog-slug provider + bare model id.
    expect(getBenchmarkIntelligenceRank('gpt-5.5', 'openai')).toBe(6);
    expect(getBenchmarkIntelligenceRank('gpt-5.5-free', 'openai')).toBe(6);
    expect(getBenchmarkIntelligenceRank('gpt-5.5-turbo', 'openai')).toBeUndefined();
  });

  it('exposes true coding indices with the same inheritance, unknown stays unknown', () => {
    expect(getBenchmarkCodingIndex('openai/gpt-5.5')).toBe(74.9);
    expect(getBenchmarkCodingIndex('openai/gpt-5.5-free')).toBe(74.9);
    expect(getBenchmarkCodingIndex('gpt-5-mini', 'openai')).toBe(15.6);
    // Base exists but carries no codingIndex (intelligence-only entry).
    expect(getBenchmarkCodingIndex('anthropic/claude-sonnet-5.5')).toBeUndefined();
    expect(getBenchmarkCodingIndex('anthropic/claude-sonnet-5.5:free')).toBeUndefined();
    // Near-miss: no invented value.
    expect(getBenchmarkCodingIndex('openai/gpt-5.5-turbo')).toBeUndefined();
  });

  it('exposes true agentic indices with the same inheritance, unknown stays unknown', () => {
    expect(getBenchmarkAgenticIndex('openai/gpt-5.5')).toBe(36.4);
    expect(getBenchmarkAgenticIndex('openai/gpt-5.5-free')).toBe(36.4);
    expect(getBenchmarkAgenticIndex('gpt-5-mini', 'openai')).toBe(6.8);
    expect(getBenchmarkAgenticIndex('anthropic/claude-sonnet-5.5')).toBeUndefined();
    expect(getBenchmarkAgenticIndex('anthropic/claude-sonnet-5.5:free')).toBeUndefined();
    expect(getBenchmarkAgenticIndex('openai/gpt-5.5-turbo')).toBeUndefined();
  });
});
