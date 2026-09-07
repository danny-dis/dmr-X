import { describe, it, expect } from 'vitest';
import {
  buildDimension,
  buildVector,
  evaluateVector,
  isStale,
  hasHeadroom,
  evaluateState,
  computeTokenBucketRemaining,
  type QuotaDimension,
  type DemandVector,
} from '../../services/quota/src/quota-vector.js';
import {
  QuotaScope,
  QuotaUnit,
  QuotaState,
  ReplenishmentModel,
} from '../../services/quota/src/quota-dimensions.js';

function minutesAgo(n: number): number {
  return Date.now() - n * 60_000;
}

function minutesFromNow(n: number): number {
  return Date.now() + n * 60_000;
}

describe('quota-dimensions', () => {
  describe('isStale', () => {
    it('returns false for a fresh dimension', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        observedAtMs: minutesAgo(1),
        staleAfterMs: 5 * 60_000,
      });
      expect(isStale(dim)).toBe(false);
    });

    it('returns true for an observation older than staleAfterMs', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        observedAtMs: minutesAgo(10),
        staleAfterMs: 5 * 60_000,
      });
      expect(isStale(dim)).toBe(true);
    });

    it('handles custom staleAfterMs', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        observedAtMs: minutesAgo(2),
        staleAfterMs: 60_000, // 1 minute
      });
      expect(isStale(dim)).toBe(true);
    });
  });

  describe('evaluateState', () => {
    it('returns stale when observation is past the freshness window', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        state: 'available',
        observedAtMs: minutesAgo(10),
        staleAfterMs: 5 * 60_000,
      });
      expect(evaluateState(dim)).toBe('stale');
    });

    it('does not downgrade cooling_down to stale', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 0,
        state: 'cooling_down',
        observedAtMs: minutesAgo(30),
        staleAfterMs: 5 * 60_000,
      });
      expect(evaluateState(dim)).toBe('cooling_down');
    });

    it('preserves unknown state', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: null,
        remaining: null,
        state: 'unknown',
        observedAtMs: minutesAgo(10),
      });
      expect(evaluateState(dim)).toBe('unknown');
    });
  });

  describe('hasHeadroom', () => {
    it('returns true when remaining >= amount', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 10,
        state: 'available',
      });
      expect(hasHeadroom(dim, 5)).toBe(true);
    });

    it('returns false when remaining < amount', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 3,
        state: 'available',
      });
      expect(hasHeadroom(dim, 5)).toBe(false);
    });

    it('returns false when state is not available', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        state: 'cooling_down',
      });
      expect(hasHeadroom(dim, 1)).toBe(false);
    });

    it('returns false when remaining is null', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: null,
        remaining: null,
        state: 'available',
      });
      expect(hasHeadroom(dim, 1)).toBe(false);
    });
  });

  describe('computeTokenBucketRemaining', () => {
    it('returns remaining for non-token_bucket replenishment', () => {
      const dim = buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        replenishment: 'fixed_window',
      });
      expect(computeTokenBucketRemaining(dim)).toBe(50);
    });

    it('computes refill for token_bucket', () => {
      const observed = minutesAgo(1); // observed 1 min ago
      const reset = minutesFromNow(4); // resets in 4 min (5-min window total)
      // refillRate = limit / window_duration
      const limit = 100;
      const remaining = 0; // exhausted at observation
      const dim: QuotaDimension = {
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit,
        remaining,
        replenishment: 'token_bucket',
        resetAtMs: reset,
        state: 'available',
        confidence: 1,
        observedAtMs: observed,
        staleAfterMs: 5 * 60_000,
      };
      // After 1 minute of refill at 100/300 per sec... should be > 0
      const result = computeTokenBucketRemaining(dim);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });
  });
});

describe('quota-vector builder', () => {
  it('builds a vector with dimensions', () => {
    const vector = buildVector({
      providerId: 'groq',
      modelId: 'llama-3.1-70b',
      keyId: 'key-1',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-1',
          limit: 1000,
          remaining: 500,
          state: 'available',
        }),
        buildDimension({
          unit: 'input_tokens',
          scope: 'model',
          scopeId: 'llama-3.1-70b',
          limit: 100_000,
          remaining: 50_000,
          state: 'available',
        }),
      ],
    });
    expect(vector.dimensions).toHaveLength(2);
    expect(vector.lastObservedAtMs).toBeGreaterThan(0);
  });
});

describe('evaluateVector — admissibility', () => {
  function makeVector(overrides: Partial<ReturnType<typeof buildDimension>> = {}) {
    return buildVector({
      providerId: 'groq',
      modelId: 'llama-3.1-70b',
      keyId: 'key-1',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-1',
          limit: 1000,
          remaining: 500,
          state: 'available',
          ...overrides,
        }),
        buildDimension({
          unit: 'input_tokens',
          scope: 'model',
          scopeId: 'llama-3.1-70b',
          limit: 100_000,
          remaining: 50_000,
          state: 'available',
        }),
      ],
    });
  }

  it('returns admissible when all dimensions have headroom', () => {
    const vector = makeVector();
    const demand: DemandVector = { requests: 1, inputTokens: 1000, outputTokens: 500, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(true);
    expect(snapshot.recommendation).toBe('route');
    expect(snapshot.blockingDimensions).toHaveLength(0);
  });

  it('blocks when request dimension is exhausted', () => {
    const vector = makeVector({ remaining: 0, state: 'exhausted' });
    const demand: DemandVector = { requests: 1, inputTokens: 100, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.blockingDimensions).toHaveLength(1);
    expect(snapshot.blockingDimensions[0].unit).toBe('requests');
    expect(snapshot.recommendation).toBe('failover');
  });

  it('blocks when remaining is below demand', () => {
    const vector = makeVector();
    // Override the input_tokens dimension to have low remaining
    vector.dimensions[1] = buildDimension({
      unit: 'input_tokens',
      scope: 'model',
      scopeId: 'llama-3.1-70b',
      limit: 100_000,
      remaining: 50,
      state: 'available',
    });
    const demand: DemandVector = { requests: 1, inputTokens: 1000, outputTokens: 500, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.reason).toContain('input_tokens');
  });

  it('does not treat unknown as available (free_only safety)', () => {
    const vector = makeVector({ remaining: null, limit: null, state: 'unknown' });
    const demand: DemandVector = { requests: 1, inputTokens: 100, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.blockingDimensions[0].state).toBe('unknown');
  });

  it('does not treat stale as available', () => {
    const vector = buildVector({
      providerId: 'groq',
      modelId: 'llama-3.1-70b',
      keyId: 'key-1',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-1',
          limit: 1000,
          remaining: 500,
          state: 'available',
          observedAtMs: minutesAgo(10),
          staleAfterMs: 5 * 60_000,
        }),
      ],
    });
    const demand: DemandVector = { requests: 1, inputTokens: 100, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(false);
    expect(snapshot.blockingDimensions[0].state).toBe('stale');
  });

  it('derives retryAtMs from resetAtMs', () => {
    const resetAt = minutesFromNow(5);
    const vector = buildVector({
      providerId: 'groq',
      modelId: 'llama-3.1-70b',
      keyId: 'key-1',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-1',
          limit: 1000,
          remaining: 0,
          state: 'exhausted',
          resetAtMs: resetAt,
        }),
      ],
    });
    const demand: DemandVector = { requests: 1, inputTokens: 100, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.retryAtMs).toBe(resetAt);
  });

  it('provides a human-readable reason', () => {
    const vector = makeVector({ remaining: 0, state: 'exhausted' });
    const demand: DemandVector = { requests: 1, inputTokens: 100, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.reason).toContain('exhausted');
    expect(snapshot.reason).toContain('key-1');
  });
});

describe('evaluateVector — multi-dimension', () => {
  it('blocks when any one of multiple dimensions is exhausted', () => {
    const vector = buildVector({
      providerId: 'gemini',
      modelId: 'gemini-2.0-flash',
      keyId: 'key-2',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-2',
          limit: 1500,
          remaining: 1000,
          state: 'available',
        }),
        buildDimension({
          unit: 'input_tokens',
          scope: 'model',
          scopeId: 'gemini-2.0-flash',
          limit: 1_000_000,
          remaining: 500,
          state: 'available',
        }),
        buildDimension({
          unit: 'concurrency',
          scope: 'key',
          scopeId: 'key-2',
          limit: 10,
          remaining: 0,
          state: 'exhausted',
        }),
      ],
    });
    const demand: DemandVector = { requests: 1, inputTokens: 1000, outputTokens: 500, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(false);
    // Concurrency is the blocker
    expect(snapshot.blockingDimensions.some(d => d.unit === 'concurrency')).toBe(true);
  });

  it('includes estimatedRemaining as the smallest headroom', () => {
    const vector = buildVector({
      providerId: 'gemini',
      modelId: 'gemini-2.0-flash',
      keyId: 'key-2',
      dimensions: [
        buildDimension({
          unit: 'requests',
          scope: 'key',
          scopeId: 'key-2',
          limit: 1500,
          remaining: 100,
          state: 'available',
        }),
        buildDimension({
          unit: 'input_tokens',
          scope: 'model',
          scopeId: 'gemini-2.0-flash',
          limit: 1_000_000,
          remaining: 50_000,
          state: 'available',
        }),
      ],
    });
    const demand: DemandVector = { requests: 1, inputTokens: 500, outputTokens: 100, concurrency: 1 };
    const snapshot = evaluateVector(vector, demand);
    expect(snapshot.admissible).toBe(true);
    // requests: 100 - 1 = 99; input_tokens: 50000 - 500 = 49500
    expect(snapshot.estimatedRemaining).toBe(99);
  });
});
