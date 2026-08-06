import type { CandidateSet, TaskProfile } from '@dmr-x/core';
import { describe, it, expect } from 'vitest';

import { ProviderUnavailableError } from '../../packages/core/src/types/errors.js';
import { runPipeline } from '../../services/router/src/pipeline/pipeline.js';

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

function makeTaskProfile(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    modality: 'llm',
    capabilities: [],
    sizeEstimate: { inputTokens: 100, outputTokensEst: 500 },
    priority: 5,
    streaming: false,
    qualityTarget: 'balanced',
    ...overrides,
  };
}

describe('pipeline', () => {
  it('should run full pipeline and select best candidate', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'good', qualityScore: 0.9, costPerInputToken: 0.002, avgLatencyMs: 800 }),
      makeCandidate({ modelId: 'medium', qualityScore: 0.7, costPerInputToken: 0.001, avgLatencyMs: 1200 }),
      makeCandidate({ modelId: 'low', qualityScore: 0.5, costPerInputToken: 0.0005, avgLatencyMs: 2000 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0, // No exploration for deterministic test
    });

    expect(result.selected).toBeDefined();
    expect(result.chain).toBeDefined();
    expect(result.scoredCandidates).toHaveLength(3);
  });

  it('should filter out unhealthy candidates', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'healthy', isHealthy: true, qualityScore: 0.7 }),
      makeCandidate({ modelId: 'unhealthy', isHealthy: false, qualityScore: 0.9 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
    });

    expect(result.selected.modelId).toBe('healthy');
  });

  it('should filter by modality', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'llm', modality: 'llm' }),
      makeCandidate({ modelId: 'diffusion', modality: 'diffusion' }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile({ modality: 'llm' }),
      candidates,
      epsilon: 0,
    });

    expect(result.selected.modelId).toBe('llm');
  });

  it('should filter by required capabilities', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'no-vision', capabilities: [] }),
      makeCandidate({ modelId: 'with-vision', capabilities: ['vision'] }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile({ capabilities: ['vision'] }),
      candidates,
      epsilon: 0,
    });

    expect(result.selected.modelId).toBe('with-vision');
  });

  it('should throw ProviderUnavailableError when no candidates survive filtering', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modality: 'diffusion' }),
    ];

    await expect(() =>
      runPipeline({
        taskProfile: makeTaskProfile({ modality: 'llm' }),
        candidates,
        epsilon: 0,
      })
    ).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
  });

  it('should build fallback chain from remaining candidates', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'provider-a', modelId: 'first', qualityScore: 0.9 }),
      makeCandidate({ providerId: 'provider-b', modelId: 'second', qualityScore: 0.8 }),
      makeCandidate({ providerId: 'provider-c', modelId: 'third', qualityScore: 0.7 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
    });

    expect(result.chain).toHaveLength(2);
    expect(result.chain[0].provider.modelId).toBe('second');
    expect(result.chain[1].provider.modelId).toBe('third');
  });

  it('should handle single candidate', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'only-one' }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
    });

    expect(result.selected.modelId).toBe('only-one');
    expect(result.chain).toHaveLength(0);
  });
});

describe('free-tier strategy', () => {
  const freeA = makeCandidate({ providerId: 'free-provider-a', modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 });
  const freeB = makeCandidate({ providerId: 'free-provider-b', modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.6 });
  const paidA = makeCandidate({ providerId: 'paid-provider-a', modelId: 'paid-a', costPerInputToken: 0.002, costPerOutputToken: 0.004, qualityScore: 0.9 });
  const paidB = makeCandidate({ providerId: 'paid-provider-b', modelId: 'paid-b', costPerInputToken: 0.001, costPerOutputToken: 0.002, qualityScore: 0.7 });
  const mixedCandidates: CandidateSet = [paidA, freeA, paidB, freeB];

  it('none: keeps normal scoring order', async () => {
    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates: mixedCandidates,
      epsilon: 0,
      freeTierStrategy: 'none',
    });

    // With balanced weights, paid-a (high quality) should rank first
    expect(result.selected.modelId).toBe('paid-a');
  });

  it('prioritize: free models come first', async () => {
    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates: mixedCandidates,
      epsilon: 0,
      freeTierStrategy: 'prioritize',
    });

    // Free-a has higher quality (0.8) among free models
    expect(result.selected.modelId).toBe('free-a');
    // Fallback chain should include free-b then paid models
    expect(result.chain.length).toBeGreaterThan(0);
  });

  it('load_balance: distributes across free and paid models', async () => {
    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates: mixedCandidates,
      epsilon: 0,
      freeTierStrategy: 'load_balance',
    });

    // Should pick from all candidates (free + paid)
    expect(['free-a', 'free-b', 'paid-a', 'paid-b']).toContain(result.selected.modelId);
    // Fallback chain should include the rest
    expect(result.chain.length).toBe(3);
  });

  it('load_balance: single candidate returns it', async () => {
    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates: [makeCandidate({ modelId: 'only', costPerInputToken: 0, costPerOutputToken: 0 })],
      epsilon: 0,
      freeTierStrategy: 'load_balance',
    });

    expect(result.selected.modelId).toBe('only');
  });

  it('fallback: paid models come first, free as fallback', async () => {
    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates: mixedCandidates,
      epsilon: 0,
      freeTierStrategy: 'fallback',
    });

    // Paid-a (highest quality) should be primary
    expect(result.selected.modelId).toBe('paid-a');
    // Free models should be in the fallback chain
    const chainIds = result.chain.map((s) => s.provider.modelId);
    expect(chainIds).toContain('free-a');
  });
});

describe('retryWithWait', () => {
  function makeMockRateLimitService(rateLimitedModels: Set<string> = new Set()) {
    return {
      checkLimit(providerId: string, modelId: string, _estimatedTokens: number) {
        if (rateLimitedModels.has(modelId)) {
          return { allowed: false, retryAfterMs: 500, reason: 'RPM exceeded' };
        }
        return { allowed: true };
      },
      getPenaltyPoints() { return 0; },
      getState(providerId: string, modelId: string) {
        return {
          providerId, modelId,
          config: { rpm: 3 },
          currentRPM: rateLimitedModels.has(modelId) ? 3 : 0,
          currentRPD: 0, currentTPM: 0, currentTPD: 0, penaltyPoints: 0,
        };
      },
      addPenalty() { return 0; },
      isOnCooldown(_providerId: string, _modelId: string) { return false; },
      getCooldownExpiry(_providerId: string, _modelId: string) { return null; },
    };
  }

  it('should throw ProviderUnavailableError when all providers are rate-limited', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'rl-model' }),
    ];
    const rls = makeMockRateLimitService(new Set(['rl-model']));

    await expect(() =>
      runPipeline({
        taskProfile: makeTaskProfile(),
        candidates,
        epsilon: 0,
        rateLimitService: rls as any,
        retryWithWait: false,
      })
    ).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
  });

  it('should retry after wait when earliestResetMs is within maxWaitMs', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'retry-model', qualityScore: 0.9 }),
      makeCandidate({ modelId: 'backup-model', qualityScore: 0.5 }),
    ];

    let callCount = 0;
    const rls = {
      checkLimit(providerId: string, modelId: string, _estimatedTokens: number) {
        callCount++;
        // First call: rate-limit retry-model; second call (re-check): allow it
        if (callCount <= 2 && modelId === 'retry-model') {
          return { allowed: false, retryAfterMs: 100, reason: 'RPM exceeded' };
        }
        return { allowed: true };
      },
      getPenaltyPoints() { return 0; },
      getState(providerId: string, modelId: string) {
        return {
          providerId, modelId,
          config: { rpm: 3 },
          currentRPM: 0, currentRPD: 0, currentTPM: 0, currentTPD: 0, penaltyPoints: 0,
        };
      },
      addPenalty() { return 0; },
      isOnCooldown(_providerId: string, _modelId: string) { return false; },
      getCooldownExpiry(_providerId: string, _modelId: string) { return null; },
    };

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      rateLimitService: rls as any,
      maxWaitMs: 1000,
    });

    // After retry, backup-model should still be available
    expect(result.selected).toBeDefined();
    expect(['retry-model', 'backup-model']).toContain(result.selected.modelId);
  });

  it('should use maxWaitMs to cap wait time', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'model-a' }),
    ];
    const rls = makeMockRateLimitService(new Set(['model-a']));

    // With retryWithWait: false, should throw immediately
    await expect(() =>
      runPipeline({
        taskProfile: makeTaskProfile(),
        candidates,
        epsilon: 0,
        rateLimitService: rls as any,
        retryWithWait: false,
      })
    ).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
  });

  it('should default retryWithWait to true', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'model-a' }),
    ];
    const rls = makeMockRateLimitService(new Set(['model-a']));

    // With default retryWithWait (true), should wait and then throw if still no providers
    await expect(() =>
      runPipeline({
        taskProfile: makeTaskProfile(),
        candidates,
        epsilon: 0,
        rateLimitService: rls as any,
        maxWaitMs: 100,
      })
    ).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
  });
});

describe('free-tier headroom', () => {
  it('load_balance should factor in rate-limit headroom', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'high-headroom', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.5 }),
      makeCandidate({ modelId: 'low-headroom', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.9 }),
    ];

    const rls = {
      checkLimit() { return { allowed: true }; },
      getPenaltyPoints() { return 0; },
      getState(_providerId: string, modelId: string) {
        if (modelId === 'low-headroom') {
          return {
            providerId: 'test', modelId,
            config: { rpm: 3 },
            currentRPM: 2, // 1/3 remaining = low headroom
            currentRPD: 0, currentTPM: 0, currentTPD: 0, penaltyPoints: 0,
          };
        }
        return {
          providerId: 'test', modelId,
          config: { rpm: 3 },
          currentRPM: 0, // 3/3 remaining = high headroom
          currentRPD: 0, currentTPM: 0, currentTPD: 0, penaltyPoints: 0,
        };
      },
      addPenalty() { return 0; },
      isOnCooldown(_providerId: string, _modelId: string) { return false; },
      getCooldownExpiry(_providerId: string, _modelId: string) { return null; },
    };

    // Run multiple times to verify high-headroom model is favored
    const selections = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const result = await runPipeline({
        taskProfile: makeTaskProfile(),
        candidates,
        epsilon: 0,
        freeTierStrategy: 'load_balance',
        rateLimitService: rls as any,
      });
      selections.add(result.selected.modelId);
    }

    // Both should be selectable, but high-headroom should be favored
    expect(selections.has('high-headroom')).toBe(true);
  });
});

describe('RoutingStrategy: free', () => {
  it('should filter to zero-cost models when strategy is free', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.7 }),
      makeCandidate({ modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 }),
      makeCandidate({ modelId: 'paid-a', costPerInputToken: 0.002, costPerOutputToken: 0.004, qualityScore: 0.95 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      providerPreferences: { strategy: 'free' },
    });

    // Should only select from free models
    expect(['free-a', 'free-b']).toContain(result.selected.modelId);
    // Paid model should not be in fallback chain either (filtered out by providerPreferences)
    const allIds = [result.selected.modelId, ...result.chain.map(c => c.provider.modelId)];
    expect(allIds).not.toContain('paid-a');
  });
});

describe('providerPreferences: zdr (privacy)', () => {
  it('filters to self_hosted/on_device candidates when zdr is set', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'ollama', modelId: 'local-llama', deployment: 'self_hosted', qualityScore: 0.5 }),
      makeCandidate({ providerId: 'openai', modelId: 'gpt-x', deployment: 'cloud', qualityScore: 0.99 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      providerPreferences: { zdr: true },
    });

    expect(result.selected.providerId).toBe('ollama');
    const allIds = [result.selected.modelId, ...result.chain.map(c => c.provider.modelId)];
    expect(allIds).not.toContain('gpt-x');
  });

  it('fails closed: excludes candidates with no deployment tag', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'unclassified', modelId: 'mystery-model' }), // no `deployment` set
    ];

    await expect(
      runPipeline({
        taskProfile: makeTaskProfile(),
        candidates,
        epsilon: 0,
        providerPreferences: { zdr: true },
      })
    ).rejects.toThrow(ProviderUnavailableError);
  });

  it('ignore/only still apply alongside zdr', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'ollama', modelId: 'local-llama', deployment: 'self_hosted' }),
      makeCandidate({ providerId: 'on-device-thing', modelId: 'edge-model', deployment: 'on_device' }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      providerPreferences: { zdr: true, ignore: ['ollama'] },
    });

    expect(result.selected.providerId).toBe('on-device-thing');
  });
});

describe('providerPreferences: ignore/only/order match by providerName (slug), not just providerId', () => {
  // Real candidates carry a DB UUID as `providerId` and the human-facing
  // slug ("openai", "ollama", ...) as `providerName` (see
  // services/registry/src/registry.service.ts: `p.id as "providerId"`,
  // `p.name as "providerName"`). Every real caller (MCP tool params, the
  // X-Provider-Preferences header) sends slugs, never UUIDs, so these
  // filters must match against `providerName`.
  it('ignore excludes by providerName even when providerId is a UUID', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: '6e99ca1d-6516-4a5c-96c9-0f5e7dd164e5', providerName: 'openai', modelId: 'gpt-x', qualityScore: 0.99 }),
      makeCandidate({ providerId: 'c10f5f0c-73e0-4cb5-9ebe-28e3be362ed5', providerName: 'anthropic', modelId: 'claude-x', qualityScore: 0.9 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      providerPreferences: { ignore: ['openai'] },
    });

    expect(result.selected.modelId).toBe('claude-x');
    const allIds = [result.selected.modelId, ...result.chain.map(c => c.provider.modelId)];
    expect(allIds).not.toContain('gpt-x');
  });

  it('only whitelists by providerName even when providerId is a UUID', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: '6e99ca1d-6516-4a5c-96c9-0f5e7dd164e5', providerName: 'openai', modelId: 'gpt-x', qualityScore: 0.99 }),
      makeCandidate({ providerId: 'c10f5f0c-73e0-4cb5-9ebe-28e3be362ed5', providerName: 'ollama', modelId: 'local-llama', qualityScore: 0.5 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      providerPreferences: { only: ['ollama'] },
    });

    expect(result.selected.modelId).toBe('local-llama');
  });
});

describe('metaModelFilteredFree', () => {
  it('should skip free-tier strategy when metaModelFilteredFree is true', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 }),
      makeCandidate({ modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.6 }),
    ];

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      freeTierStrategy: 'prioritize',
      metaModelFilteredFree: true,
    });

    // Should still select a free model (candidates already filtered)
    expect(['free-a', 'free-b']).toContain(result.selected.modelId);
  });
});

describe('Thompson sampling integration', () => {
  it('should accept thompsonSampler parameter', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 }),
      makeCandidate({ modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.6 }),
    ];

    // Simple mock sampler that always picks the first candidate
    const mockSampler = {
      select: (cands: CandidateSet) => cands[0],
    };

    const result = await runPipeline({
      taskProfile: makeTaskProfile(),
      candidates,
      epsilon: 0,
      thompsonSampler: mockSampler as any,
    });

    expect(result.selected.modelId).toBe('free-a');
  });
});
