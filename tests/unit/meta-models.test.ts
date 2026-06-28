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
    expect(isMetaModel('gpt-4o')).toBe(false);
  });

  it('should have ten meta-model definitions', () => {
    expect(META_MODELS).toHaveLength(10);
    expect(META_MODELS.map(m => m.alias)).toEqual([
      'auto', 'auto-fast', 'auto-smart', 'auto-agentic', 'auto-coding',
      'auto-reasoning', 'auto-vision', 'auto-cheap', 'auto-long-context', 'auto-free',
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

    it('should sort by composite score: quality (50%) + context (30%) + speed (20%)', () => {
      const candidates: CandidateSet = [
        // High quality, medium context, slow
        makeCandidate({ modelId: 'quality-king', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
        // Medium quality, huge context, fast
        makeCandidate({ modelId: 'context-beast', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 1000000, qualityScore: 0.7, avgLatencyMs: 500 }),
        // Medium everything
        makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 256000, qualityScore: 0.8, avgLatencyMs: 1000 }),
      ];

      const result = resolveMetaModel('auto-agentic', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      // quality-king: 0.95*0.5 + min(128K/1M,1)*0.3 + max(0,1-3000/5000)*0.2 = 0.475 + 0.0384 + 0.08 = 0.5934
      // context-beast: 0.7*0.5 + 1.0*0.3 + max(0,1-500/5000)*0.2 = 0.35 + 0.3 + 0.18 = 0.83
      // balanced: 0.8*0.5 + min(256K/1M,1)*0.3 + max(0,1-1000/5000)*0.2 = 0.4 + 0.0768 + 0.16 = 0.6368
      // context-beast should win (highest score)
      expect(result!.resolved[0].modelId).toBe('context-beast');
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

    it('should sort by composite score: quality (30%) + specialization (40%) + context (20%) + speed (10%)', () => {
      const candidates: CandidateSet = [
        // High quality, few code capabilities, medium context, slow
        makeCandidate({ modelId: 'quality-king', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
        // Medium quality, all code capabilities, huge context, fast
        makeCandidate({ modelId: 'code-beast', costPerInputToken: 0, capabilities: ['tool_use', 'streaming', 'reasoning'], contextLength: 256000, qualityScore: 0.7, avgLatencyMs: 500 }),
        // Medium everything
        makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.8, avgLatencyMs: 1000 }),
      ];

      const result = resolveMetaModel('auto-coding', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      // code-beast should win due to high specialization match (all 3 capabilities)
      expect(result!.resolved[0].modelId).toBe('code-beast');
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

    it('should sort by composite score: quality (40%) + reasoning (30%) + context (20%) + speed (10%)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'high-quality', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
        makeCandidate({ modelId: 'fast-reasoner', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 256000, qualityScore: 0.7, avgLatencyMs: 200 }),
        makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['reasoning'], contextLength: 128000, qualityScore: 0.8, avgLatencyMs: 1000 }),
      ];

      const result = resolveMetaModel('auto-reasoning', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      // high-quality: 0.95*0.4 + 1*0.3 + min(128K/256K,1)*0.2 + max(0,1-3000/5000)*0.1 = 0.38+0.3+0.1+0.04 = 0.82
      // fast-reasoner: 0.7*0.4 + 1*0.3 + min(256K/256K,1)*0.2 + max(0,1-200/5000)*0.1 = 0.28+0.3+0.2+0.096 = 0.876
      // balanced: 0.8*0.4 + 1*0.3 + min(128K/256K,1)*0.2 + max(0,1-1000/5000)*0.1 = 0.32+0.3+0.1+0.08 = 0.8
      expect(result!.resolved[0].modelId).toBe('fast-reasoner');
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

    it('should sort by composite score: quality (50%) + vision (25%) + speed (15%) + context (10%)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'quality-king', costPerInputToken: 0, capabilities: ['vision'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
        makeCandidate({ modelId: 'fast-vision', costPerInputToken: 0, capabilities: ['vision'], contextLength: 256000, qualityScore: 0.6, avgLatencyMs: 200 }),
        makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['vision'], contextLength: 128000, qualityScore: 0.8, avgLatencyMs: 1000 }),
      ];

      const result = resolveMetaModel('auto-vision', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      // quality-king: 0.95*0.5 + 1*0.25 + max(0,1-3000/5000)*0.15 + min(128K/256K,1)*0.1 = 0.475+0.25+0.06+0.05 = 0.835
      // fast-vision: 0.6*0.5 + 1*0.25 + max(0,1-200/5000)*0.15 + min(256K/256K,1)*0.1 = 0.3+0.25+0.141+0.1 = 0.791
      // balanced: 0.8*0.5 + 1*0.25 + max(0,1-1000/5000)*0.15 + min(128K/256K,1)*0.1 = 0.4+0.25+0.12+0.05 = 0.82
      expect(result!.resolved[0].modelId).toBe('quality-king');
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

    it('should sort by composite score: context (50%) + quality (30%) + speed (20%)', () => {
      const candidates: CandidateSet = [
        makeCandidate({ modelId: 'huge-ctx', costPerInputToken: 0, contextLength: 1_000_000, qualityScore: 0.6, avgLatencyMs: 2000 }),
        makeCandidate({ modelId: 'medium-ctx', costPerInputToken: 0, contextLength: 256000, qualityScore: 0.9, avgLatencyMs: 500 }),
        makeCandidate({ modelId: 'small-ctx', costPerInputToken: 0, contextLength: 128000, qualityScore: 0.8, avgLatencyMs: 300 }),
      ];

      const result = resolveMetaModel('auto-long-context', candidates);
      expect(result).not.toBeNull();
      expect(result!.resolved).toHaveLength(3);
      // huge-ctx: min(1M/1M,1)*0.5 + 0.6*0.3 + max(0,1-2000/5000)*0.2 = 0.5+0.18+0.12 = 0.8
      // medium-ctx: min(256K/1M,1)*0.5 + 0.9*0.3 + max(0,1-500/5000)*0.2 = 0.128+0.27+0.18 = 0.578
      // small-ctx: min(128K/1M,1)*0.5 + 0.8*0.3 + max(0,1-300/5000)*0.2 = 0.064+0.24+0.188 = 0.492
      expect(result!.resolved[0].modelId).toBe('huge-ctx');
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
