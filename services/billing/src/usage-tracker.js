import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
const cache = createNamespacedCache('usage');
/**
 * Tracks usage in cache (real-time counters) and SQLite (persistent history).
 *
 * Cache keys:
 *   usage:rt:{tenantId}:{providerId}:{modelId}   -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:rt:{tenantId}:global                    -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:daily:{tenantId}:{yyyy-mm-dd}           -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:monthly:{tenantId}:{yyyy-mm}            -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 */
export class UsageTracker {
    static RT_PREFIX = 'rt:';
    static DAILY_PREFIX = 'daily:';
    static MONTHLY_PREFIX = 'monthly:';
    static DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
    /**
     * Record a single request's usage. Writes to cache counters and persists to SQLite.
     */
    record(record) {
        const db = getDb();
        const now = new Date();
        const dayKey = this.formatDay(now);
        const monthKey = this.formatMonth(now);
        // 1. Increment cache real-time counters
        const rtKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:${record.providerId}:${record.modelId}`;
        const globalKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:global`;
        const dailyKey = `${UsageTracker.DAILY_PREFIX}${record.tenantId}:${dayKey}`;
        const monthlyKey = `${UsageTracker.MONTHLY_PREFIX}${record.tenantId}:${monthKey}`;
        for (const key of [rtKey, globalKey, dailyKey, monthlyKey]) {
            cache.hIncrBy(key, 'requests', 1);
            cache.hIncrBy(key, 'inputTokens', record.inputTokens);
            cache.hIncrBy(key, 'outputTokens', record.outputTokens);
            cache.hIncrBy(key, 'totalTokens', record.totalTokens);
            cache.hIncrBy(key, 'costCents', record.costCents);
            cache.expire(key, UsageTracker.DEFAULT_TTL_SECONDS);
        }
        // 2. Persist to SQLite
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO usage_records
         (id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, record.tenantId, record.providerId, record.modelId, record.inputTokens, record.outputTokens, record.totalTokens, record.costCents, record.requestId, this.formatDateTime(now));
        const row = db.prepare('SELECT * FROM usage_records WHERE id = ?').get(id);
        logger.debug({
            tenantId: record.tenantId,
            providerId: record.providerId,
            modelId: record.modelId,
            totalTokens: record.totalTokens,
            costCents: record.costCents,
        }, 'Recorded usage');
        return this.mapRow(row);
    }
    /**
     * Get real-time usage from cache for a specific tenant/provider/model.
     * Falls back to SQLite if cache has no data.
     */
    getRealtimeUsage(tenantId, providerId, modelId) {
        const key = providerId && modelId
            ? `${UsageTracker.RT_PREFIX}${tenantId}:${providerId}:${modelId}`
            : `${UsageTracker.RT_PREFIX}${tenantId}:global`;
        const requests = parseInt(String(cache.hGet(key, 'requests') || '0'), 10);
        const inputTokens = parseInt(String(cache.hGet(key, 'inputTokens') || '0'), 10);
        const outputTokens = parseInt(String(cache.hGet(key, 'outputTokens') || '0'), 10);
        const totalTokens = parseInt(String(cache.hGet(key, 'totalTokens') || '0'), 10);
        const costCents = parseInt(String(cache.hGet(key, 'costCents') || '0'), 10);
        return { requests, inputTokens, outputTokens, totalTokens, costCents };
    }
    /**
     * Get daily usage from cache fast path, with SQLite fallback.
     */
    getDailyUsage(tenantId, date) {
        const dayKey = this.formatDay(date);
        const key = `${UsageTracker.DAILY_PREFIX}${tenantId}:${dayKey}`;
        const requests = parseInt(String(cache.hGet(key, 'requests') || '0'), 10);
        const inputTokens = parseInt(String(cache.hGet(key, 'inputTokens') || '0'), 10);
        const outputTokens = parseInt(String(cache.hGet(key, 'outputTokens') || '0'), 10);
        const totalTokens = parseInt(String(cache.hGet(key, 'totalTokens') || '0'), 10);
        const costCents = parseInt(String(cache.hGet(key, 'costCents') || '0'), 10);
        if (requests === 0) {
            return this.aggregateFromDb(tenantId, this.startOfDay(date), this.endOfDay(date));
        }
        const periodStart = this.startOfDay(date);
        const periodEnd = this.endOfDay(date);
        return {
            tenantId,
            providerId: '*',
            modelId: '*',
            totalRequests: requests,
            totalInputTokens: inputTokens,
            totalOutputTokens: outputTokens,
            totalTokens,
            totalCostCents: costCents,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
        };
    }
    /**
     * Get monthly usage from cache fast path, with SQLite fallback.
     */
    getMonthlyUsage(tenantId, year, month) {
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        const key = `${UsageTracker.MONTHLY_PREFIX}${tenantId}:${monthStr}`;
        const requests = parseInt(String(cache.hGet(key, 'requests') || '0'), 10);
        const inputTokens = parseInt(String(cache.hGet(key, 'inputTokens') || '0'), 10);
        const outputTokens = parseInt(String(cache.hGet(key, 'outputTokens') || '0'), 10);
        const totalTokens = parseInt(String(cache.hGet(key, 'totalTokens') || '0'), 10);
        const costCents = parseInt(String(cache.hGet(key, 'costCents') || '0'), 10);
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
        if (requests === 0) {
            return this.aggregateFromDb(tenantId, periodStart, periodEnd);
        }
        return {
            tenantId,
            providerId: '*',
            modelId: '*',
            totalRequests: requests,
            totalInputTokens: inputTokens,
            totalOutputTokens: outputTokens,
            totalTokens,
            totalCostCents: costCents,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
        };
    }
    /**
     * Query historical usage records from SQLite.
     */
    queryRecords(query) {
        const db = getDb();
        const conditions = [];
        const params = [];
        if (query.tenantId) {
            conditions.push(`tenant_id = ?`);
            params.push(query.tenantId);
        }
        if (query.providerId) {
            conditions.push(`provider_id = ?`);
            params.push(query.providerId);
        }
        if (query.modelId) {
            conditions.push(`model_id = ?`);
            params.push(query.modelId);
        }
        if (query.from) {
            conditions.push(`created_at >= ?`);
            params.push(query.from.toISOString());
        }
        if (query.to) {
            conditions.push(`created_at <= ?`);
            params.push(query.to.toISOString());
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = query.limit ?? 100;
        const offset = query.offset ?? 0;
        const rows = db.prepare(`SELECT id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at
       FROM usage_records
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`).all(...params, limit, offset);
        return rows.map((row) => this.mapRow(row));
    }
    /**
     * Aggregate usage from SQLite grouped by provider and model.
     */
    aggregateByDimensions(tenantId, from, to) {
        const db = getDb();
        const rows = db.prepare(`SELECT
         tenant_id,
         provider_id,
         model_id,
         COUNT(*)              AS total_requests,
         SUM(input_tokens)     AS total_input_tokens,
         SUM(output_tokens)    AS total_output_tokens,
         SUM(total_tokens)     AS total_tokens,
         SUM(cost_cents)       AS total_cost_cents,
         MIN(created_at)       AS period_start,
         MAX(created_at)       AS period_end
       FROM usage_records
       WHERE tenant_id = ?
         AND created_at >= ?
         AND created_at <= ?
       GROUP BY tenant_id, provider_id, model_id
       ORDER BY total_cost_cents DESC`).all(tenantId, from.toISOString(), to.toISOString());
        return rows.map((row) => ({
            tenantId: row.tenant_id,
            providerId: row.provider_id,
            modelId: row.model_id,
            totalRequests: parseInt(row.total_requests, 10),
            totalInputTokens: parseInt(row.total_input_tokens, 10),
            totalOutputTokens: parseInt(row.total_output_tokens, 10),
            totalTokens: parseInt(row.total_tokens, 10),
            totalCostCents: parseInt(row.total_cost_cents, 10),
            periodStart: row.period_start,
            periodEnd: row.period_end,
        }));
    }
    /**
     * Aggregate raw records from SQLite for a time window.
     */
    aggregateFromDb(tenantId, from, to) {
        const db = getDb();
        const row = db.prepare(`SELECT
         COUNT(*)           AS total_requests,
         SUM(input_tokens)  AS total_input_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(total_tokens)  AS total_tokens,
         SUM(cost_cents)    AS total_cost_cents
       FROM usage_records
       WHERE tenant_id = ?
         AND created_at >= ?
         AND created_at <= ?`).get(tenantId, from.toISOString(), to.toISOString());
        const totalRequests = parseInt(row.total_requests, 10);
        if (totalRequests === 0) {
            return null;
        }
        return {
            tenantId,
            providerId: '*',
            modelId: '*',
            totalRequests,
            totalInputTokens: parseInt(row.total_input_tokens, 10),
            totalOutputTokens: parseInt(row.total_output_tokens, 10),
            totalTokens: parseInt(row.total_tokens, 10),
            totalCostCents: parseInt(row.total_cost_cents, 10),
            periodStart: from.toISOString(),
            periodEnd: to.toISOString(),
        };
    }
    /**
     * Reset real-time cache counters for a tenant (e.g. on period rollover).
     */
    resetRealtimeCounters(tenantId) {
        const db = getDb();
        // Get all unique provider/model combos for this tenant from DB
        const rows = db.prepare(`SELECT DISTINCT provider_id, model_id FROM usage_records WHERE tenant_id = ?`).all(tenantId);
        // Delete RT keys for each provider/model combo
        for (const row of rows) {
            const rtKey = `${UsageTracker.RT_PREFIX}${tenantId}:${row.provider_id}:${row.model_id}`;
            cache.del(rtKey);
        }
        // Delete global key
        cache.del(`${UsageTracker.RT_PREFIX}${tenantId}:global`);
        logger.info({ tenantId }, 'Reset real-time usage counters');
    }
    // -- Helpers --
    mapRow(row) {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            providerId: row.provider_id,
            modelId: row.model_id,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            costCents: row.cost_cents,
            requestId: row.request_id,
            createdAt: row.created_at,
        };
    }
    /**
     * Format date as 'YYYY-MM-DD HH:MM:SS' for SQLite compatibility.
     * NOTE: This format does not include timezone information.
     * Previous code used ISO format (toISOString()). External consumers
     * parsing this field should handle both formats.
     */
    formatDateTime(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
    formatDay(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    formatMonth(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }
    startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    }
    endOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    }
}
export const usageTracker = new UsageTracker();
//# sourceMappingURL=usage-tracker.js.map