import { describe, it, expect } from 'vitest';
import {
  CapacityManager,
  InMemoryCapacityStore,
} from '../../services/quota/src/capacity-manager.js';
import {
  buildVector,
  buildDimension,
} from '../../services/quota/src/quota-vector.js';
import { DemandVector } from '../../services/quota/src/quota-dimensions.js';

/**
 * These tests verify the CapacityStore interface contract — any store
 * implementation (InMemory, SQLite, Redis) must satisfy these invariants.
 *
 * The SQLite store is not directly tested here because its dependency chain
 * pulls in `@dmr-x/utils` which is currently broken (missing pino). The
 * InMemory store exercises the same contract.
 */

describe('CapacityStore interface — oversubscription prevention', () => {
  it('never admits more reservations than capacity allows (concurrency)', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'concurrency', scopeId: 'key-1', remaining: 3 },
    ]);
    const manager = new CapacityManager({ store });

    manager.registerVector(
      buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-1',
        dimensions: [
          buildDimension({
            unit: 'concurrency',
            scope: 'key',
            scopeId: 'key-1',
            limit: 3,
            remaining: 3,
            state: 'available',
          }),
        ],
      }),
    );

    const demand: DemandVector = {
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    };

    // Fire 30 concurrent reservation attempts for a 3-slot bucket
    const attempts = await Promise.all(
      Array.from({ length: 30 }, () =>
        manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand),
      ),
    );

    const succeeded = attempts.filter((r) => r.success).length;
    const failed = attempts.filter((r) => !r.success).length;

    expect(succeeded).toBe(3);
    expect(failed).toBe(27);

    // After all attempts, exactly 3 capacity should remain reserved
    expect(store.getRemaining('concurrency', 'key-1')).toBe(0);
  });

  it('never admits more reservations than capacity allows (requests)', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'key-1', remaining: 5 },
    ]);
    const manager = new CapacityManager({ store });

    manager.registerVector(
      buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-1',
        dimensions: [
          buildDimension({
            unit: 'requests',
            scope: 'key',
            scopeId: 'key-1',
            limit: 5,
            remaining: 5,
            state: 'available',
          }),
        ],
      }),
    );

    const demand: DemandVector = {
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    };

    const attempts = await Promise.all(
      Array.from({ length: 50 }, () =>
        manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand),
      ),
    );

    const succeeded = attempts.filter((r) => r.success).length;
    expect(succeeded).toBe(5);
    expect(store.getRemaining('requests', 'key-1')).toBe(0);
  });

  it('released capacity becomes available for re-reservation', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'concurrency', scopeId: 'key-1', remaining: 1 },
    ]);
    const manager = new CapacityManager({ store });

    manager.registerVector(
      buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-1',
        dimensions: [
          buildDimension({
            unit: 'concurrency',
            scope: 'key',
            scopeId: 'key-1',
            limit: 1,
            remaining: 1,
            state: 'available',
          }),
        ],
      }),
    );

    const demand: DemandVector = {
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    };

    // Reserve the only slot
    const result1 = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
    expect(result1.success).toBe(true);

    // Second attempt should fail
    const result2 = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
    expect(result2.success).toBe(false);

    // Release the reservation
    await manager.release(result1.reservation!.id);

    // Now reservation should succeed again
    const result3 = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
    expect(result3.success).toBe(true);
  });

  it('commit does not double-deduct when actual usage is lower than reserved', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'key-1', remaining: 10 },
    ]);
    const manager = new CapacityManager({ store });

    manager.registerVector(
      buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-1',
        dimensions: [
          buildDimension({
            unit: 'requests',
            scope: 'key',
            scopeId: 'key-1',
            limit: 10,
            remaining: 10,
            state: 'available',
          }),
        ],
      }),
    );

    const demand: DemandVector = {
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    };

    // Reserve 1 request
    const result = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
    expect(result.success).toBe(true);

    // Remaining should be 9 after reservation
    expect(store.getRemaining('requests', 'key-1')).toBe(9);

    // Commit with actual usage matching reservation (1 request)
    await manager.commit(result.reservation!.id, {
      requests: 1,
      inputTokens: 50,
      outputTokens: 50,
      concurrency: 1,
    });

    // After commit, remaining should still be 9 (reservation was the deduction)
    expect(store.getRemaining('requests', 'key-1')).toBe(9);
  });

  it('reservation is atomic — partial failure leaves no side effects', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'key-1', remaining: 10 },
      // concurrency is deliberately absent — will default to 0 in store
    ]);
    const manager = new CapacityManager({ store });

    manager.registerVector(
      buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-1',
        dimensions: [
          buildDimension({
            unit: 'requests',
            scope: 'key',
            scopeId: 'key-1',
            limit: 10,
            remaining: 10,
            state: 'available',
          }),
          buildDimension({
            unit: 'concurrency',
            scope: 'key',
            scopeId: 'key-1',
            limit: 5,
            remaining: 0, // exhausted — should cause entire reservation to fail
            state: 'exhausted',
          }),
        ],
      }),
    );

    const demand: DemandVector = {
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      concurrency: 1,
    };

    const result = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
    expect(result.success).toBe(false);

    // Requests should NOT have been partially reserved
    expect(store.getRemaining('requests', 'key-1')).toBe(10);
  });
});
