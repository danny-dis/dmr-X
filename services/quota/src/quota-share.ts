import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

export interface QuotaSharePool {
  id: string;
  providerId: string;
  name: string;
  /** Time window in seconds (default: 18000 = 5 hours) */
  windowSeconds: number;
  /** Allocation weights per key */
  allocations: QuotaShareAllocation[];
  /** Policy: 'hard' (block over share) | 'soft' (deprioritize) | 'burst' (use idle headroom) */
  policy: 'hard' | 'soft' | 'burst';
}

export interface QuotaShareAllocation {
  keyId: string;
  keyName: string;
  weight: number;
  /** Absolute cap per key (0 = unlimited within share) */
  capRequests?: number;
  capTokens?: number;
}

export interface QuotaShareUsage {
  keyId: string;
  requests: number;
  tokens: number;
  /** Percentage of pool used */
  utilizationPercent: number;
}

/**
 * Quota-Share engine — distributes a provider's time-based quota
 * fairly across multiple keys in a pool.
 */
export class QuotaShareEngine {
  private pools: Map<string, QuotaSharePool> = new Map();

  constructor() {
    this.loadPools();
  }

  private loadPools(): void {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT id, provider_id, name, window_seconds, policy
        FROM quota_share_pools
      `).all() as any[];

      for (const row of rows) {
        const allocations = db.prepare(`
          SELECT key_id, key_name, weight, cap_requests, cap_tokens
          FROM quota_share_allocations
          WHERE pool_id = ?
        `).all(row.id) as any[];

        this.pools.set(row.id, {
          id: row.id,
          providerId: row.provider_id,
          name: row.name,
          windowSeconds: row.window_seconds,
          allocations: allocations.map((a: any) => ({
            keyId: a.key_id,
            keyName: a.key_name,
            weight: a.weight,
            capRequests: a.cap_requests,
            capTokens: a.cap_tokens,
          })),
          policy: row.policy,
        });
      }
    } catch {
      // Tables may not exist yet
    }
  }

  /**
   * Get the pool for a provider.
   */
  getPool(providerId: string): QuotaSharePool | undefined {
    for (const pool of this.pools.values()) {
      if (pool.providerId === providerId) return pool;
    }
    return undefined;
  }

  /**
   * Create or update a quota share pool.
   */
  upsertPool(pool: QuotaSharePool): void {
    const db = getDb();

    db.prepare(`
      INSERT OR REPLACE INTO quota_share_pools (id, provider_id, name, window_seconds, policy)
      VALUES (?, ?, ?, ?, ?)
    `).run(pool.id, pool.providerId, pool.name, pool.windowSeconds, pool.policy);

    // Clear old allocations
    db.prepare('DELETE FROM quota_share_allocations WHERE pool_id = ?').run(pool.id);

    // Insert new allocations
    for (const alloc of pool.allocations) {
      db.prepare(`
        INSERT INTO quota_share_allocations (pool_id, key_id, key_name, weight, cap_requests, cap_tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(pool.id, alloc.keyId, alloc.keyName, alloc.weight, alloc.capRequests ?? null, alloc.capTokens ?? null);
    }

    this.pools.set(pool.id, pool);
  }

  /**
   * Delete a pool.
   */
  deletePool(poolId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM quota_share_allocations WHERE pool_id = ?').run(poolId);
    db.prepare('DELETE FROM quota_share_pools WHERE id = ?').run(poolId);
    this.pools.delete(poolId);
  }

  /**
   * Get current usage for a key in a pool within the current window.
   */
  getKeyUsage(poolId: string, keyId: string): QuotaShareUsage {
    const pool = this.pools.get(poolId);
    if (!pool) {
      return { keyId, requests: 0, tokens: 0, utilizationPercent: 0 };
    }

    const db = getDb();
    const windowStart = new Date(Date.now() - pool.windowSeconds * 1000).toISOString();

    const usage = db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(tokens_input + tokens_output), 0) as tokens
      FROM request_logs
      WHERE api_key_id = ?
        AND selected_provider = ?
        AND timestamp > ?
    `).get(keyId, pool.providerId, windowStart) as any;

    const totalPoolUsage = db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(tokens_input + tokens_output), 0) as tokens
      FROM request_logs
      WHERE api_key_id IN (SELECT key_id FROM quota_share_allocations WHERE pool_id = ?)
        AND selected_provider = ?
        AND timestamp > ?
    `).get(poolId, pool.providerId, windowStart) as any;

    const allocation = pool.allocations.find(a => a.keyId === keyId);
    const weight = allocation?.weight ?? 1;
    const totalWeight = pool.allocations.reduce((sum, a) => sum + a.weight, 0);
    const fairShare = totalWeight > 0 ? (weight / totalWeight) * (totalPoolUsage?.tokens ?? 0) : 0;

    return {
      keyId,
      requests: usage?.requests ?? 0,
      tokens: usage?.tokens ?? 0,
      utilizationPercent: fairShare > 0 ? ((usage?.tokens ?? 0) / fairShare) * 100 : 0,
    };
  }

  /**
   * Check if a key can make a request (within its fair share).
   */
  canRequest(poolId: string, keyId: string): boolean {
    const pool = this.pools.get(poolId);
    if (!pool) return true;

    const usage = this.getKeyUsage(poolId, keyId);
    const allocation = pool.allocations.find(a => a.keyId === keyId);

    if (!allocation) return true;

    // Check absolute caps
    if (allocation.capRequests && usage.requests >= allocation.capRequests) {
      return false;
    }
    if (allocation.capTokens && usage.tokens >= allocation.capTokens) {
      return false;
    }

    // Check fair share based on policy
    switch (pool.policy) {
      case 'hard':
        return usage.utilizationPercent < 100;
      case 'soft':
        return usage.utilizationPercent < 120; // allow 20% burst
      case 'burst':
        return true; // always allow, but deprioritize
      default:
        return true;
    }
  }

  /**
   * Get priority score for a key (used for deprioritization).
   */
  getPriorityScore(poolId: string, keyId: string): number {
    const pool = this.pools.get(poolId);
    if (!pool) return 1;

    const usage = this.getKeyUsage(poolId, keyId);

    switch (pool.policy) {
      case 'hard':
        // Linear decay as utilization approaches 100%
        return Math.max(0, 1 - usage.utilizationPercent / 100);
      case 'soft':
        // Decay starts at 80%, hard limit at 120%
        if (usage.utilizationPercent >= 120) return 0;
        if (usage.utilizationPercent >= 80) return 1 - (usage.utilizationPercent - 80) / 40;
        return 1;
      case 'burst':
        // No penalty until 100%, then decay
        if (usage.utilizationPercent >= 100) return 1 - (usage.utilizationPercent - 100) / 100;
        return 1;
      default:
        return 1;
    }
  }
}

// Singleton
let instance: QuotaShareEngine | null = null;

export function getQuotaShareEngine(): QuotaShareEngine {
  if (!instance) {
    instance = new QuotaShareEngine();
  }
  return instance;
}
