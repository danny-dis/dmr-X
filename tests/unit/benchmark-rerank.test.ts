import { describe, it, expect } from 'vitest';

import {
  benchmarkIndexToRank,
  getBenchmarkIntelligenceRank,
} from '../../packages/provider-catalog/src/index.ts';
import { MODEL_BENCHMARKS } from '../../packages/provider-catalog/src/benchmarks.generated.ts';

describe('benchmark rank mapping', () => {
  it('maps AA intelligence index to a 1-10 rank (clamp round(index/6))', () => {
    expect(benchmarkIndexToRank(63.1)).toBe(10); // claude-opus-5
    expect(benchmarkIndexToRank(51.6)).toBe(9); // gemini-3.6-flash
    expect(benchmarkIndexToRank(38.3)).toBe(6); // nemotron-3-ultra-550b-a55b:free
    expect(benchmarkIndexToRank(5.5)).toBe(1); // lowest measured
    expect(benchmarkIndexToRank(0)).toBe(0); // non-finite / no data
    expect(benchmarkIndexToRank(NaN)).toBe(0);
  });

  it('looks up benchmark rank by model id', () => {
    // The inflation this layer exists to correct: catalog ranks
    // nemotron-3-ultra-550b-a55b:free at 9, benchmark says ~6.
    expect(getBenchmarkIntelligenceRank('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(6);
    expect(getBenchmarkIntelligenceRank('anthropic/claude-opus-5')).toBe(10);
  });

  it('returns undefined for unknown model ids (falls through to catalog rank)', () => {
    expect(getBenchmarkIntelligenceRank('provider/unknown-model-xyz')).toBeUndefined();
  });

  it('generated data carries intelligenceIndex for every entry', () => {
    const ids = Object.keys(MODEL_BENCHMARKS);
    expect(ids.length).toBeGreaterThan(100); // 141 in the 2026-08-19 fetch
    for (const id of ids) {
      expect(typeof MODEL_BENCHMARKS[id].intelligenceIndex).toBe('number');
      expect(MODEL_BENCHMARKS[id].intelligenceIndex).toBeGreaterThan(0);
    }
  });
});