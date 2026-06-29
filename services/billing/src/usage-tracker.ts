import crypto from 'node:crypto';

import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

const cache = createNamespacedCache('usage');

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
  /** Optional virtual key ID for per-key tracking */
  keyId?: string;
  /** Optional team ID for per-team tracking */
  teamId?: string;
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
  private static readonly RT_PREFIX = 'rt:';
  private static readonly DAILY_PREFIX = 'daily:';
  private static readonly MONTHLY_PREFIX = 'monthly:';

  /** RT keys are ephemeral — 7 days prevents unbounded growth from stale combos. */
  private static readonly RT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
  /** Daily keys: 90 days covers recent billing history. */
  private static readonly DAILY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
  /** Monthly keys: 365 days covers a full billing year. */
  private static readonly MONTHLY_TTL_SECONDS = 365 * 24 * 60 * 60; // 365 days

  /**
   * Record a single request's usage. Writes to cache counters and persists to SQLite.
   */
  async record(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<UsageRecord> {
    const db = getDb();

    const now = new Date();
    const dayKey = this.formatDay(now);
    const monthKey = this.formatMonth(now);

    // 1. Increment cache real-time counters
    const rtKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:${record.providerId}:${record.modelId}`;
    const globalKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:global`;
    const dailyKey = `${UsageTracker.DAILY_PREFIX}${record.tenantId}:${dayKey}`;
    const monthlyKey = `${UsageTracker.MONTHLY_PREFIX}${record.tenantId}:${monthKey}`;

    for (const key of [rtKey, globalKey]) {
      cache.hIncrBy(key, 'requests', 1);
      cache.hIncrBy(key, 'inputTokens', record.inputTokens);
      cache.hIncrBy(key, 'outputTokens', record.outputTokens);
      cache.hIncrBy(key, 'totalTokens', record.totalTokens);
      cache.hIncrBy(key, 'costCents', record.costCents);
      cache.expire(key, UsageTracker.RT_TTL_SECONDS);
    }
    for (const key of [dailyKey]) {
      cache.hIncrBy(key, 'requests', 1);
      cache.hIncrBy(key, 'inputTokens', record.inputTokens);
      cache.hIncrBy(key, 'outputTokens', record.outputTokens);
      cache.hIncrBy(key, 'totalTokens', record.totalTokens);
      cache.hIncrBy(key, 'costCents', record.costCents);
      cache.expire(key, UsageTracker.DAILY_TTL_SECONDS);
    }
    for (const key of [monthlyKey]) {
      cache.hIncrBy(key, 'requests', 1);
      cache.hIncrBy(key, 'inputTokens', record.inputTokens);
      cache.hIncrBy(key, 'outputTokens', record.outputTokens);
      cache.hIncrBy(key, 'totalTokens', record.totalTokens);
      cache.hIncrBy(key, 'costCents', record.costCents);
      cache.expire(key, UsageTracker.MONTHLY_TTL_SECONDS);
    }

    // 2. Persist to SQLite
    const id = crypto.randomUUID();
    const createdAt = this.formatDateTime(now);
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
      createdAt,
    );

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

    // Return the record we just built — no need to re-read from DB
    return {
      id,
      tenantId: record.tenantId,
      providerId: record.providerId,
      modelId: record.modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      totalTokens: record.totalTokens,
      costCents: record.costCents,
      requestId: record.requestId,
      createdAt,
    };
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

  /**
   * Format date as 'YYYY-MM-DD HH:MM:SS' for SQLite compatibility.
   * NOTE: This format does not include timezone information.
   * Previous code used ISO format (toISOString()). External consumers
   * parsing this field should handle both formats.
   */
  private formatDateTime(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
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

  // ── Per-Key Usage Tracking ─────────────────────────────────────────────────

  /**
   * Get aggregated usage for a specific virtual key.
   */
  getKeyUsage(keyId: string, from?: Date, to?: Date): { requests: number; tokens: number; costCents: number } {
    const db = getDb();
    const conditions = ['request_id LIKE ?'];
    const params: unknown[] = [`${keyId}:*`];

    if (from) {
      conditions.push('created_at >= ?');
      params.push(from.toISOString());
    }
    if (to) {
      conditions.push('created_at <= ?');
      params.push(to.toISOString());
    }

    const row = db.prepare(
      `SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(cost_cents), 0) as cost_cents
       FROM usage_records
       WHERE ${conditions.join(' AND ')}`
    ).get(...params) as any;

    return {
      requests: row?.requests || 0,
      tokens: row?.tokens || 0,
      costCents: row?.cost_cents || 0,
    };
  }

  /**
   * Get per-key usage breakdown for a tenant.
   */
  getKeyUsageBreakdown(tenantId: string, from: Date, to: Date): Array<{
    keyId: string;
    requests: number;
    tokens: number;
    costCents: number;
  }> {
    const db = getDb();
    // Extract key ID from request_id pattern (keyId:requestSuffix)
    const rows = db.prepare(`
      SELECT
        SUBSTR(request_id, 1, INSTR(request_id, ':') - 1) as key_id,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_cents), 0) as cost_cents
      FROM usage_records
      WHERE tenant_id = ?
        AND created_at >= ?
        AND created_at <= ?
        AND request_id LIKE '%:%'
      GROUP BY key_id
      ORDER BY cost_cents DESC
    `).all(tenantId, from.toISOString(), to.toISOString()) as any[];

    return rows.map(row => ({
      keyId: row.key_id,
      requests: row.requests,
      tokens: row.tokens,
      costCents: row.cost_cents,
    }));
  }
}

export const usageTracker = new UsageTracker();
