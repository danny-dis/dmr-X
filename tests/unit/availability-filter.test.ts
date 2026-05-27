import { describe, it, expect } from 'vitest';
import { availabilityFilter } from '../../services/router/src/pipeline/availability-filter.js';
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

describe('availabilityFilter', () => {
  it('should keep only healthy candidates', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'healthy-1', isHealthy: true }),
      makeCandidate({ modelId: 'unhealthy', isHealthy: false }),
      makeCandidate({ modelId: 'healthy-2', isHealthy: true }),
    ];

    const result = availabilityFilter(candidates);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.modelId)).toEqual(['healthy-1', 'healthy-2']);
  });

  it('should return empty if all candidates are unhealthy', () => {
    const candidates: CandidateSet = [
      makeCandidate({ isHealthy: false }),
      makeCandidate({ isHealthy: false }),
    ];

    const result = availabilityFilter(candidates);
    expect(result).toHaveLength(0);
  });

  it('should return all if all are healthy', () => {
    const candidates: CandidateSet = [
      makeCandidate({ isHealthy: true }),
      makeCandidate({ isHealthy: true }),
    ];

    const result = availabilityFilter(candidates);
    expect(result).toHaveLength(2);
  });

  it('should handle empty input', () => {
    const result = availabilityFilter([]);
    expect(result).toHaveLength(0);
  });
});
