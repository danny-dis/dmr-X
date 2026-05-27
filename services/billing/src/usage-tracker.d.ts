export interface UsageRecord {
    id: string;
    tenantId: string;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
    requestId: string;
    createdAt: Date;
}
export interface UsageAggregate {
    tenantId: string;
    providerId: string;
    modelId: string;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostCents: number;
    periodStart: Date;
    periodEnd: Date;
}
export interface UsageQuery {
    tenantId?: string;
    providerId?: string;
    modelId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
}
/**
 * Tracks usage in Redis (real-time counters) and PostgreSQL (persistent history).
 *
 * Redis keys:
 *   usage:rt:{tenantId}:{providerId}:{modelId}   -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:rt:{tenantId}:global                    -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:daily:{tenantId}:{yyyy-mm-dd}           -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:monthly:{tenantId}:{yyyy-mm}            -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 */
export declare class UsageTracker {
    private static readonly RT_PREFIX;
    private static readonly DAILY_PREFIX;
    private static readonly MONTHLY_PREFIX;
    private static readonly DEFAULT_TTL_SECONDS;
    /**
     * Record a single request's usage. Writes to Redis counters and persists to PostgreSQL.
     */
    record(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<UsageRecord>;
    /**
     * Get real-time usage from Redis for a specific tenant/provider/model.
     * Falls back to PostgreSQL if Redis has no data.
     */
    getRealtimeUsage(tenantId: string, providerId?: string, modelId?: string): Promise<{
        requests: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        costCents: number;
    }>;
    /**
     * Get daily usage from Redis fast path, with PostgreSQL fallback.
     */
    getDailyUsage(tenantId: string, date: Date): Promise<UsageAggregate | null>;
    /**
     * Get monthly usage from Redis fast path, with PostgreSQL fallback.
     */
    getMonthlyUsage(tenantId: string, year: number, month: number): Promise<UsageAggregate | null>;
    /**
     * Query historical usage records from PostgreSQL.
     */
    queryRecords(query: UsageQuery): Promise<UsageRecord[]>;
    /**
     * Aggregate usage from PostgreSQL grouped by provider and model.
     */
    aggregateByDimensions(tenantId: string, from: Date, to: Date): Promise<UsageAggregate[]>;
    /**
     * Aggregate raw records from PostgreSQL for a time window.
     */
    private aggregateFromPostgres;
    /**
     * Reset real-time Redis counters for a tenant (e.g. on period rollover).
     */
    resetRealtimeCounters(tenantId: string): Promise<void>;
    private mapRow;
    private formatDay;
    private formatMonth;
    private startOfDay;
    private endOfDay;
}
export declare const usageTracker: UsageTracker;
//# sourceMappingURL=usage-tracker.d.ts.map