import { describe, it, expect } from 'vitest';
import { capabilityFilter } from '../../services/router/src/pipeline/capability-filter.js';
import type { CandidateSet, Modality } from '../../packages/core/src/types/index.js';

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
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

describe('capabilityFilter', () => {
  it('should filter by modality', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modality: 'llm', modelId: 'llm-model' }),
      makeCandidate({ modality: 'diffusion', modelId: 'diffusion-model' }),
      makeCandidate({ modality: 'embedding', modelId: 'embedding-model' }),
    ];

    const result = capabilityFilter(candidates, [], 'llm');
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('llm-model');
  });

  it('should filter by required capabilities', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'no-vision', capabilities: [] }),
      makeCandidate({ modelId: 'with-vision', capabilities: ['vision'] }),
      makeCandidate({ modelId: 'with-vision-tools', capabilities: ['vision', 'tool_use'] }),
    ];

    const result = capabilityFilter(candidates, ['vision'], 'llm');
    expect(result).toHaveLength(2);
    expect(result.map(c => c.modelId)).toEqual(['with-vision', 'with-vision-tools']);
  });

  it('should filter by multiple capabilities', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'vision-only', capabilities: ['vision'] }),
      makeCandidate({ modelId: 'vision-tools', capabilities: ['vision', 'tool_use'] }),
      makeCandidate({ modelId: 'all', capabilities: ['vision', 'tool_use', 'json_mode'] }),
    ];

    const result = capabilityFilter(candidates, ['vision', 'tool_use'], 'llm');
    expect(result).toHaveLength(2);
    expect(result.map(c => c.modelId)).toEqual(['vision-tools', 'all']);
  });

  it('should return empty if no candidates match modality', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modality: 'diffusion' }),
    ];

    const result = capabilityFilter(candidates, [], 'llm');
    expect(result).toHaveLength(0);
  });

  it('should return empty if no candidates have required capabilities', () => {
    const candidates: CandidateSet = [
      makeCandidate({ capabilities: [] }),
    ];

    const result = capabilityFilter(candidates, ['vision'], 'llm');
    expect(result).toHaveLength(0);
  });

  it('should pass all candidates when no capabilities required', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'a' }),
      makeCandidate({ modelId: 'b' }),
      makeCandidate({ modelId: 'c' }),
    ];

    const result = capabilityFilter(candidates, [], 'llm');
    expect(result).toHaveLength(3);
  });
});
