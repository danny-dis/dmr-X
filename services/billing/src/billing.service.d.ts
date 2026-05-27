import { UsageTracker } from './usage-tracker.js';
import type { UsageAggregate, UsageQuery, UsageRecord } from './usage-tracker.js';
export interface ModelPricing {
    providerId: string;
    modelId: string;
    inputPricePer1kTokens: number;
    outputPricePer1kTokens: number;
}
export interface BillingPeriod {
    type: 'daily' | 'monthly';
    start: Date;
    end: Date;
}
export interface UsageReport {
    tenantId: string;
    period: BillingPeriod;
    /** Totals across all providers/models */
    totals: UsageSummary;
    /** Breakdown by provider */
    byProvider: Record<string, UsageSummary>;
    /** Breakdown by model */
    byModel: Record<string, UsageSummary>;
    /** Detailed per-provider-per-model rows */
    breakdown: UsageAggregate[];
    /** Generated at timestamp */
    generatedAt: Date;
}
export interface UsageSummary {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostCents: number;
    /** Cost formatted as dollars, e.g. "$12.34" */
    totalCostFormatted: string;
}
export interface RecordUsageInput {
    tenantId: string;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    requestId: string;
}
export declare class BillingService {
    private tracker;
    private pricingCache;
    private pricingCacheLoadedAt;
    private static readonly PRICING_CACHE_TTL_MS;
    constructor(tracker?: UsageTracker);
    /**
     * Record usage for a completed request. Calculates cost from model_profiles
     * pricing, then persists to both Redis and PostgreSQL.
     */
    recordUsage(input: RecordUsageInput): Promise<UsageRecord>;
    /**
     * Get real-time (current period) usage for a tenant, optionally scoped
     * to a provider/model.
     */
    getRealtimeUsage(tenantId: string, providerId?: string, modelId?: string): Promise<{
        requests: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        costCents: number;
    }>;
    /**
     * Get aggregated usage for a tenant, broken down by provider and model
     * for a given time range.
     */
    getUsageByDimensions(tenantId: string, from: Date, to: Date): Promise<UsageAggregate[]>;
    /**
     * Query raw usage records with optional filters.
     */
    queryUsage(query: UsageQuery): Promise<UsageRecord[]>;
    /**
     * Generate a full usage report for a billing period.
     */
    generateReport(tenantId: string, period: BillingPeriod): Promise<UsageReport>;
    /**
     * Generate a daily report for a specific date.
     */
    generateDailyReport(tenantId: string, date: Date): Promise<UsageReport>;
    /**
     * Generate a monthly report for a specific year/month.
     */
    generateMonthlyReport(tenantId: string, year: number, month: number): Promise<UsageReport>;
    /**
     * Get current-period daily or monthly summary from the fast Redis path.
     */
    getCurrentPeriodUsage(tenantId: string, periodType: 'daily' | 'monthly'): Promise<UsageAggregate | null>;
    /**
     * Calculate cost in cents for a given token count and pricing.
     */
    calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number;
    /**
     * Load or refresh pricing from model_profiles table.
     */
    getModelPricing(providerId: string, modelId: string): Promise<ModelPricing | null>;
    /**
     * Force-refresh the pricing cache from the database.
     */
    refreshPricingCache(): Promise<void>;
    /**
     * Reset real-time counters for a tenant (e.g. at the start of a new billing period).
     */
    resetCounters(tenantId: string): Promise<void>;
    private ensurePricingCache;
    private emptySummary;
    private addToSummary;
    private formatCents;
}
export declare const billingService: BillingService;
//# sourceMappingURL=billing.service.d.ts.map