import { getPool, getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

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
export class UsageTracker {
  private static readonly RT_PREFIX = 'usage:rt:';
  private static readonly DAILY_PREFIX = 'usage:daily:';
  private static readonly MONTHLY_PREFIX = 'usage:monthly:';
  private static readonly DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

  /**
   * Record a single request's usage. Writes to Redis counters and persists to PostgreSQL.
   */
  async record(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<UsageRecord> {
    const redis = getRedis();
    const pool = getPool();

    const now = new Date();
    const dayKey = this.formatDay(now);
    const monthKey = this.formatMonth(now);

    // 1. Increment Redis real-time counters
    const rtKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:${record.providerId}:${record.modelId}`;
    const globalKey = `${UsageTracker.RT_PREFIX}${record.tenantId}:global`;
    const dailyKey = `${UsageTracker.DAILY_PREFIX}${record.tenantId}:${dayKey}`;
    const monthlyKey = `${UsageTracker.MONTHLY_PREFIX}${record.tenantId}:${monthKey}`;

    const pipeline = redis.multi();

    for (const key of [rtKey, globalKey, dailyKey, monthlyKey]) {
      pipeline.hIncrBy(key, 'requests', 1);
      pipeline.hIncrBy(key, 'inputTokens', record.inputTokens);
      pipeline.hIncrBy(key, 'outputTokens', record.outputTokens);
      pipeline.hIncrBy(key, 'totalTokens', record.totalTokens);
      pipeline.hIncrBy(key, 'costCents', record.costCents);
      pipeline.expire(key, UsageTracker.DEFAULT_TTL_SECONDS);
    }

    await pipeline.exec();

    // 2. Persist to PostgreSQL
    const result = await pool.query(
      `INSERT INTO usage_records
         (tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at`,
      [
        record.tenantId,
        record.providerId,
        record.modelId,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
        record.costCents,
        record.requestId,
        now,
      ]
    );

    const row = result.rows[0];

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
   * Get real-time usage from Redis for a specific tenant/provider/model.
   * Falls back to PostgreSQL if Redis has no data.
   */
  async getRealtimeUsage(
    tenantId: string,
    providerId?: string,
    modelId?: string
  ): Promise<{ requests: number; inputTokens: number; outputTokens: number; totalTokens: number; costCents: number }> {
    const redis = getRedis();

    const key = providerId && modelId
      ? `${UsageTracker.RT_PREFIX}${tenantId}:${providerId}:${modelId}`
      : `${UsageTracker.RT_PREFIX}${tenantId}:global`;

    const [requests, inputTokens, outputTokens, totalTokens, costCents] = await Promise.all([
      redis.hGet(key, 'requests').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'inputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'outputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'totalTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'costCents').then((v) => parseInt(v || '0', 10)),
    ]);

    return { requests, inputTokens, outputTokens, totalTokens, costCents };
  }

  /**
   * Get daily usage from Redis fast path, with PostgreSQL fallback.
   */
  async getDailyUsage(tenantId: string, date: Date): Promise<UsageAggregate | null> {
    const redis = getRedis();
    const dayKey = this.formatDay(date);
    const key = `${UsageTracker.DAILY_PREFIX}${tenantId}:${dayKey}`;

    const [requests, inputTokens, outputTokens, totalTokens, costCents] = await Promise.all([
      redis.hGet(key, 'requests').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'inputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'outputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'totalTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'costCents').then((v) => parseInt(v || '0', 10)),
    ]);

    if (requests === 0) {
      // Redis expired or empty, aggregate from PostgreSQL
      return this.aggregateFromPostgres(tenantId, this.startOfDay(date), this.endOfDay(date));
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
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get monthly usage from Redis fast path, with PostgreSQL fallback.
   */
  async getMonthlyUsage(tenantId: string, year: number, month: number): Promise<UsageAggregate | null> {
    const redis = getRedis();
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const key = `${UsageTracker.MONTHLY_PREFIX}${tenantId}:${monthStr}`;

    const [requests, inputTokens, outputTokens, totalTokens, costCents] = await Promise.all([
      redis.hGet(key, 'requests').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'inputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'outputTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'totalTokens').then((v) => parseInt(v || '0', 10)),
      redis.hGet(key, 'costCents').then((v) => parseInt(v || '0', 10)),
    ]);

    if (requests === 0) {
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
      return this.aggregateFromPostgres(tenantId, periodStart, periodEnd);
    }

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

    return {
      tenantId,
      providerId: '*',
      modelId: '*',
      totalRequests: requests,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      totalTokens,
      totalCostCents: costCents,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Query historical usage records from PostgreSQL.
   */
  async queryRecords(query: UsageQuery): Promise<UsageRecord[]> {
    const pool = getPool();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (query.tenantId) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      params.push(query.tenantId);
    }
    if (query.providerId) {
      conditions.push(`provider_id = $${paramIndex++}`);
      params.push(query.providerId);
    }
    if (query.modelId) {
      conditions.push(`model_id = $${paramIndex++}`);
      params.push(query.modelId);
    }
    if (query.from) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(query.from);
    }
    if (query.to) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(query.to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const result = await pool.query(
      `SELECT id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at
       FROM usage_records
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Aggregate usage from PostgreSQL grouped by provider and model.
   */
  async aggregateByDimensions(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<UsageAggregate[]> {
    const pool = getPool();

    const result = await pool.query(
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
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at <= $3
       GROUP BY tenant_id, provider_id, model_id
       ORDER BY total_cost_cents DESC`,
      [tenantId, from, to]
    );

    return result.rows.map((row) => ({
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
   * Aggregate raw records from PostgreSQL for a time window.
   */
  private async aggregateFromPostgres(
    tenantId: string,
    from: Date,
    to: Date
  ): Promise<UsageAggregate | null> {
    const pool = getPool();

    const result = await pool.query(
      `SELECT
         COUNT(*)           AS total_requests,
         SUM(input_tokens)  AS total_input_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(total_tokens)  AS total_tokens,
         SUM(cost_cents)    AS total_cost_cents
       FROM usage_records
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at <= $3`,
      [tenantId, from, to]
    );

    const row = result.rows[0];
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
      periodStart: from,
      periodEnd: to,
    };
  }

  /**
   * Reset real-time Redis counters for a tenant (e.g. on period rollover).
   */
  async resetRealtimeCounters(tenantId: string): Promise<void> {
    const redis = getRedis();

    // Scan and delete all usage:rt:{tenantId}:* keys
    const pattern = `${UsageTracker.RT_PREFIX}${tenantId}:*`;
    let cursor = 0;
    do {
      const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      const keys = result.keys;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== 0);

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
      createdAt: row.created_at as Date,
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
