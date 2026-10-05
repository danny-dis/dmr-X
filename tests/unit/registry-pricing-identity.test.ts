import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock ONLY the DB boundary. Preserve every other @dmr-x/db export
// (createNamespacedCache, cache, ...) so the real RegistryService mapping
// code under test is exercised, not a stub of it.
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

const FREE_UUID = '11111111-1111-4111-8111-111111111111';
const PAID_UUID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_UUID = '33333333-3333-4333-8333-333333333333';

// Catalog slugs (PROVIDER_CATALOG ids), NOT database UUIDs.
const FREE_PROVIDER = 'mistral';
const FREE_MODEL = 'mistral-large-latest'; // freeTier.monthlyTokenBudget > 0 => 'free'
const PAID_PROVIDER = 'openai';
const PAID_MODEL = 'gpt-4o'; // costs > 0, no freeTier => 'paid'

function makeRow(providerId: string, providerName: string, modelId: string): any {
  return {
    providerId,
    providerName,
    modelId,
    modality: 'llm',
    intelligenceLayer: null,
    capabilityTier: null,
    isHealthy: 1,
    authMethod: 'bearer',
    qualityScore: '0.7',
    eloRating: null,
    avgLatencyMs: 500,
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
  };
}

describe('registry pricing identity (DB UUID vs catalog slug)', () => {
  beforeEach(() => {
    mockState.rows = [];
    delete process.env.DMRX_PROVIDER_ALLOWLIST;
  });

  it('classifies a known-free catalog binding as free even though the DB id is a UUID', () => {
    mockState.rows = [makeRow(FREE_UUID, FREE_PROVIDER, FREE_MODEL)];
    const candidates = new RegistryService().getCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].pricingTier).toBe('free');
  });

  it('preserves the database UUID for adapter dispatch on a free binding', () => {
    mockState.rows = [makeRow(FREE_UUID, FREE_PROVIDER, FREE_MODEL)];
    const candidates = new RegistryService().getCandidates();
    expect(candidates[0].providerId).toBe(FREE_UUID);
    expect(candidates[0].providerName).toBe(FREE_PROVIDER);
  });

  it('keeps a known-paid catalog binding paid', () => {
    mockState.rows = [makeRow(PAID_UUID, PAID_PROVIDER, PAID_MODEL)];
    const candidates = new RegistryService().getCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].pricingTier).toBe('paid');
    expect(candidates[0].providerId).toBe(PAID_UUID);
  });

  it('keeps an unknown provider/model binding unknown', () => {
    mockState.rows = [makeRow(UNKNOWN_UUID, 'no-such-provider', 'no-such-model')];
    const candidates = new RegistryService().getCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].pricingTier).toBe('unknown');
    expect(candidates[0].providerId).toBe(UNKNOWN_UUID);
  });
});
