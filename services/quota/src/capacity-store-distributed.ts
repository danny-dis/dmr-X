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
    dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null; observedAtMs?: number }>,
    reservationId?: string,
    leaseMs: number = 30_000,
  ): Promise<Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> | null> {
    const db = getDb();
    const now = Date.now();
    const id = reservationId ?? `sqlite-${crypto.randomUUID()}`;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0 || dimensions.length === 0) return null;
    const unique = new Set<string>();
    for (const d of dimensions) {
      const key = `${d.unit}:${d.scopeId}`;
      if (unique.has(key) || !Number.isFinite(d.amount) || d.amount < 0 || d.currentRemaining === null || !Number.isFinite(d.currentRemaining)) return null;
      unique.add(key);
    }
    const result: Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> = [];
    try {
      db.transaction(() => {
        // Write first: SQLite serializes contenders before the capacity read.
        for (const d of dimensions) {
          db.prepare(`INSERT INTO capacity_pool_balances (unit, scope_id, remaining, observed_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(unit, scope_id) DO NOTHING`)
            .run(d.unit, d.scopeId, d.currentRemaining, d.observedAtMs ?? 0);
          if (Number.isFinite(d.observedAtMs) && d.observedAtMs! > 0) {
            db.prepare(`UPDATE capacity_pool_balances SET remaining = ?, observed_at = ?
              WHERE unit = ? AND scope_id = ? AND observed_at < ?`)
              .run(d.currentRemaining, d.observedAtMs, d.unit, d.scopeId, d.observedAtMs);
          }
          const pool = db.prepare('SELECT remaining FROM capacity_pool_balances WHERE unit = ? AND scope_id = ?')
            .get(d.unit, d.scopeId) as { remaining: number };
          const current = Math.min(pool.remaining, d.currentRemaining!);
          if (current - this.getReservedAmount(d.unit, d.scopeId, now) < d.amount) throw new Error('capacity_exhausted');
          result.push({ unit: d.unit, scopeId: d.scopeId, newRemaining: current - this.getReservedAmount(d.unit, d.scopeId, now) - d.amount });
        }
        for (const d of dimensions) {
          db.prepare(`INSERT INTO capacity_reservations
            (reservation_id, unit, scope_id, amount, expires_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'reserved', ?)`)
            .run(id, d.unit, d.scopeId, d.amount, now + leaseMs, now);
        }
      });
    } catch {
      return null;
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
    for (const d of reservation.dimensions) {
      const actual = d.unit === 'concurrency' ? 0 : actualForUnit(actualUsage, d.unit);
      if (!Number.isFinite(actual) || actual < 0) throw new Error('Invalid actual capacity usage');
    }
    db.transaction(() => {
      const rows = db.prepare(`SELECT unit, scope_id FROM capacity_reservations
        WHERE reservation_id = ? AND status IN ('reserved', 'expired')`)
        .all(reservation.id) as Array<{ unit: QuotaUnit; scope_id: string }>;
      if (rows.length === 0) return;
      for (const row of rows) {
        // Concurrency is a lease, not a consumable quota; always return it.
        const actual = row.unit === 'concurrency' ? 0 : actualForUnit(actualUsage, row.unit);
        if (!Number.isFinite(actual) || actual < 0) throw new Error('Invalid actual capacity usage');
        db.prepare(`UPDATE capacity_pool_balances SET remaining = remaining - ?
          WHERE unit = ? AND scope_id = ?`).run(actual, row.unit, row.scope_id);
      }
      db.prepare(`UPDATE capacity_reservations SET status = 'committed', committed_at = ?
        WHERE reservation_id = ? AND status IN ('reserved', 'expired')`).run(Date.now(), reservation.id);
    });
  }

  async renew(reservationId: string, leaseMs: number): Promise<boolean> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) return false;
    const now = Date.now();
    const result = getDb().prepare(`UPDATE capacity_reservations SET expires_at = ?
      WHERE reservation_id = ? AND status = 'reserved' AND expires_at > ?`)
      .run(now + leaseMs, reservationId, now);
    return result.changes > 0;
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
    reservationId?: string,
    leaseMs: number = this.leaseMs,
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

    // Persist reservation metadata. If this write fails after the Lua
    // decrement, compensate the counter so capacity is not leaked.
    const stableReservationId = reservationId ?? `redis-${now}-${Math.random().toString(36).slice(2, 10)}`;
    const reservationKey = `${this.keyPrefix}reservation:${stableReservationId}`;
    try {
      await redis.set(reservationKey, JSON.stringify({
        id: stableReservationId,
        dimensions: dimensions.map(d => ({ unit: d.unit, scopeId: d.scopeId, amount: d.amount })),
        expiresAt: now + leaseMs,
        status: 'reserved',
      }), { PX: leaseMs });
    } catch (err) {
      const rollbackScript = `
        for i, key in ipairs(KEYS) do
          redis.call('INCRBY', key, tonumber(ARGV[i]))
        end
        return 1
      `;
      await redis.eval(rollbackScript, { keys, arguments: args.map(String) }).catch(() => {});
      throw err;
    }

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
    case 'neurons': return actual.neurons ?? 0;
    case 'seconds': return actual.seconds ?? 0;
    case 'minutes': return actual.minutes ?? 0;
    case 'characters': return actual.characters ?? 0;
    case 'jobs': return actual.jobs ?? 0;
    case 'gpu_seconds': return actual.gpuSeconds ?? 0;
    case 'gpu_hours': return actual.gpuHours ?? 0;
    case 'ip_requests': return actual.ipRequests ?? 0;
    default: return 0;
  }
}
