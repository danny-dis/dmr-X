import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock ONLY the DB boundary. Preserve every other @dmr-x/db export so the
// real RegistryService mapping code under test is exercised, not a stub.
const mockState = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock('@dmr-x/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    getDb: () => ({
      prepare: (_sql: string) => ({
        all: (..._params: any[]) => mockState.rows,
        get: () => undefined,
        run: () => ({ changes: 0 }),
      }),
    }),
  };
});

import { RegistryService } from '../../services/registry/src/registry.service.js';
import { resolveMetaModel } from '../../services/router/src/meta-models.js';

// DB-shaped row (snake_case via the SELECT aliases in getCandidates).
function makeDbRow(overrides: Record<string, any> = {}): any {
  return {
    providerId: '99999999-9999-4999-8999-999999999999',
    providerName: 'mistral',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: null,
    capabilityTier: null,
    isHealthy: 1,
    authMethod: 'bearer',
    qualityScore: '0.7',
    eloRating: null,
    avgLatencyMs: null,
    costPerInputToken: null,
    costPerOutputToken: null,
    costPerImage: null,
    supports_streaming: 1,
    supports_vision: 0,
    supports_tool_use: 0,
    supports_json_mode: 0,
    supports_function_call: 0,
    supports_reasoning: 0,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    rateLimitRpm: null,
    rateLimitRpd: null,
    rateLimitTpm: null,
    rateLimitTpd: null,
    monthlyTokenBudget: null,
    intelligenceRank: null,
    speedRank: null,
    subscriptionOnly: 0,
    architectureTier: null,
    taskCategories: null,
    contextTier: null,
    deployment: null,
    reasoningMode: null,
    safetyTier: null,
    agenticLevel: null,
    ...overrides,
  };
}

describe('meta purpose priors: unknown latency stays unknown (vertical)', () => {
  beforeEach(() => {
    mockState.rows = [];
    delete process.env.DMRX_PROVIDER_ALLOWLIST;
  });

  it('preserves NULL avg_latency_ms as unknown instead of inventing measured 1000ms', () => {
    mockState.rows = [makeDbRow({ modelId: 'test-flash-lite' })];
    const [c] = new RegistryService().getCandidates();
    // Unknown must remain explicitly unknown (undefined), never a fake measurement.
    expect(c.avgLatencyMs).toBeUndefined();
  });

  it('auto-fast orders unknown-latency candidates by speed prior once NULL is preserved', () => {
    mockState.rows = [
      // Higher quality but a slow corner of the prior space (opus/70b -> 0.25).
      makeDbRow({ modelId: 'test-opus-70b', qualityScore: '0.9' }),
      // Lower quality but a fast corner of the prior space (flash-lite -> 0.95).
      makeDbRow({ modelId: 'test-flash-lite', qualityScore: '0.6' }),
    ];
    const candidates = new RegistryService().getCandidates();
    // Both above the auto-fast 0.5 floor; with fake-measured 1000ms each the
    // 0.9-quality model wins on quality alone. With unknown preserved, the
    // fast prior (0.95*0.6 + 0.6*0.25) must beat the slow prior (0.25*0.6 + 0.9*0.25).
    const result = resolveMetaModel('auto-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('test-flash-lite');
  });
});

function freeCandidate(modelId: string, overrides: Record<string, any> = {}): any {
  return {
    providerId: 'p',
    providerName: 'openai',
    modelId,
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'balanced',
    capabilities: [],
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    contextLength: 128000,
    isHealthy: true,
    pricingTier: 'free',
    ...overrides,
  };
}

describe('meta purpose priors: free-fast quality floor + cold prior', () => {
  it('a low-quality fast free model cannot outrank an adequate fast free model', () => {
    const candidates = [
      freeCandidate('junk-fast', { qualityScore: 0.1, avgLatencyMs: 50 }),
      freeCandidate('solid-fast', { qualityScore: 0.6, avgLatencyMs: 300 }),
    ];
    const result = resolveMetaModel('free-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('solid-fast');
  });

  it('orders unmeasured free candidates by the shared cold speed prior', () => {
    const candidates = [
      freeCandidate('test-opus-70b', { avgLatencyMs: undefined, qualityScore: 0.8 }),
      freeCandidate('test-flash-lite', { avgLatencyMs: undefined, qualityScore: 0.8 }),
    ];
    const result = resolveMetaModel('free-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('test-flash-lite');
  });

  it('a positive measured latency is used as-is (not replaced by a cold estimate)', () => {
    const candidates = [
      freeCandidate('test-flash-lite', { avgLatencyMs: undefined, qualityScore: 0.8 }),
      freeCandidate('test-opus-70b', { avgLatencyMs: 100, qualityScore: 0.8 }),
    ];
    const result = resolveMetaModel('free-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('test-opus-70b');
  });

  it('free-fast stays fail-closed: costFilter override cannot widen the free pool', () => {
    const candidates = [
      freeCandidate('free-a', { avgLatencyMs: 500 }),
      freeCandidate('paid-a', {
        pricingTier: 'paid',
        costPerInputToken: 0.01,
        costPerOutputToken: 0.02,
        avgLatencyMs: 10,
      }),
    ];
    for (const override of [undefined, 'all', 'free'] as const) {
      const result = resolveMetaModel('free-fast', candidates, override);
      expect(result).not.toBeNull();
      expect(result!.resolved.map((c) => c.modelId)).toEqual(['free-a']);
    }
  });

  it('free-fast keeps the specialist-only guard', () => {
    const candidates = [
      freeCandidate('nvidia/nemotron-parse-2.0', { avgLatencyMs: 10 }),
      freeCandidate('gemini-2.5-flash', { avgLatencyMs: 5000 }),
    ];
    const result = resolveMetaModel('free-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved.map((c) => c.modelId)).toEqual(['gemini-2.5-flash']);
  });

  it('auto-fast orders unmeasured candidates by prior (consistency lock)', () => {
    const candidates = [
      freeCandidate('test-opus-70b', { avgLatencyMs: undefined, qualityScore: 0.8 }),
      freeCandidate('test-flash-lite', { avgLatencyMs: undefined, qualityScore: 0.8 }),
    ];
    const result = resolveMetaModel('auto-fast', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('test-flash-lite');
  });
});

describe('meta purpose priors: measured coding/agentic benchmark priors', () => {
  const codeTied = (modelId: string, providerName = 'openai') =>
    freeCandidate(modelId, {
      providerName,
      capabilities: ['tool_use', 'streaming', 'reasoning', 'json_mode'],
      contextLength: 128000,
      qualityScore: 0.8,
      avgLatencyMs: 1000,
    });
  const agentTied = (modelId: string, providerName = 'openai') =>
    freeCandidate(modelId, {
      providerName,
      capabilities: ['tool_use', 'json_mode', 'streaming'],
      contextLength: 128000,
      qualityScore: 0.8,
      avgLatencyMs: 1000,
    });

  it('auto-coding prefers the higher measured coding benchmark on tied candidates', () => {
    // codingIndex: gpt-5-mini 15.6 vs gpt-5.5 74.9. Everything else tied.
    const candidates = [codeTied('gpt-5-mini'), codeTied('gpt-5.5')];
    const result = resolveMetaModel('auto-coding', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('gpt-5.5');
  });

  it('free-coding inherits coding priors through -free variants', () => {
    // Neither -free id exists in the snapshot; both inherit exact-base indices.
    const candidates = [
      codeTied('gpt-5-mini-free', 'openai'),
      codeTied('gpt-5.5-free', 'openai'),
    ];
    const result = resolveMetaModel('free-coding', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('gpt-5.5-free');
  });

  it('auto-agentic prefers the higher measured agentic benchmark on tied candidates', () => {
    // agenticIndex: gpt-5-mini 6.8 vs gpt-5.5 36.4. Everything else tied.
    const candidates = [agentTied('gpt-5-mini'), agentTied('gpt-5.5')];
    const result = resolveMetaModel('auto-agentic', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('gpt-5.5');
  });

  it('unmeasured benchmark priors contribute nothing (unknown stays unknown)', () => {
    // claude-sonnet-5.5 exists in the snapshot but carries no codingIndex.
    const candidates = [
      codeTied('claude-sonnet-5.5', 'anthropic'),
      codeTied('gpt-5.5', 'openai'),
    ];
    const result = resolveMetaModel('auto-coding', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('gpt-5.5');
  });

  it('free-agentic keeps its reasoning-aware tool bonus ordering (lock)', () => {
    const candidates = [
      freeCandidate('basic-agent', { capabilities: ['tool_use'], contextLength: 128000 }),
      freeCandidate('full-agent', {
        capabilities: ['tool_use', 'json_mode', 'streaming', 'reasoning'],
        contextLength: 128000,
      }),
    ];
    const result = resolveMetaModel('free-agentic', candidates);
    expect(result).not.toBeNull();
    expect(result!.resolved[0].modelId).toBe('full-agent');
  });

  it('free-coding stays fail-closed under a costFilter=all override (lock)', () => {
    const candidates = [
      codeTied('paid-code', 'openai'),
      codeTied('free-code', 'openai'),
    ];
    candidates[0].pricingTier = 'paid';
    candidates[0].costPerInputToken = 0.01;
    candidates[0].costPerOutputToken = 0.02;
    const result = resolveMetaModel('free-coding', candidates, 'all');
    expect(result).not.toBeNull();
    expect(result!.resolved.map((c) => c.modelId)).toEqual(['free-code']);
  });
});
