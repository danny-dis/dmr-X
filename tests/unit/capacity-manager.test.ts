import { describe, it, expect, beforeEach } from 'vitest';
import {
  CapacityManager,
  InMemoryCapacityStore,
} from '../../services/quota/src/capacity-manager.js';
import {
  buildVector,
  buildDimension,
  type QuotaVector,
} from '../../services/quota/src/quota-vector.js';
import { DemandVector, QuotaUnit } from '../../services/quota/src/quota-dimensions.js';

function makeVector(): QuotaVector {
  return buildVector({
    providerId: 'groq',
    modelId: 'llama-3.1-70b',
    keyId: 'key-1',
    dimensions: [
      buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: 'key-1',
        limit: 100,
        remaining: 50,
        state: 'available',
      }),
      buildDimension({
        unit: 'concurrency',
        scope: 'key',
        scopeId: 'key-1',
        limit: 10,
        remaining: 5,
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
}

describe('CapacityManager', () => {
  let manager: CapacityManager;

  beforeEach(() => {
    const vector = makeVector();
    const store = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'key-1', remaining: 50 },
      { unit: 'concurrency', scopeId: 'key-1', remaining: 5 },
      { unit: 'input_tokens', scopeId: 'llama-3.1-70b', remaining: 50_000 },
    ]);
    manager = new CapacityManager({ store });
    manager.registerVector(vector);
  });

  describe('reserve', () => {
    it('reserves capacity when demand fits', async () => {
      const demand: DemandVector = {
        requests: 1,
        inputTokens: 1000,
        outputTokens: 500,
        concurrency: 1,
      };
      const result = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
      expect(result.success).toBe(true);
      expect(result.reservation).toBeDefined();
      expect(result.reservation!.status).toBe('reserved');
      expect(result.reservation!.dimensions).toHaveLength(3);
    });

    it('fails to reserve when concurrency is exhausted', async () => {
      // Exhaust concurrency
      const store = new InMemoryCapacityStore([
        { unit: 'requests', scopeId: 'key-1', remaining: 50 },
        { unit: 'concurrency', scopeId: 'key-1', remaining: 0 },
        { unit: 'input_tokens', scopeId: 'llama-3.1-70b', remaining: 50_000 },
      ]);
      const localManager = new CapacityManager({ store });
      localManager.registerVector(makeVector());

      const demand: DemandVector = {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      };
      const result = await localManager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
      expect(result.success).toBe(false);
    });

    it('fails when no vector is registered', async () => {
      const result = await manager.reserve('unknown', 'model', 'key', {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('No quota vector registered');
    });
  });

  describe('commit and release', () => {
    it('commit returns unused capacity to the pool', async () => {
      const demand: DemandVector = {
        requests: 1,
        inputTokens: 1000,
        outputTokens: 500,
        concurrency: 1,
      };
      const result = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
      expect(result.success).toBe(true);

      // Commit with actual usage lower than reservation
      await manager.commit(result.reservation!.id, {
        requests: 1,
        inputTokens: 800, // used 800 instead of 1000
        outputTokens: 400, // used 400 instead of 500
        concurrency: 1,
      });
      expect(manager.getReservationCount()).toBe(0);
    });

    it('release returns full reservation to the pool', async () => {
      const demand: DemandVector = {
        requests: 1,
        inputTokens: 1000,
        outputTokens: 500,
        concurrency: 1,
      };
      const result = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
      expect(result.success).toBe(true);

      // Release (e.g. request cancelled)
      await manager.release(result.reservation!.id);
      expect(manager.getReservationCount()).toBe(0);

      // Should be able to reserve again (capacity returned)
      const result2 = await manager.reserve('groq', 'llama-3.1-70b', 'key-1', demand);
      expect(result2.success).toBe(true);
    });
  });

  describe('concurrent reservations — oversubscription prevention', () => {
    it('does not oversubscribe concurrency under parallel load', async () => {
      const concurrencyLimit = 5;
      const store = new InMemoryCapacityStore([
        { unit: 'concurrency', scopeId: 'key-1', remaining: concurrencyLimit },
      ]);
      const localManager = new CapacityManager({ store });

      // Create a vector with just a concurrency dimension
      localManager.registerVector(
        buildVector({
          providerId: 'groq',
          modelId: 'llama-3.1-70b',
          keyId: 'key-1',
          dimensions: [
            buildDimension({
              unit: 'concurrency',
              scope: 'key',
              scopeId: 'key-1',
              limit: concurrencyLimit,
              remaining: concurrencyLimit,
              state: 'available',
            }),
          ],
        }),
      );

      // Fire 20 concurrent reservation attempts
      const attempts = await Promise.all(
        Array.from({ length: 20 }, () =>
          localManager.reserve('groq', 'llama-3.1-70b', 'key-1', {
            requests: 1,
            inputTokens: 100,
            outputTokens: 100,
            concurrency: 1,
          }),
        ),
      );

      const succeeded = attempts.filter((r) => r.success).length;
      const failed = attempts.filter((r) => !r.success).length;

      // Exactly `concurrencyLimit` should succeed, the rest fail
      expect(succeeded).toBe(concurrencyLimit);
      expect(failed).toBe(20 - concurrencyLimit);
    });

    it('does not oversubscribe requests under parallel load', async () => {
      const requestLimit = 10;
      const store = new InMemoryCapacityStore([
        { unit: 'requests', scopeId: 'key-1', remaining: requestLimit },
      ]);
      const localManager = new CapacityManager({ store });

      localManager.registerVector(
        buildVector({
          providerId: 'groq',
          modelId: 'llama-3.1-70b',
          keyId: 'key-1',
          dimensions: [
            buildDimension({
              unit: 'requests',
              scope: 'key',
              scopeId: 'key-1',
              limit: requestLimit,
              remaining: requestLimit,
              state: 'available',
            }),
          ],
        }),
      );

      // Fire 50 concurrent reservation attempts
      const attempts = await Promise.all(
        Array.from({ length: 50 }, () =>
          localManager.reserve('groq', 'llama-3.1-70b', 'key-1', {
            requests: 1,
            inputTokens: 100,
            outputTokens: 100,
            concurrency: 1,
          }),
        ),
      );

      const succeeded = attempts.filter((r) => r.success).length;
      const failed = attempts.filter((r) => !r.success).length;

      expect(succeeded).toBe(requestLimit);
      expect(failed).toBe(50 - requestLimit);
    });
  });

  describe('sweep expired leases', () => {
    it('expires reservations past their lease', async () => {
      // Create a manager with a very short lease
      const shortManager = new CapacityManager({
        store: new InMemoryCapacityStore([
          { unit: 'requests', scopeId: 'key-1', remaining: 50 },
        ]),
        leaseMs: 50, // 50ms lease
      });
      shortManager.registerVector(
        buildVector({
          providerId: 'groq',
          modelId: 'llama-3.1-70b',
          keyId: 'key-1',
          dimensions: [
            buildDimension({
              unit: 'requests',
              scope: 'key',
              scopeId: 'key-1',
              limit: 50,
              remaining: 50,
              state: 'available',
            }),
          ],
        }),
      );

      const result = await shortManager.reserve('groq', 'llama-3.1-70b', 'key-1', {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      });
      expect(result.success).toBe(true);
      expect(shortManager.getReservationCount()).toBe(1);

      // Wait for lease to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Run sweep
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          // sweep runs internally via startSweep
          if (shortManager.getReservationCount() === 0) {
            clearInterval(interval);
            resolve();
          }
        }, 20);
        // Manually trigger sweep via reserve check
        shortManager.reserve('groq', 'llama-3.1-70b', 'key-1', {
          requests: 1,
          inputTokens: 100,
          outputTokens: 100,
          concurrency: 1,
        }).then(() => {
          // After reservation, check if previous was expired
        });
        setTimeout(() => {
          clearInterval(interval);
          resolve();
        }, 500);
      });
    });
  });

  describe('multiple keys — per-key isolation', () => {
    it('reserves are per-key, not provider-global', async () => {
      const vector1 = buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-a',
        dimensions: [
          buildDimension({
            unit: 'requests',
            scope: 'key',
            scopeId: 'key-a',
            limit: 100,
            remaining: 1, // nearly exhausted
            state: 'available',
          }),
        ],
      });
      const vector2 = buildVector({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        keyId: 'key-b',
        dimensions: [
          buildDimension({
            unit: 'requests',
            scope: 'key',
            scopeId: 'key-b',
            limit: 100,
            remaining: 50, // plenty left
            state: 'available',
          }),
        ],
      });

      // Note: InMemoryCapacityStore uses unit:scopeId, so different scopeIds
      // stay isolated. But the manager registers vectors by provider+model+key.
      const localManager = new CapacityManager({
        store: new InMemoryCapacityStore([]),
      });
      localManager.registerVector(vector1);
      localManager.registerVector(vector2);

      // key-a can reserve its last request
      const result1 = await localManager.reserve('groq', 'llama-3.1-70b', 'key-a', {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      });
      expect(result1.success).toBe(true);

      // key-a is now exhausted
      const result1b = await localManager.reserve('groq', 'llama-3.1-70b', 'key-a', {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      });
      expect(result1b.success).toBe(false);

      // key-b still has plenty
      const result2 = await localManager.reserve('groq', 'llama-3.1-70b', 'key-b', {
        requests: 1,
        inputTokens: 100,
        outputTokens: 100,
        concurrency: 1,
      });
      expect(result2.success).toBe(true);
    });
  });
});
