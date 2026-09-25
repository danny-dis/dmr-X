import { describe, expect, it } from 'vitest';

import { CapacityManager, type CapacityStore } from '../../services/quota/src/capacity-manager.js';
import { buildDimension, buildVector } from '../../services/quota/src/quota-vector.js';

describe('capacity reservation identity', () => {
  it('passes the stored reservation id to the atomic store operation', async () => {
    let storedId: string | undefined;
    const store: CapacityStore = {
      tryReserve: async (dimensions, reservationId?: string) => {
        storedId = reservationId;
        return dimensions.map(d => ({ unit: d.unit, scopeId: d.scopeId, newRemaining: 1 }));
      },
      release: async () => {},
      commit: async () => {},
      expireLeases: async () => 0,
    };
    const manager = new CapacityManager({ store });
    manager.registerVector(buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key',
      dimensions: [buildDimension({
        unit: 'requests', scope: 'key', scopeId: 'key', limit: 2,
        remaining: 2, state: 'available',
      })],
    }));

    const result = await manager.reserve('provider', 'model', 'key', {
      requests: 1, inputTokens: 0, outputTokens: 0, concurrency: 0,
    });
    expect(result.success).toBe(true);
    expect(storedId).toBe(result.reservation?.id);
  });

  it('uses a cryptographically random reservation ID', async () => {
    const store: CapacityStore = {
      tryReserve: async dimensions => dimensions.map(d => ({ unit: d.unit, scopeId: d.scopeId, newRemaining: 1 })),
      release: async () => {},
      commit: async () => {},
      expireLeases: async () => 0,
    };
    const manager = new CapacityManager({ store });
    manager.registerVector(buildVector({
      providerId: 'provider', modelId: 'model', keyId: 'key',
      dimensions: [buildDimension({ unit: 'requests', scope: 'key', scopeId: 'key', limit: 2, remaining: 2, state: 'available' })],
    }));
    const result = await manager.reserve('provider', 'model', 'key', {});
    expect(result.reservation?.id).toMatch(/^res-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
