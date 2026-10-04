import { describe, expect, it } from 'vitest';

import { buildDimension, buildVector, evaluateVector } from '../../services/quota/src/quota-vector.js';

const demand = { requests: 1, inputTokens: 70, outputTokens: 40, concurrency: 1 };
const nowMs = 10_000;

describe('quota-vector admission', () => {
  it('does not admit an empty capacity vector', () => {
    const vector = buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key', dimensions: [],
    });
    const snapshot = evaluateVector(vector, demand, nowMs);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.recommendation).toBe('failover');
    expect(snapshot.reason).toContain('No capacity');
  });

  it('blocks when aggregate token capacity is less than input plus output demand', () => {
    const vector = buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key', dimensions: [
        buildDimension({
          unit: 'total_tokens', scope: 'key', scopeId: 'key',
          limit: 100, remaining: 100, state: 'available',
          observedAtMs: nowMs, staleAfterMs: 100_000,
        }),
      ],
    });
    const snapshot = evaluateVector(vector, demand, nowMs);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.blockingDimensions.map((dimension) => dimension.unit)).toContain('total_tokens');
  });

  it('reports a known reset when available state lacks headroom', () => {
    const resetAtMs = nowMs + 2_000;
    const vector = buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key', dimensions: [
        buildDimension({ unit: 'requests', scope: 'key', scopeId: 'key',
          limit: 1, remaining: 0, state: 'available', resetAtMs,
          observedAtMs: nowMs, staleAfterMs: 100_000 }),
      ],
    });
    const snapshot = evaluateVector(vector, demand, nowMs);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.retryAtMs).toBe(resetAtMs);
    expect(snapshot.recommendation).toBe('wait');
  });

  it('waits for the last known reset when multiple dimensions block', () => {
    const resetAtMs = nowMs + 5_000;
    const vector = buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key', dimensions: [
        buildDimension({ unit: 'requests', scope: 'key', scopeId: 'key',
          limit: 1, remaining: 0, state: 'available', resetAtMs: nowMs + 1_000,
          observedAtMs: nowMs, staleAfterMs: 100_000 }),
        buildDimension({ unit: 'total_tokens', scope: 'key', scopeId: 'key',
          limit: 100, remaining: 0, state: 'available', resetAtMs,
          observedAtMs: nowMs, staleAfterMs: 100_000 }),
      ],
    });
    const snapshot = evaluateVector(vector, demand, nowMs);
    expect(snapshot.retryAtMs).toBe(resetAtMs);
    expect(snapshot.recommendation).toBe('wait');
  });

  it('does not claim a retry time when another blocking limit has no reset', () => {
    const vector = buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key', dimensions: [
        buildDimension({ unit: 'requests', scope: 'key', scopeId: 'key',
          limit: 1, remaining: 0, state: 'available', resetAtMs: nowMs + 1_000,
          observedAtMs: nowMs, staleAfterMs: 100_000 }),
        buildDimension({ unit: 'total_tokens', scope: 'key', scopeId: 'key',
          limit: 100, remaining: 0, state: 'exhausted',
          observedAtMs: nowMs, staleAfterMs: 100_000 }),
      ],
    });
    const snapshot = evaluateVector(vector, demand, nowMs);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.retryAtMs).toBeNull();
    expect(snapshot.recommendation).toBe('failover');
  });
});
