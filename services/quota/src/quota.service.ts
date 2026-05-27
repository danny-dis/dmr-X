import { getPool, getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { QuotaExhaustedError } from '@dmr-x/core';
import type { CandidateSet } from '@dmr-x/core';
import { PROVIDER_CATALOG } from '@dmr-x/registry';

export interface QuotaAllocation {
  id: string;
  tenantId: string;
  providerId?: string;
  maxRequests?: number;
  maxTokens?: number;
  maxCost?: number;
  period: string;
}

export interface QuotaUsage {
  requests: number;
  tokens: number;
  cost: number;
}

export class QuotaService {
  /**
   * Filter candidates based on tenant quota
   */
  async filterByQuota(
    candidates: CandidateSet,
    tenantId: string
  ): Promise<CandidateSet> {
    const allocations = await this.getAllocations(tenantId);

    const filtered: CandidateSet = [];

    for (const candidate of candidates) {
      const allocation = allocations.find(
        (a) => !a.providerId || a.providerId === candidate.providerId
      );

      if (allocation) {
        const usage = await this.getUsage(tenantId, allocation);

        // Check if quota is exceeded
        if (allocation.maxRequests && usage.requests >= allocation.maxRequests) {
          continue; // Quota exceeded
        }
        if (allocation.maxTokens && usage.tokens >= allocation.maxTokens) {
          continue; // Quota exceeded
        }
        if (allocation.maxCost && usage.cost >= allocation.maxCost) {
          continue; // Quota exceeded
        }
      }

      // Check free-tier monthly budget from provider catalog
      const monthlyBudget = this.getFreeTierBudget(candidate.providerId, candidate.modelId);
      if (monthlyBudget > 0) {
        const providerUsage = await this.getProviderBudgetUsage(tenantId, candidate.providerId);
        if (providerUsage >= monthlyBudget) {
          continue; // Free-tier monthly budget exhausted
        }
      }

      filtered.push(candidate);
    }

    return filtered;
  }

  /**
   * Look up monthly token budget from provider catalog for a free-tier model
   */
  private getFreeTierBudget(providerId: string, modelId: string): number {
    const provider = PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!provider) return 0;
    const model = provider.models.find((m) => m.id === modelId);
    return model?.freeTier?.monthlyTokenBudget || 0;
  }

  /**
   * Get accumulated token usage for a provider's free-tier budget
   */
  async getProviderBudgetUsage(tenantId: string, providerId: string): Promise<number> {
    const redis = getRedis();
    const key = `freebudget:${tenantId}:${providerId}`;
    const usage = await redis.get(key);
    return parseInt(usage || '0');
  }

  /**
   * Record usage against a provider's free-tier monthly budget
   */
  async recordProviderBudgetUsage(
    tenantId: string,
    providerId: string,
    tokens: number
  ): Promise<void> {
    const redis = getRedis();
    const key = `freebudget:${tenantId}:${providerId}`;
    await redis.incrBy(key, tokens);
    // Expire at end of month (30 days)
    await redis.expire(key, 30 * 24 * 60 * 60);
  }

  /**
   * Record usage after a request
   */
  async recordUsage(
    tenantId: string,
    providerId: string,
    tokens: number,
    cost: number
  ): Promise<void> {
    const redis = getRedis();

    // Increment counters in Redis (fast path)
    const key = `quota:${tenantId}:${providerId}`;
    await redis.hIncrBy(key, 'requests', 1);
    await redis.hIncrBy(key, 'tokens', tokens);
    await redis.hIncrByFloat(key, 'cost', cost);

    // Set expiry based on period (default: 30 days)
    await redis.expire(key, 30 * 24 * 60 * 60);

    // Also record in PostgreSQL for persistence
    const pool = getPool();
    await pool.query(
      `INSERT INTO billing_records (tenant_id, amount, description)
       VALUES ($1, $2, $3)`,
      [tenantId, cost, `Usage: ${tokens} tokens via ${providerId}`]
    );
  }

  /**
   * Check if a request would exceed quota
   */
  async checkQuota(
    tenantId: string,
    providerId: string,
    estimatedTokens: number,
    estimatedCost: number
  ): Promise<void> {
    const allocations = await this.getAllocations(tenantId);

    for (const allocation of allocations) {
      if (allocation.providerId && allocation.providerId !== providerId) {
        continue;
      }

      const usage = await this.getUsage(tenantId, allocation);

      if (allocation.maxRequests && usage.requests >= allocation.maxRequests) {
        throw new QuotaExhaustedError();
      }
      if (allocation.maxTokens && usage.tokens + estimatedTokens > allocation.maxTokens) {
        throw new QuotaExhaustedError();
      }
      if (allocation.maxCost && usage.cost + estimatedCost > allocation.maxCost) {
        throw new QuotaExhaustedError();
      }
    }
  }

  private async getAllocations(tenantId: string): Promise<QuotaAllocation[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, tenant_id, provider_id, max_requests, max_tokens, max_cost, period
       FROM quota_allocations
       WHERE tenant_id = $1`,
      [tenantId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      providerId: row.provider_id,
      maxRequests: row.max_requests,
      maxTokens: row.max_tokens,
      maxCost: row.max_cost ? parseFloat(row.max_cost) : undefined,
      period: row.period,
    }));
  }

  private async getUsage(tenantId: string, allocation: QuotaAllocation): Promise<QuotaUsage> {
    const redis = getRedis();
    const key = `quota:${tenantId}:${allocation.providerId || 'global'}`;

    const [requests, tokens, cost] = await Promise.all([
      redis.hGet(key, 'requests').then((v) => parseInt(v || '0')),
      redis.hGet(key, 'tokens').then((v) => parseInt(v || '0')),
      redis.hGet(key, 'cost').then((v) => parseFloat(v || '0')),
    ]);

    return { requests, tokens, cost };
  }

  /**
   * Reset quotas for a new period
   */
  async resetQuotas(tenantId?: string): Promise<void> {
    const redis = getRedis();
    const pool = getPool();

    // Get all allocations
    const query = tenantId
      ? 'SELECT * FROM quota_allocations WHERE tenant_id = $1'
      : 'SELECT * FROM quota_allocations';
    const result = tenantId
      ? await pool.query(query, [tenantId])
      : await pool.query(query);

    for (const allocation of result.rows) {
      const key = `quota:${allocation.tenant_id}:${allocation.provider_id || 'global'}`;
      await redis.del(key);
    }

    logger.info({ tenantId }, 'Reset quotas');
  }

  /**
   * Create a quota allocation
   */
  async createAllocation(
    tenantId: string,
    providerId: string | null,
    maxRequests: number | null,
    maxTokens: number | null,
    maxCost: number | null,
    period: string = 'monthly'
  ): Promise<QuotaAllocation> {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO quota_allocations (tenant_id, provider_id, max_requests, max_tokens, max_cost, period)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, providerId, maxRequests, maxTokens, maxCost, period]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      providerId: row.provider_id,
      maxRequests: row.max_requests,
      maxTokens: row.max_tokens,
      maxCost: row.max_cost ? parseFloat(row.max_cost) : undefined,
      period: row.period,
    };
  }
}

export const quotaService = new QuotaService();
