import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { usageTracker } from './usage-tracker.js';
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export class BillingService {
    tracker;
    pricingCache = new Map();
    pricingCacheLoadedAt = 0;
    static PRICING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    constructor(tracker = usageTracker) {
        this.tracker = tracker;
    }
    // ----- Public API --------------------------------------------------------
    /**
     * Record usage for a completed request. Calculates cost from model_profiles
     * pricing, then persists to both cache and SQLite.
     */
    async recordUsage(input) {
        const pricing = await this.getModelPricing(input.providerId, input.modelId);
        const totalTokens = input.inputTokens + input.outputTokens;
        const costCents = pricing
            ? this.calculateCost(input.inputTokens, input.outputTokens, pricing)
            : 0;
        const record = await this.tracker.record({
            tenantId: input.tenantId,
            providerId: input.providerId,
            modelId: input.modelId,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            totalTokens,
            costCents,
            requestId: input.requestId,
        });
        logger.info({
            tenantId: input.tenantId,
            providerId: input.providerId,
            modelId: input.modelId,
            totalTokens,
            costCents,
        }, 'Billing: recorded usage');
        return record;
    }
    /**
     * Get real-time (current period) usage for a tenant, optionally scoped
     * to a provider/model.
     */
    async getRealtimeUsage(tenantId, providerId, modelId) {
        return this.tracker.getRealtimeUsage(tenantId, providerId, modelId);
    }
    /**
     * Get aggregated usage for a tenant, broken down by provider and model
     * for a given time range.
     */
    async getUsageByDimensions(tenantId, from, to) {
        return this.tracker.aggregateByDimensions(tenantId, from, to);
    }
    /**
     * Query raw usage records with optional filters.
     */
    async queryUsage(query) {
        return this.tracker.queryRecords(query);
    }
    /**
     * Generate a full usage report for a billing period.
     */
    async generateReport(tenantId, period) {
        const breakdown = await this.tracker.aggregateByDimensions(tenantId, period.start, period.end);
        const totals = {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalCostCents: 0,
            totalCostFormatted: '$0.00',
        };
        const byProvider = {};
        const byModel = {};
        for (const row of breakdown) {
            // Aggregate totals
            totals.totalRequests += row.totalRequests;
            totals.totalInputTokens += row.totalInputTokens;
            totals.totalOutputTokens += row.totalOutputTokens;
            totals.totalTokens += row.totalTokens;
            totals.totalCostCents += row.totalCostCents;
            // By provider
            if (!byProvider[row.providerId]) {
                byProvider[row.providerId] = this.emptySummary();
            }
            this.addToSummary(byProvider[row.providerId], row);
            // By model
            const modelKey = `${row.providerId}/${row.modelId}`;
            if (!byModel[modelKey]) {
                byModel[modelKey] = this.emptySummary();
            }
            this.addToSummary(byModel[modelKey], row);
        }
        totals.totalCostFormatted = this.formatCents(totals.totalCostCents);
        for (const summary of Object.values(byProvider)) {
            summary.totalCostFormatted = this.formatCents(summary.totalCostCents);
        }
        for (const summary of Object.values(byModel)) {
            summary.totalCostFormatted = this.formatCents(summary.totalCostCents);
        }
        return {
            tenantId,
            period,
            totals,
            byProvider,
            byModel,
            breakdown,
            generatedAt: new Date(),
        };
    }
    /**
     * Generate a daily report for a specific date.
     */
    async generateDailyReport(tenantId, date) {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
        return this.generateReport(tenantId, { type: 'daily', start, end });
    }
    /**
     * Generate a monthly report for a specific year/month.
     */
    async generateMonthlyReport(tenantId, year, month) {
        const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const end = new Date(year, month, 0, 23, 59, 59, 999);
        return this.generateReport(tenantId, { type: 'monthly', start, end });
    }
    /**
     * Get current-period daily or monthly summary from the fast cache path.
     */
    async getCurrentPeriodUsage(tenantId, periodType) {
        if (periodType === 'daily') {
            return this.tracker.getDailyUsage(tenantId, new Date());
        }
        const now = new Date();
        return this.tracker.getMonthlyUsage(tenantId, now.getFullYear(), now.getMonth() + 1);
    }
    /**
     * Calculate cost in cents for a given token count and pricing.
     */
    calculateCost(inputTokens, outputTokens, pricing) {
        const inputCost = (inputTokens / 1000) * pricing.inputPricePer1kTokens;
        const outputCost = (outputTokens / 1000) * pricing.outputPricePer1kTokens;
        return Math.round(inputCost + outputCost);
    }
    /**
     * Load or refresh pricing from model_profiles table.
     */
    async getModelPricing(providerId, modelId) {
        await this.ensurePricingCache();
        const key = `${providerId}:${modelId}`;
        return this.pricingCache.get(key) ?? null;
    }
    /**
     * Force-refresh the pricing cache from the database.
     */
    async refreshPricingCache() {
        const db = getDb();
        const rows = db.prepare(`SELECT provider_id, model_id,
              COALESCE(input_cost_per_1k, 0)  AS input_price,
              COALESCE(output_cost_per_1k, 0) AS output_price
       FROM model_profiles
       WHERE input_cost_per_1k IS NOT NULL
          OR output_cost_per_1k IS NOT NULL`).all();
        this.pricingCache.clear();
        for (const row of rows) {
            const pricing = {
                providerId: row.provider_id,
                modelId: row.model_id,
                inputPricePer1kTokens: parseFloat(row.input_price),
                outputPricePer1kTokens: parseFloat(row.output_price),
            };
            this.pricingCache.set(`${pricing.providerId}:${pricing.modelId}`, pricing);
        }
        this.pricingCacheLoadedAt = Date.now();
        logger.debug({ count: rows.length }, 'Refreshed pricing cache');
    }
    /**
     * Reset real-time counters for a tenant (e.g. at the start of a new billing period).
     */
    async resetCounters(tenantId) {
        await this.tracker.resetRealtimeCounters(tenantId);
    }
    // ----- Private helpers ---------------------------------------------------
    async ensurePricingCache() {
        if (this.pricingCache.size === 0 ||
            Date.now() - this.pricingCacheLoadedAt > BillingService.PRICING_CACHE_TTL_MS) {
            await this.refreshPricingCache();
        }
    }
    emptySummary() {
        return {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalCostCents: 0,
            totalCostFormatted: '$0.00',
        };
    }
    addToSummary(summary, row) {
        summary.totalRequests += row.totalRequests;
        summary.totalInputTokens += row.totalInputTokens;
        summary.totalOutputTokens += row.totalOutputTokens;
        summary.totalTokens += row.totalTokens;
        summary.totalCostCents += row.totalCostCents;
    }
    formatCents(cents) {
        return `$${(cents / 100).toFixed(2)}`;
    }
}
export const billingService = new BillingService();
//# sourceMappingURL=billing.service.js.map