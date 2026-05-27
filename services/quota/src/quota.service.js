import { getPool, getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { QuotaExhaustedError } from '@dmr-x/core';
export class QuotaService {
    /**
     * Filter candidates based on tenant quota
     */
    async filterByQuota(candidates, tenantId) {
        const allocations = await this.getAllocations(tenantId);
        if (allocations.length === 0) {
            return candidates; // No quotas = allow all
        }
        const filtered = [];
        for (const candidate of candidates) {
            const allocation = allocations.find((a) => !a.providerId || a.providerId === candidate.providerId);
            if (!allocation) {
                // No quota for this provider, allow it
                filtered.push(candidate);
                continue;
            }
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
            filtered.push(candidate);
        }
        return filtered;
    }
    /**
     * Record usage after a request
     */
    async recordUsage(tenantId, providerId, tokens, cost) {
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
        await pool.query(`INSERT INTO billing_records (tenant_id, amount, description)
       VALUES ($1, $2, $3)`, [tenantId, cost, `Usage: ${tokens} tokens via ${providerId}`]);
    }
    /**
     * Check if a request would exceed quota
     */
    async checkQuota(tenantId, providerId, estimatedTokens, estimatedCost) {
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
    async getAllocations(tenantId) {
        const pool = getPool();
        const result = await pool.query(`SELECT id, tenant_id, provider_id, max_requests, max_tokens, max_cost, period
       FROM quota_allocations
       WHERE tenant_id = $1`, [tenantId]);
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
    async getUsage(tenantId, allocation) {
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
    async resetQuotas(tenantId) {
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
    async createAllocation(tenantId, providerId, maxRequests, maxTokens, maxCost, period = 'monthly') {
        const pool = getPool();
        const result = await pool.query(`INSERT INTO quota_allocations (tenant_id, provider_id, max_requests, max_tokens, max_cost, period)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [tenantId, providerId, maxRequests, maxTokens, maxCost, period]);
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
//# sourceMappingURL=quota.service.js.map