import { getDb, cache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';

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
  createdAt: string;
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
  periodStart: string;
  periodEnd: string;
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
 * Tracks usage in cache (real-time counters) and SQLite (persistent history).
 *
 * Cache keys:
 *   usage:rt:{tenantId}:{providerId}:{modelId}   -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:rt:{tenantId}:global                    -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:daily:{tenantId}:{yyyy-mm-dd}           -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 *   usage:monthly:{tenantId}:{yyyy-mm}            -> hash { requests, inputTokens, outputTokens, totalTokens, costCents }
 */
export class UsageTracker {
  private static readonly RT_PREFIX = 'usage:rt:';
  private static readonly DAILY_PREFIX = 'usage:daily:';
  private static readonly MONTHLY_PREFIX = 'usage:monthly:';
  private static readonly DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

  /**
   * Record a single request's usage. Writes to cache counters and persists to SQLite.
   */
  record(record: Omit<UsageRecord, 'id' | 'createdAt'>): UsageRecord {
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
    db.prepare(
      `INSERT INTO usage_records
         (id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      record.tenantId,
      record.providerId,
      record.modelId,
      record.inputTokens,
      record.outputTokens,
      record.totalTokens,
      record.costCents,
      record.requestId,
      now.toISOString(),
    );

    const row = db.prepare('SELECT * FROM usage_records WHERE id = ?').get(id) as any;

    logger.debug(
      {
        tenantId: record.tenantId,
        providerId: record.providerId,
        modelId: record.modelId,
        totalTokens: record.totalTokens,
        costCents: record.costCents,
      },
      'Recorded usage'
    );

    return this.mapRow(row);
  }

  /**
   * Get real-time usage from cache for a specific tenant/provider/model.
   * Falls back to SQLite if cache has no data.
   */
  getRealtimeUsage(
    tenantId: string,
    providerId?: string,
    modelId?: string
  ): { requests: number; inputTokens: number; outputTokens: number; totalTokens: number; costCents: number } {
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
  getDailyUsage(tenantId: string, date: Date): UsageAggregate | null {
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
  getMonthlyUsage(tenantId: string, year: number, month: number): UsageAggregate | null {
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
  queryRecords(query: UsageQuery): UsageRecord[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

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

    const rows = db.prepare(
      `SELECT id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at
       FROM usage_records
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    return (rows as any[]).map((row) => this.mapRow(row));
  }

  /**
   * Aggregate usage from SQLite grouped by provider and model.
   */
  aggregateByDimensions(
    tenantId: string,
    from: Date,
    to: Date
  ): UsageAggregate[] {
    const db = getDb();

    const rows = db.prepare(
      `SELECT
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
       ORDER BY total_cost_cents DESC`
    ).all(tenantId, from.toISOString(), to.toISOString());

    return (rows as any[]).map((row) => ({
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
  private aggregateFromDb(
    tenantId: string,
    from: Date,
    to: Date
  ): UsageAggregate | null {
    const db = getDb();

    const row = db.prepare(
      `SELECT
         COUNT(*)           AS total_requests,
         SUM(input_tokens)  AS total_input_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(total_tokens)  AS total_tokens,
         SUM(cost_cents)    AS total_cost_cents
       FROM usage_records
       WHERE tenant_id = ?
         AND created_at >= ?
         AND created_at <= ?`
    ).get(tenantId, from.toISOString(), to.toISOString()) as any;

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
  resetRealtimeCounters(tenantId: string): void {
    const db = getDb();

    // Get all unique provider/model combos for this tenant from DB
    const rows = db.prepare(
      `SELECT DISTINCT provider_id, model_id FROM usage_records WHERE tenant_id = ?`
    ).all(tenantId) as any[];

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

  private mapRow(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      totalTokens: row.total_tokens as number,
      costCents: row.cost_cents as number,
      requestId: row.request_id as string,
      createdAt: row.created_at as string,
    };
  }

  private formatDay(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  private endOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }
}

export const usageTracker = new UsageTracker();
