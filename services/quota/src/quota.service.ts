import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { QuotaExhaustedError } from '@dmr-x/core';
import type { CandidateSet } from '@dmr-x/core';
import { PROVIDER_CATALOG } from '@dmr-x/registry';
import crypto from 'node:crypto';

const quotaCache = createNamespacedCache('quota');
const budgetCache = createNamespacedCache('freebudget');

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
    const key = `${tenantId}:${providerId}`;
    const usage = budgetCache.get(key);
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
    const key = `${tenantId}:${providerId}`;
    budgetCache.incrBy(key, tokens);
    // Expire at end of month (30 days)
    budgetCache.expire(key, 30 * 24 * 60 * 60);
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
    // Increment counters in cache (fast path)
    const key = `${tenantId}:${providerId}`;
    quotaCache.hIncrBy(key, 'requests', 1);
    quotaCache.hIncrBy(key, 'tokens', tokens);
    quotaCache.hIncrBy(key, 'cost', Math.round(cost));

    // Set expiry based on period (default: 30 days)
    quotaCache.expire(key, 30 * 24 * 60 * 60);

    // Also record in database for persistence
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO billing_records (id, tenant_id, request_id, amount, description)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, tenantId, null, cost, `Usage: ${tokens} tokens via ${providerId}`);
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
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, tenant_id, provider_id, max_requests, max_tokens, max_cost, period
       FROM quota_allocations
       WHERE tenant_id = ?`
    ).all(tenantId) as any[];

    return rows.map((row) => ({
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
    const key = `${tenantId}:${allocation.providerId || 'global'}`;

    const requests = parseInt(quotaCache.hGet(key, 'requests') || '0');
    const tokens = parseInt(quotaCache.hGet(key, 'tokens') || '0');
    const cost = parseFloat(quotaCache.hGet(key, 'cost') || '0');

    return { requests, tokens, cost };
  }

  /**
   * Reset quotas for a new period
   */
  async resetQuotas(tenantId?: string): Promise<void> {
    const db = getDb();

    // Get all allocations
    const rows = tenantId
      ? db.prepare('SELECT * FROM quota_allocations WHERE tenant_id = ?').all(tenantId) as any[]
      : db.prepare('SELECT * FROM quota_allocations').all() as any[];

    for (const allocation of rows) {
      const key = `${allocation.tenant_id}:${allocation.provider_id || 'global'}`;
      quotaCache.del(key);
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
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO quota_allocations (id, tenant_id, provider_id, max_requests, max_tokens, max_cost, period)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, tenantId, providerId, maxRequests, maxTokens, maxCost, period);

    const row = db.prepare('SELECT * FROM quota_allocations WHERE id = ?').get(id) as any;
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
