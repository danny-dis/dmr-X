import { describe, it, expect } from 'vitest';

import type { CandidateSet } from '../../packages/core/src/types/index.js';
import { isMetaModel, resolveMetaModel, META_MODELS } from '../../services/router/src/meta-models.js';

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
    capabilities: [],
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    isHealthy: true,
    ...overrides,
  };
}

describe('meta-models', () => {
  it('should recognize meta-model aliases', () => {
    expect(isMetaModel('auto')).toBe(true);
    expect(isMetaModel('auto-fast')).toBe(true);
    expect(isMetaModel('auto-smart')).toBe(true);
    expect(isMetaModel('auto-agentic')).toBe(true);
    expect(isMetaModel('auto-coding')).toBe(true);
    expect(isMetaModel('auto-reasoning')).toBe(true);
    expect(isMetaModel('auto-vision')).toBe(true);
    expect(isMetaModel('auto-cheap')).toBe(true);
    expect(isMetaModel('auto-long-context')).toBe(true);
    expect(isMetaModel('auto-free')).toBe(true);
    expect(isMetaModel('free')).toBe(true);
    expect(isMetaModel('free-fast')).toBe(true);
    expect(isMetaModel('free-smart')).toBe(true);
    expect(isMetaModel('free-agentic')).toBe(true);
    expect(isMetaModel('free-coding')).toBe(true);
    expect(isMetaModel('gpt-4o')).toBe(false);
  });

  it('should have all meta-model definitions', () => {
    expect(META_MODELS).toHaveLength(15);
    expect(META_MODELS.map(m => m.alias)).toEqual([
      'auto', 'auto-fast', 'auto-smart', 'auto-agentic', 'auto-coding',
      'auto-reasoning', 'auto-vision', 'auto-cheap', 'auto-long-context', 'auto-free',
      'free', 'free-fast', 'free-smart', 'free-agentic', 'free-coding',
    ]);
  });

  it('should resolve auto as neutral pass-through (no re-sorting) with costFilter=all', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'first', qualityScore: 0.5, avgLatencyMs: 200, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'second', qualityScore: 0.9, avgLatencyMs: 2000, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'paid', qualityScore: 0.95, costPerInputToken: 0.01 }),
    ];

    const result = resolveMetaModel('auto', candidates);
    expect(result).not.toBeNull();
    expect(result!.costFilter).toBe('all');
    // auto with costFilter=all should NOT re-sort and should include paid models
    expect(result!.resolved[0].modelId).toBe('first');
    expect(result!.resolved[1].modelId).toBe('second');
    expect(result!.resolved[2].modelId).toBe('paid');
    expect(result!.resolved).toHaveLength(3);
  });

  it('should resolve auto-fast to lowest latency model (all providers)', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'slow', qualityScore: 0.9, avgLatencyMs: 2000, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'fast', qualityScore: 0.5, avgLatencyMs: 200, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'paid-fast', qualityScore: 0.7, avgLatencyMs: 100, costPerInputToken: 0.01 }),
    ];

    const result = resolveMetaModel('auto-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.costFilter).toBe('all');
    // paid-fast has lowest latency, should win in costFilter=all mode
    expect(result!.resolved[0].modelId).toBe('paid-fast');
  });

  it('should resolve auto-smart to highest quality model (all providers)', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'dumb', qualityScore: 0.3, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'smart', qualityScore: 0.95, costPerInputToken: 0 }),
      makeCandidate({ modelId: 'paid-smart', qualityScore: 0.99, costPerInputToken: 0.01 }),
    ];

    const result = resolveMetaModel('auto-smart', candidates);
    expect(result).not.toBeNull();
    expect(result!.costFilter).toBe('all');
    // paid-smart has highest quality, should win in costFilter=all mode
    expect(result!.resolved[0].modelId).toBe('paid-smart');
  });

  it('should return null for non-meta-model', () => {
    expect(resolveMetaModel('gpt-4o', [])).toBeNull();
  });

  it('should return null when no candidates match at all', () => {
    expect(resolveMetaModel('auto', [])).toBeNull();
  });

  it('should exclude paid models when costFilter=free', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'free-1', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.7 }),
      makeCandidate({ modelId: 'paid-1', costPerInputToken: 0.01, costPerOutputToken: 0.02, qualityScore: 0.99 }),
    ];

    const result = resolveMetaModel('auto', candidates, 'free');
    expect(result).not.toBeNull();
    expect(result!.costFilter).toBe('free');
    expect(result!.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    expect(result!.resolved.find(c => c.modelId === 'paid-1')).toBeUndefined();
  });

  it('should preserve all candidates in original order with costFilter=all', () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'free-a', costPerInputToken: 0, qualityScore: 0.6 }),
      makeCandidate({ modelId: 'free-b', costPerInputToken: 0, qualityScore: 0.8 }),
      makeCandidate({ modelId: 'paid-c', costPerInputToken: 0.01, qualityScore: 0.9 }),
    ];

    const result = resolveMetaModel('auto', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved).toHaveLength(3);
    // auto is neutral with costFilter=all — preserves original order including paid
    expect(result!.resolved[0].modelId).toBe('free-a');
    expect(result!.resolved[1].modelId).toBe('free-b');
    expect(result!.resolved[2].modelId).toBe('paid-c');
  });

  describe('free meta-models', () => {
    it('should resolve free to only free models in original order', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-1', costPerInputToken: 0, qualityScore: 0.6 }),
        makeCandidate({ modelId: 'paid', costPerInputToken: 0.01, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'free-2', costPerInputToken: 0, qualityScore: 0.7 }),
      ];
      
      const result = resolveMetaModel('free', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved[0].modelId).toBe('free-1');
      expect(result!.resolved[1].modelId).toBe('free-2');
    });

    it('should resolve free-fast to fastest free model only', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-slow', costPerInputToken: 0, avgLatencyMs: 2000 }),
        makeCandidate({ modelId: 'free-fast', costPerInputToken: 0, avgLatencyMs: 200 }),
        makeCandidate({ modelId: 'paid-faster', costPerInputToken: 0.01, avgLatencyMs: 100 }),
      ];

      const result = resolveMetaModel('free-fast', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved[0].modelId).toBe('free-fast');
      expect(result!.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    });

    it('should resolve free-smart to smartest free model only', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-dumb', costPerInputToken: 0, qualityScore: 0.5 }),
        makeCandidate({ modelId: 'free-smart', costPerInputToken: 0, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'paid-smarter', costPerInputToken: 0.01, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('free-smart', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved[0].modelId).toBe('free-smart');
      expect(result!.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    });
  });

  describe('auto-agentic', () => {
    it('should return models with tool_use and 64K+ context (all providers by default)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'agentic-good', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'no-tools', costPerInputToken: 0, capabilities: [], contextLength: 128000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'small-context', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 8000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-agentic', costPerInputToken: 0.01, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      // With costFilter=all, paid-agentic is included
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.find(c => c.modelId === 'paid-agentic')).toBeDefined();
    });

    it('should prioritize models with json_mode and streaming', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'basic', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'full-featured', costPerInputToken: 0, capabilities: ['tool_use', 'json_mode', 'streaming'], contextLength: 128000, qualityScore: 0.8 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved[0].modelId).toBe('full-featured');
    });

    it('should exclude models without tool_use capability', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'no-tools', costPerInputToken: 0, capabilities: ['streaming'], contextLength: 128000 }),
        makeCandidate({ modelId: 'has-tools', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('has-tools');
    });

    it('should exclude models with context < 64K', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'tiny', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 4096 }),
        makeCandidate({ modelId: 'small', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 32000 }),
        makeCandidate({ modelId: 'big', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 64000 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('big');
    });

    it('should handle models with unknown context length', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'unknown-ctx', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: undefined }),
        makeCandidate({ modelId: 'known-good', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      // unknown-ctx has contextLength undefined (0 when nullish coalesced), filtered out
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('known-good');
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'agentic-good', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'paid-agentic', costPerInputToken: 0.01, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('agentic-good');
    });
  });

  describe('auto-coding', () => {
    it('should return models with 32K+ context (all providers by default)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'coding-good', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'small-context', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 16000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-coding', costPerInputToken: 0.01, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-coding', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      // With costFilter=all, paid-coding is included
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.find(c => c.modelId === 'paid-coding')).toBeDefined();
    });

    it('should prioritize models with more coding capabilities including json_mode', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'basic', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'full-featured', costPerInputToken: 0, capabilities: ['tool_use', 'streaming', 'reasoning', 'json_mode'], contextLength: 128000, qualityScore: 0.8 }),
      ];

      const result = resolveMetaModel('auto-coding', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved[0].modelId).toBe('full-featured');
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-code', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
        makeCandidate({ modelId: 'paid-code', costPerInputToken: 0.01, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-coding', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free-code');
    });

    it('should handle models with unknown context length', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'unknown-ctx', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: undefined }),
        makeCandidate({ modelId: 'known-good', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-coding', candidates);
      expect(result).not.toBeNull();
      // unknown-ctx has contextLength undefined (0 when nullish coalesced), filtered out
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('known-good');
    });

    it('should return null when no candidates match criteria at all', () => {
      expect(resolveMetaModel('auto-coding', [])).toBeNull();
    });
  });

  describe('auto-reasoning', () => {
    it('should return models with reasoning capability and 32K+ context', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'reasoning-good', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 128000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'no-reasoning', costPerInputToken: 0, capabilities: ['streaming'], contextLength: 128000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'small-context', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 8000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-reasoning', costPerInputToken: 0.01, capabilities: ['reasoning'], contextLength: 128000, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-reasoning', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.find(c => c.modelId === 'paid-reasoning')).toBeDefined();
    });

    it('should exclude models without reasoning capability', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'no-reasoning', costPerInputToken: 0, capabilities: ['streaming'], contextLength: 128000 }),
        makeCandidate({ modelId: 'has-reasoning', costPerInputToken: 0, capabilities: ['reasoning', 'streaming'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-reasoning', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('has-reasoning');
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-reasoning', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 128000 }),
        makeCandidate({ modelId: 'paid-reasoning', costPerInputToken: 0.01, capabilities: ['reasoning'], contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-reasoning', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free-reasoning');
    });
  });

  describe('auto-vision', () => {
    it('should return models with vision capability', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'vision-good', costPerInputToken: 0, capabilities: ['vision'], qualityScore: 0.8 }),
        makeCandidate({ modelId: 'no-vision', costPerInputToken: 0, capabilities: ['streaming'], qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-vision', costPerInputToken: 0.01, capabilities: ['vision'], qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-vision', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.find(c => c.modelId === 'paid-vision')).toBeDefined();
    });

    it('should exclude models without vision capability', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'no-vision', costPerInputToken: 0, capabilities: ['streaming'] }),
        makeCandidate({ modelId: 'has-vision', costPerInputToken: 0, capabilities: ['vision', 'streaming'] }),
      ];

      const result = resolveMetaModel('auto-vision', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('has-vision');
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-vision', costPerInputToken: 0, capabilities: ['vision'] }),
        makeCandidate({ modelId: 'paid-vision', costPerInputToken: 0.01, capabilities: ['vision'] }),
      ];

      const result = resolveMetaModel('auto-vision', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free-vision');
    });
  });

  describe('auto-cheap', () => {
    it('should sort by total cost ascending with quality tiebreaker', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'expensive', costPerInputToken: 0.05, costPerOutputToken: 0.10, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'cheap', costPerInputToken: 0.001, costPerOutputToken: 0.002, qualityScore: 0.6 }),
        makeCandidate({ modelId: 'free', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.7 }),
        makeCandidate({ modelId: 'mid', costPerInputToken: 0.01, costPerOutputToken: 0.02, qualityScore: 0.8 }),
      ];

      const result = resolveMetaModel('auto-cheap', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      // free (cost=0) should be first, then cheap (0.003), then mid (0.03), then expensive (0.15)
      expect(result!.resolved[0].modelId).toBe('free');
      expect(result!.resolved[1].modelId).toBe('cheap');
      expect(result!.resolved[2].modelId).toBe('mid');
      expect(result!.resolved[3].modelId).toBe('expensive');
    });

    it('should use quality as tiebreaker for same-cost models', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'same-cost-low-q', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.3 }),
        makeCandidate({ modelId: 'same-cost-high-q', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.9 }),
      ];

      const result = resolveMetaModel('auto-cheap', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved[0].modelId).toBe('same-cost-high-q');
    });

    it('should include all providers by default (free + paid)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'paid', costPerInputToken: 0.01, costPerOutputToken: 0.02 }),
        makeCandidate({ modelId: 'free', costPerInputToken: 0, costPerOutputToken: 0 }),
      ];

      const result = resolveMetaModel('auto-cheap', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(2);
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free', costPerInputToken: 0, costPerOutputToken: 0 }),
        makeCandidate({ modelId: 'paid', costPerInputToken: 0.01, costPerOutputToken: 0.02 }),
      ];

      const result = resolveMetaModel('auto-cheap', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free');
    });
  });

  describe('auto-long-context', () => {
    it('should return models with 128K+ context', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'long-ctx', costPerInputToken: 0, contextLength: 256000, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'short-ctx', costPerInputToken: 0, contextLength: 64000, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-long', costPerInputToken: 0.01, contextLength: 512000, qualityScore: 0.95 }),
      ];

      const result = resolveMetaModel('auto-long-context', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('all');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.find(c => c.modelId === 'paid-long')).toBeDefined();
    });

    it('should exclude models with context < 128K', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'tiny', costPerInputToken: 0, contextLength: 4096 }),
        makeCandidate({ modelId: 'medium', costPerInputToken: 0, contextLength: 64000 }),
        makeCandidate({ modelId: 'big', costPerInputToken: 0, contextLength: 128000 }),
      ];

      const result = resolveMetaModel('auto-long-context', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('big');
    });

    it('should exclude paid models when costFilter=free', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-long', costPerInputToken: 0, contextLength: 256000 }),
        makeCandidate({ modelId: 'paid-long', costPerInputToken: 0.01, contextLength: 256000 }),
      ];

      const result = resolveMetaModel('auto-long-context', candidates, 'free');
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free-long');
    });
  });

  describe('auto-free', () => {
    it('should only return free models regardless of costFilter override', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-1', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.7 }),
        makeCandidate({ modelId: 'free-2', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.9 }),
        makeCandidate({ modelId: 'paid-1', costPerInputToken: 0.01, costPerOutputToken: 0.02, qualityScore: 0.99 }),
      ];

      const result = resolveMetaModel('auto-free', candidates);
      expect(result).not.toBeNull();
      expect(result!.costFilter).toBe('free');
      expect(result!.resolved).toHaveLength(2);
      expect(result!.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    });

    it('should ignore costFilter override (always free)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-1', costPerInputToken: 0, costPerOutputToken: 0 }),
        makeCandidate({ modelId: 'paid-1', costPerInputToken: 0.01, costPerOutputToken: 0.02 }),
      ];

      // Even passing 'all' should still filter to free only
      const result = resolveMetaModel('auto-free', candidates, 'all');
      expect(result).not.toBeNull();
      // costFilter reflects the override passed, but the ranker always filters to free
      expect(result!.costFilter).toBe('all');
      expect(result!.resolved).toHaveLength(1);
      expect(result!.resolved[0].modelId).toBe('free-1');
      expect(result!.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    });

    it('should preserve original order of free candidates', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.6 }),
        makeCandidate({ modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 }),
        makeCandidate({ modelId: 'free-c', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.4 }),
      ];

      const result = resolveMetaModel('auto-free', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      expect(result!.resolved[0].modelId).toBe('free-a');
      expect(result!.resolved[1].modelId).toBe('free-b');
      expect(result!.resolved[2].modelId).toBe('free-c');
    });

    it('should return null when no free candidates exist', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'paid-1', costPerInputToken: 0.01, costPerOutputToken: 0.02 }),
      ];

      const result = resolveMetaModel('auto-free', candidates);
      expect(result).toBeNull();
    });
  });
});
