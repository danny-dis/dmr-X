import { describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  inserts: [] as unknown[][],
  prepare(sql: string) {
    return {
      get: () => ({ total: 0 }),
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO capacity_reservations')) mockDb.inserts.push(args);
        return { changes: 1 };
      },
    };
  },
  transaction(fn: () => void) { return fn(); },
}));
vi.mock('@dmr-x/db', () => ({ getDb: () => mockDb }));

import { SQLiteCapacityStore, RedisCapacityStore } from '../../services/quota/src/capacity-store-distributed.js';

const dimension = { unit: 'requests' as const, scopeId: 'free-key', amount: 1, currentRemaining: 1 };

describe('distributed capacity reservation identity', () => {
  it('uses the manager ID for every SQLite reservation row', async () => {
    mockDb.inserts.length = 0;
    const result = await new SQLiteCapacityStore().tryReserve([dimension], 'reservation-123');
    expect(result).not.toBeNull();
    expect(mockDb.inserts).toHaveLength(1);
    expect(mockDb.inserts[0][0]).toBe('reservation-123');
  });

  it('uses the manager ID for its Redis reservation record', async () => {
    const records: Array<{ key: string; value: string }> = [];
    const store = new RedisCapacityStore();
    (store as unknown as { getClient: () => Promise<unknown> }).getClient = async () => ({
      eval: async () => [0],
      set: async (key: string, value: string) => { records.push({ key, value }); },
    });
    const result = await store.tryReserve([dimension], 'reservation-456');
    expect(result).not.toBeNull();
    expect(records).toHaveLength(1);
    expect(records[0].key).toBe('dmrx:capacity:reservation:reservation-456');
    expect(JSON.parse(records[0].value).id).toBe('reservation-456');
  });
});
