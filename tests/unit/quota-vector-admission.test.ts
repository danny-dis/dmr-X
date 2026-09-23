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
});
