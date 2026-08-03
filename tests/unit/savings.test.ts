import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { computeSavings } from '../../apps/gateway/src/services/savings.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-savings-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // first run
  }
  await initDb();
});

afterEach(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function addProvider(id: string, name: string) {
  getDb()
    .prepare('INSERT INTO providers (id, name, adapter_type) VALUES (?, ?, ?)')
    .run(id, name, 'generic-openai');
}

function addModel(opts: {
  providerId: string;
  modelId: string;
  displayName?: string;
  capabilityTier?: string | null;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO model_profiles
         (id, provider_id, model_id, display_name, modality, capability_tier, input_cost_per_1k, output_cost_per_1k)
       VALUES (?, ?, ?, ?, 'text', ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.providerId,
      opts.modelId,
      opts.displayName ?? opts.modelId,
      opts.capabilityTier ?? null,
      opts.inputCostPer1k ?? 0,
      opts.outputCostPer1k ?? 0,
    );
}

function classify(providerId: string, modelId: string, pricingTier: string, hasFreeTier = 0, verifiedFree = 0) {
  getDb()
    .prepare(
      `INSERT INTO model_classifications (provider_id, model_id, pricingTier, has_free_tier, verified_free)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(providerId, modelId, pricingTier, hasFreeTier, verifiedFree);
}

function logRequest(opts: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  daysAgo?: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO request_logs
         (id, request_id, tenant_id, timestamp, selected_provider, selected_model,
          tokens_input, tokens_output, estimated_cost, latency_ms)
       VALUES (?, ?, 'tenant-1', datetime('now', ?), ?, ?, ?, ?, ?, 100)`,
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID(),
      `-${opts.daysAgo ?? 0} days`,
      opts.providerId,
      opts.modelId,
      opts.inputTokens,
      opts.outputTokens,
      opts.cost ?? 0,
    );
}

describe('computeSavings — the counterfactual', () => {
  it('prices free tokens against the cheapest paid model in the same tier', () => {
    addProvider('p-free', 'Groq');
    addProvider('p-paid', 'OpenAI');

    addModel({ providerId: 'p-free', modelId: 'llama-free', capabilityTier: 'worker' });
    classify('p-free', 'llama-free', 'free', 1);

    // Two paid options in the same tier; the cheaper one must win so the
    // figure stays conservative.
    addModel({ providerId: 'p-paid', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 0.1, outputCostPer1k: 0.2 });
    addModel({ providerId: 'p-paid', modelId: 'pricey', capabilityTier: 'worker', inputCostPer1k: 5, outputCostPer1k: 10 });
    classify('p-paid', 'cheap', 'paid');
    classify('p-paid', 'pricey', 'paid');

    logRequest({ providerId: 'p-free', modelId: 'llama-free', inputTokens: 10_000, outputTokens: 5_000 });

    const result = computeSavings(30);

    // 10k/1k * 0.1 + 5k/1k * 0.2 = 1.0 + 1.0 = 2.0
    expect(result.costAvoidedUsd).toBeCloseTo(2.0);
    expect(result.freeTokens).toBe(15_000);
    expect(result.freeRequests).toBe(1);
    expect(result.byModel[0].referenceModel).toBe('cheap');
  });

  it('EXCLUDES an unpriced paid model — zero cost is not proof of free', () => {
    addProvider('p-paid', 'MysteryCo');
    addProvider('p-ref', 'OpenAI');

    // The trap: input_cost_per_1k is NOT NULL DEFAULT 0, so an unpriced paid
    // model is indistinguishable from a free one at the column level and its
    // requests log estimated_cost = 0. Counting it would invent savings from
    // a model the user is actually billed for.
    addModel({ providerId: 'p-paid', modelId: 'unpriced', capabilityTier: 'worker' });
    classify('p-paid', 'unpriced', 'paid');

    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-ref', 'cheap', 'paid');

    logRequest({ providerId: 'p-paid', modelId: 'unpriced', inputTokens: 100_000, outputTokens: 100_000 });

    const result = computeSavings(30);

    expect(result.costAvoidedUsd).toBe(0);
    expect(result.freeRequests).toBe(0);
  });

  it('counts a runtime-verified free model even when the catalog tier says otherwise', () => {
    addProvider('p-free', 'Cerebras');
    addProvider('p-ref', 'OpenAI');

    addModel({ providerId: 'p-free', modelId: 'surprise-free', capabilityTier: 'worker' });
    // pricingTier is stale, but a runtime probe proved it free.
    classify('p-free', 'surprise-free', 'unknown', 0, 1);

    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-ref', 'cheap', 'paid');

    logRequest({ providerId: 'p-free', modelId: 'surprise-free', inputTokens: 1000, outputTokens: 1000 });

    const result = computeSavings(30);

    expect(result.costAvoidedUsd).toBeCloseTo(2);
  });

  it('never uses a free model as its own reference price', () => {
    addProvider('p-free', 'Groq');

    addModel({ providerId: 'p-free', modelId: 'llama-free', capabilityTier: 'worker' });
    classify('p-free', 'llama-free', 'free', 1);

    logRequest({ providerId: 'p-free', modelId: 'llama-free', inputTokens: 10_000, outputTokens: 10_000 });

    const result = computeSavings(30);

    // No paid model configured at all, so there is nothing honest to compare
    // against. Report zero and say why rather than inventing a number.
    expect(result.costAvoidedUsd).toBe(0);
    expect(result.basis.warning).toContain('No paid model');
  });

  it('falls back to the cheapest paid model overall when the tier has no paid member', () => {
    addProvider('p-free', 'Groq');
    addProvider('p-ref', 'OpenAI');

    addModel({ providerId: 'p-free', modelId: 'llama-free', capabilityTier: 'brain' });
    classify('p-free', 'llama-free', 'free', 1);

    // Only a 'worker'-tier paid model exists; the free model is 'brain'.
    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 0.5, outputCostPer1k: 0.5 });
    classify('p-ref', 'cheap', 'paid');

    logRequest({ providerId: 'p-free', modelId: 'llama-free', inputTokens: 2000, outputTokens: 2000 });

    const result = computeSavings(30);

    expect(result.costAvoidedUsd).toBeCloseTo(2);
    expect(result.basis.referenceModels.length).toBeGreaterThan(0);
  });

  it('honours the day window', () => {
    addProvider('p-free', 'Groq');
    addProvider('p-ref', 'OpenAI');

    addModel({ providerId: 'p-free', modelId: 'llama-free', capabilityTier: 'worker' });
    classify('p-free', 'llama-free', 'free', 1);
    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-ref', 'cheap', 'paid');

    logRequest({ providerId: 'p-free', modelId: 'llama-free', inputTokens: 1000, outputTokens: 0, daysAgo: 45 });

    expect(computeSavings(30).costAvoidedUsd).toBe(0);
    expect(computeSavings(90).costAvoidedUsd).toBeCloseTo(1);
  });

  it('does not count a paid request that actually cost money', () => {
    addProvider('p-paid', 'OpenAI');

    addModel({ providerId: 'p-paid', modelId: 'gpt', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-paid', 'gpt', 'paid');

    logRequest({ providerId: 'p-paid', modelId: 'gpt', inputTokens: 1000, outputTokens: 1000, cost: 2 });

    const result = computeSavings(30);

    expect(result.costAvoidedUsd).toBe(0);
    expect(result.freeRequests).toBe(0);
  });

  it('always reports the basis so the number is never unexplained', () => {
    addProvider('p-free', 'Groq');
    addProvider('p-ref', 'OpenAI');
    addModel({ providerId: 'p-free', modelId: 'f', capabilityTier: 'worker' });
    classify('p-free', 'f', 'free', 1);
    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 2 });
    classify('p-ref', 'cheap', 'paid');
    logRequest({ providerId: 'p-free', modelId: 'f', inputTokens: 1000, outputTokens: 1000 });

    const { basis } = computeSavings(30);

    expect(basis.method).toContain('cheapest paid model');
    expect(basis.referenceModels).toEqual([
      { capabilityTier: 'worker', model: 'cheap', inputCostPer1k: 1, outputCostPer1k: 2 },
    ]);
    expect(basis.warning).toBeNull();
  });

  it('aggregates by provider and by model', () => {
    addProvider('p-a', 'Groq');
    addProvider('p-b', 'Cerebras');
    addProvider('p-ref', 'OpenAI');

    for (const [pid, mid] of [['p-a', 'm1'], ['p-a', 'm2'], ['p-b', 'm3']] as const) {
      addModel({ providerId: pid, modelId: mid, capabilityTier: 'worker' });
      classify(pid, mid, 'free', 1);
      logRequest({ providerId: pid, modelId: mid, inputTokens: 1000, outputTokens: 0 });
    }

    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-ref', 'cheap', 'paid');

    const result = computeSavings(30);

    expect(result.byModel).toHaveLength(3);
    expect(result.byProvider).toHaveLength(2);
    // p-a has two models at $1 each; p-b has one.
    const groq = result.byProvider.find((p) => p.providerName === 'Groq')!;
    expect(groq.costAvoidedUsd).toBeCloseTo(2);
    expect(groq.requests).toBe(2);
  });

  it('produces a daily series for charting', () => {
    addProvider('p-free', 'Groq');
    addProvider('p-ref', 'OpenAI');
    addModel({ providerId: 'p-free', modelId: 'f', capabilityTier: 'worker' });
    classify('p-free', 'f', 'free', 1);
    addModel({ providerId: 'p-ref', modelId: 'cheap', capabilityTier: 'worker', inputCostPer1k: 1, outputCostPer1k: 1 });
    classify('p-ref', 'cheap', 'paid');

    logRequest({ providerId: 'p-free', modelId: 'f', inputTokens: 1000, outputTokens: 0, daysAgo: 0 });
    logRequest({ providerId: 'p-free', modelId: 'f', inputTokens: 2000, outputTokens: 0, daysAgo: 2 });

    const result = computeSavings(30);

    expect(result.daily).toHaveLength(2);
    expect(result.daily.reduce((s, d) => s + d.tokens, 0)).toBe(3000);
  });

  it('returns zero for an empty database rather than throwing', () => {
    const result = computeSavings(30);

    expect(result.costAvoidedUsd).toBe(0);
    expect(result.freeTokens).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.daily).toEqual([]);
  });
});
