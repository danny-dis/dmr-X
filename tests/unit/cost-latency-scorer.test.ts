import { describe, it, expect } from 'vitest';
import { costLatencyScorer } from '../../services/router/src/pipeline/cost-latency-scorer.js';
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
    ...overrides,
  };
}

describe('costLatencyScorer', () => {
  it('should score and sort candidates by composite score', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'cheap', qualityScore: 0.5, costPerInputToken: 0.001, avgLatencyMs: 500 }),
      makeCandidate({ modelId: 'expensive', qualityScore: 0.9, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
      makeCandidate({ modelId: 'balanced', qualityScore: 0.7, costPerInputToken: 0.005, avgLatencyMs: 1000 }),
    ];

    const result = costLatencyScorer(candidates, 'balanced');
    expect(result).toHaveLength(3);
    // Should be sorted by composite score (highest first)
    expect(result[0].compositeScore).toBeGreaterThanOrEqual(result[1].compositeScore!);
    expect(result[1].compositeScore).toBeGreaterThanOrEqual(result[2].compositeScore!);
  });

  it('should prioritize quality for frontier target', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'high-quality', qualityScore: 0.95, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
      makeCandidate({ modelId: 'cheap-fast', qualityScore: 0.6, costPerInputToken: 0.001, avgLatencyMs: 500 }),
    ];

    const result = costLatencyScorer(candidates, 'frontier');
    expect(result[0].modelId).toBe('high-quality');
  });

  it('should prioritize cost for economy target', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'high-quality', qualityScore: 0.95, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
      makeCandidate({ modelId: 'cheap-fast', qualityScore: 0.6, costPerInputToken: 0.001, avgLatencyMs: 500 }),
    ];

    const result = costLatencyScorer(candidates, 'economy');
    expect(result[0].modelId).toBe('cheap-fast');
  });

  it('should handle single candidate', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'only-one' }),
    ];

    const result = costLatencyScorer(candidates, 'balanced');
    expect(result).toHaveLength(1);
    expect(result[0].compositeScore).toBeDefined();
  });

  it('should handle diffusion models with costPerImage', () => {
    const candidates: CandidateSet = [
      makeCandidate({
        modelId: 'diffusion-a',
        modality: 'diffusion',
        costPerInputToken: 0,
        costPerImage: 0.02,
        qualityScore: 0.8,
      }),
      makeCandidate({
        modelId: 'diffusion-b',
        modality: 'diffusion',
        costPerInputToken: 0,
        costPerImage: 0.05,
        qualityScore: 0.9,
      }),
    ];

    const result = costLatencyScorer(candidates, 'balanced');
    expect(result).toHaveLength(2);
    expect(result[0].compositeScore).toBeDefined();
  });
});
