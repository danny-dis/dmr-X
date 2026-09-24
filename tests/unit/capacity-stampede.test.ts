/**
 * Mirror of the top-level stampede test for the vitest unit project
 * (which only includes the unit test glob). See that file for docs.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryCapacityStore } from '../../services/quota/src/capacity-manager.js';

describe('capacity stampede (multi-instance)', () => {
  it('shared store: only one of two concurrent tryReserve(1 of 1) succeeds', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'free-bucket', remaining: 1 },
    ]);

    const dims = () => [
      { unit: 'requests' as const, scopeId: 'free-bucket', amount: 1, currentRemaining: 1 },
    ];

    const [a, b] = await Promise.all([store.tryReserve(dims()), store.tryReserve(dims())]);

    const succeeded = [a, b].filter((r) => r !== null).length;
    expect(succeeded).toBe(1);
    expect(store.getRemaining('requests', 'free-bucket')).toBe(0);
  });

  it('shared store: N racers cannot oversubscribe a 5-slot bucket', async () => {
    const store = new InMemoryCapacityStore([
      { unit: 'concurrency', scopeId: 'key-1', remaining: 5 },
    ]);

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.tryReserve([
          { unit: 'concurrency', scopeId: 'key-1', amount: 1, currentRemaining: 5 },
        ]),
      ),
    );

    expect(attempts.filter((r) => r !== null)).toHaveLength(5);
    expect(attempts.filter((r) => r === null)).toHaveLength(15);
  });

  it('documents isolation caveat: two separate stores cannot coordinate (use shared store in prod)', async () => {
    const gatewayA = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'free-bucket', remaining: 1 },
    ]);
    const gatewayB = new InMemoryCapacityStore([
      { unit: 'requests', scopeId: 'free-bucket', remaining: 1 },
    ]);

    const dims = () => [
      { unit: 'requests' as const, scopeId: 'free-bucket', amount: 1, currentRemaining: 1 },
    ];

    const [a, b] = await Promise.all([gatewayA.tryReserve(dims()), gatewayB.tryReserve(dims())]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
