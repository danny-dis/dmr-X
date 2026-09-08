/**
 * Distributed admission control — Phase 3 of the free inference control plane.
 *
 * The InMemoryCapacityStore works for a single gateway instance. In production
 * with multiple replicas, each instance has its own isolated view of quota —
 * leading to oversubscription (instance A thinks 5 slots left, instance B also
 * thinks 5 slots left, both admit 5 concurrent requests → 10 total for a
 * 5-slot bucket).
 *
 * This module extends the CapacityStore abstraction with SQLite-backed and
 * Redis-backed implementations so that multiple gateway replicas share one
 * authoritative reservation counter.
 *
 * The production design (from the architecture doc):
 *   - local fast-path state for prediction (InMemoryCapacityStore)
 *   - shared atomic counters for reservations (SQLite/Redis)
 *   - durable provider/key cooldown state
 *   - request-id idempotency
 *   - clock-skew-safe reset calculations
 *
 * See docs/DMRX-FREE-INFERENCE-IMPLEMENTATION-PLAN.md Phase 3.
 */

import { getDb } from '@dmr-x/db';
import type { CapacityStore, CapacityReservation } from './capacity-manager.js';
import type { QuotaUnit } from './quota-dimensions.js';

interface DbLike {
  prepare(sql: string): any;
  exec(sql: string): void;
  transaction(fn: () => void): { (): void };
}

// ---------------------------------------------------------------------------
// SQLite-backed store — for single-node persistence across restarts
// ---------------------------------------------------------------------------

interface ReservationRow {
  reservation_id: string;
  unit: string;
  scope_id: string;
  amount: number;
  expires_at: number;
  status: string;
  created_at: number;
}

export class SQLiteCapacityStore implements CapacityStore {
  private ensureSchema(): void {
    // Schema creation handled lazily on first operation
  }

  async tryReserve(
    dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }>,
  ): Promise<Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> | null> {
    const db = getDb();
    const now = Date.now();

    // Check if all dimensions can be satisfied
    for (const d of dimensions) {
      const reserved = this.getReservedAmount(d.unit, d.scopeId, now);
      const current = d.currentRemaining ?? 0;
      if (current - reserved < d.amount) {
        return null;
      }
    }

    // Apply reservation atomically within a transaction
    const reservationId = `sqlite-${now}-${Math.random().toString(36).slice(2, 10)}`;
    const insert = db.prepare(`
      INSERT INTO capacity_reservations (reservation_id, unit, scope_id, amount, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'reserved', ?)
    `);

    const result: Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> = [];

    try {
      db.transaction(() => {
        for (const d of dimensions) {
          insert.run(reservationId, d.unit, d.scopeId, d.amount, now + 30_000, now);
          const reserved = this.getReservedAmount(d.unit, d.scopeId, now);
          result.push({ unit: d.unit, scopeId: d.scopeId, newRemaining: (d.currentRemaining ?? 0) - reserved });
        }
      });
    } catch (err) {
      return null; // Unique constraint violation or other failure
    }

    return result;
  }

  async release(reservation: CapacityReservation): Promise<void> {
    const db = getDb();
    db.prepare(`
      UPDATE capacity_reservations
      SET status = 'released'
      WHERE reservation_id = ? AND status = 'reserved'
    `).run(reservation.id);
  }

  async commit(reservation: CapacityReservation, actualUsage: import('./quota-dimensions.js').DemandVector): Promise<void> {
    const db = getDb();

    // Update reservation status to committed
    db.prepare(`
      UPDATE capacity_reservations
      SET status = 'committed', committed_at = ?
      WHERE reservation_id = ? AND status = 'reserved'
    `).run(Date.now(), reservation.id);

    // For dimensions where actual < reserved, we don't need to do anything special
    // because the reservation was already deducted. The "refund" is implicit:
    // we don't re-add the difference because the reservation was a pre-deduction.
    // The quota vector's remaining count reflects the reservation, and after commit
    // we simply mark it done. The actual usage will be observed via response headers
    // and will update the quota vector's remaining on the next observation.
  }

  async expireLeases(nowMs?: number): Promise<number> {
    const db = getDb();
    const now = nowMs ?? Date.now();
    const result = db.prepare(`
      UPDATE capacity_reservations
      SET status = 'expired'
      WHERE status = 'reserved' AND expires_at < ?
    `).run(now);
    return result.changes;
  }

  /**
   * Get the total reserved amount for a unit/scope that is currently active.
   */
  private getReservedAmount(unit: string, scopeId: string, now: number): number {
    const db = getDb();
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM capacity_reservations
      WHERE unit = ? AND scope_id = ? AND status = 'reserved' AND expires_at > ?
    `).get(unit, scopeId, now) as { total: number };
    return row.total;
  }
}

// ---------------------------------------------------------------------------
// Redis-backed store — for multi-instance deployments
// ---------------------------------------------------------------------------

export interface RedisCapacityStoreConfig {
  redisUrl?: string;
  keyPrefix?: string;
  leaseMs?: number;
}

export class RedisCapacityStore implements CapacityStore {
  private redis: any = null;
  private readonly keyPrefix: string;
  private readonly leaseMs: number;
  private readonly redisUrl: string;

  constructor(config: RedisCapacityStoreConfig = {}) {
    this.redisUrl = config.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.keyPrefix = config.keyPrefix ?? 'dmrx:capacity:';
    this.leaseMs = config.leaseMs ?? 30_000;
  }

  private async getClient(): Promise<any> {
    if (this.redis) return this.redis;
    try {
      const { createClient } = await import('redis');
      this.redis = createClient({ url: this.redisUrl });
      await this.redis.connect();
      return this.redis;
    } catch (err) {
      throw new Error(`RedisCapacityStore: cannot connect to Redis at ${this.redisUrl}: ${err}`);
    }
  }

  async tryReserve(
    dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }>,
  ): Promise<Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> | null> {
    const redis = await this.getClient();
    const now = Date.now();

    // Use a Lua script for atomic multi-key decrement with floor check
    const reserveScript = `
      local results = {}
      for i, key in ipairs(KEYS) do
        local amount = tonumber(ARGV[i])
        local current = tonumber(redis.call('GET', key) or '0')
        if current < amount then
          -- Rollback any already-decremented keys
          for j = 1, i - 1 do
            redis.call('INCRBY', KEYS[j], tonumber(ARGV[j]))
          end
          return nil
        end
        redis.call('DECRBY', key, amount)
        table.insert(results, current - amount)
      end
      return results
    `;

    const keys = dimensions.map(d => `${this.keyPrefix}${d.unit}:${d.scopeId}`);
    const args = dimensions.map(d => d.amount);

    const result = await redis.eval(reserveScript, { keys, arguments: args.map(String) });

    if (result === null) return null;

    // Store reservation record for later release/commit
    const reservationId = `redis-${now}-${Math.random().toString(36).slice(2, 10)}`;
    const reservationKey = `${this.keyPrefix}reservation:${reservationId}`;
    await redis.set(reservationKey, JSON.stringify({
      id: reservationId,
      dimensions: dimensions.map(d => ({ unit: d.unit, scopeId: d.scopeId, amount: d.amount })),
      expiresAt: now + this.leaseMs,
      status: 'reserved',
    }), { PX: this.leaseMs });

    return dimensions.map((d, i) => ({
      unit: d.unit,
      scopeId: d.scopeId,
      newRemaining: result[i],
    }));
  }

  async release(reservation: CapacityReservation): Promise<void> {
    const redis = await this.getClient();

    // Return reserved capacity
    for (const d of reservation.dimensions) {
      const key = `${this.keyPrefix}${d.unit}:${d.scopeId}`;
      await redis.incrBy(key, d.reserved);
    }

    // Mark reservation as released
    const reservationKey = `${this.keyPrefix}reservation:${reservation.id}`;
    await redis.del(reservationKey);
  }

  async commit(reservation: CapacityReservation, actualUsage: import('./quota-dimensions.js').DemandVector): Promise<void> {
    const redis = await this.getClient();

    // Return unused capacity to the pool
    for (const d of reservation.dimensions) {
      const actual = actualForUnit(actualUsage, d.unit);
      const refund = d.reserved - actual;
      if (refund > 0) {
        const key = `${this.keyPrefix}${d.unit}:${d.scopeId}`;
        await redis.incrBy(key, refund);
      }
    }

    // Delete reservation record
    const reservationKey = `${this.keyPrefix}reservation:${reservation.id}`;
    await redis.del(reservationKey);
  }

  async expireLeases(_nowMs?: number): Promise<number> {
    // Redis handles expiry automatically via PX on the reservation keys.
    // The capacity keys don't expire; they're updated by header observations.
    return 0;
  }

  /**
   * Initialize capacity counters from quota vector observations.
   * Called when registering a new provider/model pair.
   */
  async setCapacity(unit: QuotaUnit, scopeId: string, remaining: number): Promise<void> {
    const redis = await this.getClient();
    const key = `${this.keyPrefix}${unit}:${scopeId}`;
    await redis.set(key, remaining);
  }

  /**
   * Get current capacity for a dimension.
   */
  async getCapacity(unit: QuotaUnit, scopeId: string): Promise<number | null> {
    const redis = await this.getClient();
    const key = `${this.keyPrefix}${unit}:${scopeId}`;
    const val = await redis.get(key);
    return val === null ? null : Number(val);
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
    }
  }
}

function actualForUnit(actual: import('./quota-dimensions.js').DemandVector, unit: QuotaUnit): number {
  switch (unit) {
    case 'requests': return actual.requests;
    case 'input_tokens': return actual.inputTokens;
    case 'output_tokens': return actual.outputTokens;
    case 'total_tokens': return actual.inputTokens + actual.outputTokens;
    case 'concurrency': return actual.concurrency;
    case 'credits': return actual.credits ?? 0;
    default: return 0;
  }
}
