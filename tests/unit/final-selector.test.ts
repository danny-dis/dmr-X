import { describe, it, expect } from 'vitest';
import { finalSelector } from '../../services/router/src/pipeline/final-selector.js';
import type { CandidateSet } from '../../packages/core/src/types/index.js';

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilities: [],
    costPerInputToken: 0.001,
    costPerOutputToken: 0.002,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    isHealthy: true,
    compositeScore: 0.8,
    ...overrides,
  };
}

describe('finalSelector', () => {
  it('should select top candidate when epsilon is 0', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'best', compositeScore: 0.9 }),
      makeCandidate({ modelId: 'second', compositeScore: 0.8 }),
      makeCandidate({ modelId: 'third', compositeScore: 0.7 }),
    ];

    const result = finalSelector(candidates, 0);
    expect(result.selected.modelId).toBe('best');
    expect(result.remaining).toHaveLength(2);
  });

  it('should return remaining candidates excluding selected', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'a', compositeScore: 0.9 }),
      makeCandidate({ modelId: 'b', compositeScore: 0.8 }),
      makeCandidate({ modelId: 'c', compositeScore: 0.7 }),
    ];

    const result = finalSelector(candidates, 0);
    expect(result.remaining.map(c => c.modelId)).toEqual(['b', 'c']);
  });

  it('should throw on empty candidates', () => {
    expect(() => finalSelector([], 0)).toThrow('No candidates available');
  });

  it('should handle single candidate', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'only-one' }),
    ];

    const result = finalSelector(candidates, 0);
    expect(result.selected.modelId).toBe('only-one');
    expect(result.remaining).toHaveLength(0);
  });

  it('should use qualityScore as fallback when compositeScore is undefined', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'test', qualityScore: 0.85, compositeScore: undefined }),
    ];

    const result = finalSelector(candidates, 0);
    expect(result.selected.score).toBe(0.85);
  });
});
