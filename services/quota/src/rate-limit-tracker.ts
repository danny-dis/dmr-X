/**
 * Rate Limit Tracker for DMR-X
 *
 * Tracks real-time rate limit state from provider responses.
 * Integrates with the base adapter to extract headers after each request.
 */

import { getDb } from '@dmr-x/db';
import { createLogger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import { parseRateLimitHeaders, calculateQuotaStatus, type RateLimitHeaders, type KeyQuotaStatus } from './dynamic-limits.js';

// Re-export KeyQuotaStatus for consumers
export type { KeyQuotaStatus } from './dynamic-limits.js';

const logger = createLogger('quota:rate-limit-tracker');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackRateLimitParams {
  keyId: string;
  providerId: string;
  modelId?: string;
  response: Response;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface GetQuotaStatusParams {
  keyId: string;
  providerId: string;
  modelId?: string;
}

// ---------------------------------------------------------------------------
// Rate Limit Tracker
// ---------------------------------------------------------------------------

export class RateLimitTracker {
  /**
   * Track rate limit headers from a successful response
   */
  trackResponse(params: TrackRateLimitParams): KeyQuotaStatus | null {
    const { keyId, providerId, modelId, response, tokenUsage } = params;

    try {
      // Parse headers
      const headers = parseRateLimitHeaders(response.headers, providerId);
      
      // Check if we got any rate limit data
      if (headers.requestsLimit === undefined && headers.tokensLimit === undefined) {
        return null;
      }

      // Calculate quota status
      const status = calculateQuotaStatus({
        keyId,
        providerId,
        modelId,
        headers,
      });

      // Store in database
      this.updateKeyUsage({
        keyId,
        providerId,
        modelId,
        headers,
        tokenUsage,
      });

      // Log significant changes
      if (status.percentRemaining < 10) {
        logger.warn({
          keyId: keyId.slice(0, 8) + '...',
          providerId,
          modelId,
          percentRemaining: status.percentRemaining,
          requestsRemaining: status.requestsRemaining,
          tokensRemaining: status.tokensRemaining,
        }, 'Rate limit nearly exhausted');
      }

      return status;
    } catch (error) {
      logger.debug({ error, providerId }, 'Failed to track rate limit headers');
      return null;
    }
  }

  /**
   * Get current quota status for a key
   */
  getQuotaStatus(params: GetQuotaStatusParams): KeyQuotaStatus | null {
    const { keyId, providerId, modelId } = params;
    const db = getDb();

    const row = db.prepare(`
      SELECT * FROM provider_key_rate_limits
      WHERE key_id = ? AND provider_id = ? AND (model_id = ? OR (model_id IS NULL AND ? IS NULL))
    `).get(keyId, providerId, modelId || null, modelId || null) as any;

    if (!row) return null;

    // Check if the data is stale (older than 5 minutes)
    const lastUpdated = new Date(row.last_updated);
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - lastUpdated.getTime() > staleThreshold) {
      // Data is stale, return null to indicate we need fresh data
      return null;
    }

    return {
      keyId: row.key_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      requestsRemaining: row.requests_remaining,
      requestsLimit: row.requests_limit,
      tokensRemaining: row.tokens_remaining,
      tokensLimit: row.tokens_limit,
      resetAtMs: row.reset_at ? new Date(row.reset_at).getTime() : null,
      percentRemaining: this.calculatePercentRemaining(row),
      isExhausted: (row.requests_remaining !== null && row.requests_remaining <= 0) ||
                   (row.tokens_remaining !== null && row.tokens_remaining <= 0),
    };
  }

  /**
   * Get all keys with remaining quota for a provider (for smart rotation)
   */
  getKeysWithQuota(providerId: string, modelId?: string): KeyQuotaStatus[] {
    const db = getDb();

    const rows = db.prepare(`
      SELECT * FROM provider_key_rate_limits
      WHERE provider_id = ?
        AND (model_id = ? OR model_id IS NULL)
        AND last_updated > datetime('now', '-5 minutes')
      ORDER BY requests_remaining DESC NULLS LAST
    `).all(providerId, modelId || null) as any[];

    return rows.map(row => ({
      keyId: row.key_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      requestsRemaining: row.requests_remaining,
      requestsLimit: row.requests_limit,
      tokensRemaining: row.tokens_remaining,
      tokensLimit: row.tokens_limit,
      resetAtMs: row.reset_at ? new Date(row.reset_at).getTime() : null,
      percentRemaining: this.calculatePercentRemaining(row),
      isExhausted: (row.requests_remaining !== null && row.requests_remaining <= 0) ||
                   (row.tokens_remaining !== null && row.tokens_remaining <= 0),
    }));
  }

  /**
   * Record a token usage (for tracking daily aggregates)
   */
  recordTokenUsage(params: {
    keyId: string;
    providerId: string;
    modelId?: string;
    promptTokens: number;
    completionTokens: number;
  }): void {
    const db = getDb();
    const { keyId, providerId, modelId, promptTokens, completionTokens } = params;
    const totalTokens = promptTokens + completionTokens;

    // Update daily aggregates
    db.prepare(`
      INSERT INTO provider_key_rate_limits (id, key_id, provider_id, model_id, requests_today, tokens_today, last_updated)
      VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
      ON CONFLICT(key_id, model_id) DO UPDATE SET
        requests_today = requests_today + 1,
        tokens_today = tokens_today + ?,
        last_request_at = datetime('now'),
        last_updated = datetime('now')
    `).run(crypto.randomUUID(), keyId, providerId, modelId || null, totalTokens, totalTokens);
  }

  /**
   * Reset daily aggregates (called at midnight)
   */
  resetDailyAggregates(): void {
    const db = getDb();
    db.prepare(`
      UPDATE provider_key_rate_limits
      SET requests_today = 0, tokens_today = 0
      WHERE last_request_at < date('now')
    `).run();
  }

  /**
   * Learn a new limit from error messages
   */
  learnLimitFromError(params: {
    keyId: string;
    providerId: string;
    modelId?: string;
    limit: number;
    axis: 'rpm' | 'tpm' | 'rpd' | 'tpd';
  }): void {
    const db = getDb();
    const { keyId, providerId, modelId, limit, axis } = params;

    // Only lower limits, never raise them
    const column = `learned_${axis}`;
    
    // Check current learned limit
    const current = db.prepare(`
      SELECT ${column} FROM provider_key_rate_limits
      WHERE key_id = ? AND (model_id = ? OR (model_id IS NULL AND ? IS NULL))
    `).get(keyId, modelId || null, modelId || null) as any;

    if (current && current[column] !== null && current[column] <= limit) {
      // Current limit is already lower or equal, don't update
      return;
    }

    // Update learned limit
    db.prepare(`
      INSERT INTO provider_key_rate_limits (id, key_id, provider_id, model_id, ${column}, last_updated)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key_id, model_id) DO UPDATE SET
        ${column} = ?,
        last_updated = datetime('now')
    `).run(crypto.randomUUID(), keyId, providerId, modelId || null, limit, limit);

    // Log discovery
    db.prepare(`
      INSERT INTO rate_limit_discovery_log (id, key_id, provider_id, model_id, discovery_method, new_limit, limit_type)
      VALUES (?, ?, ?, ?, 'error_message', ?, ?)
    `).run(crypto.randomUUID(), keyId, providerId, modelId || null, limit, axis);

    logger.info({
      keyId: keyId.slice(0, 8) + '...',
      providerId,
      modelId,
      axis,
      limit,
    }, 'Learned new rate limit from error');
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private updateKeyUsage(params: {
    keyId: string;
    providerId: string;
    modelId?: string;
    headers: RateLimitHeaders;
    tokenUsage?: { promptTokens?: number; completionTokens?: number };
  }): void {
    const db = getDb();
    const { keyId, providerId, modelId, headers, tokenUsage } = params;

    const requestsLimit = headers.requestsLimit ?? null;
    const requestsRemaining = headers.requestsRemaining ?? null;
    const tokensLimit = headers.tokensLimit ?? null;
    const tokensRemaining = headers.tokensRemaining ?? null;
    const resetAt = headers.requestsResetMs
      ? new Date(headers.requestsResetMs).toISOString()
      : null;

    // Upsert the rate limit state
    db.prepare(`
      INSERT INTO provider_key_rate_limits 
        (id, key_id, provider_id, model_id, requests_limit, requests_remaining, requests_reset_at,
         tokens_limit, tokens_remaining, tokens_reset_at, last_updated, last_request_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(key_id, model_id) DO UPDATE SET
        requests_limit = COALESCE(?, requests_limit),
        requests_remaining = COALESCE(?, requests_remaining),
        requests_reset_at = COALESCE(?, requests_reset_at),
        tokens_limit = COALESCE(?, tokens_limit),
        tokens_remaining = COALESCE(?, tokens_remaining),
        tokens_reset_at = COALESCE(?, tokens_reset_at),
        last_updated = datetime('now'),
        last_request_at = datetime('now')
    `).run(
      crypto.randomUUID(), keyId, providerId, modelId || null,
      requestsLimit, requestsRemaining, resetAt,
      tokensLimit, tokensRemaining, resetAt,
      requestsLimit, requestsRemaining, resetAt,
      tokensLimit, tokensRemaining, resetAt
    );

    // Update daily aggregates if token usage provided
    if (tokenUsage) {
      const totalTokens = (tokenUsage.promptTokens ?? 0) + (tokenUsage.completionTokens ?? 0);
      if (totalTokens > 0) {
        db.prepare(`
          UPDATE provider_key_rate_limits
          SET requests_today = requests_today + 1,
              tokens_today = tokens_today + ?
          WHERE key_id = ? AND (model_id = ? OR (model_id IS NULL AND ? IS NULL))
        `).run(totalTokens, keyId, modelId || null, modelId || null);
      }
    }
  }

  private calculatePercentRemaining(row: any): number {
    let percent = 100;
    
    if (row.requests_limit !== null && row.requests_remaining !== null) {
      percent = Math.min(percent, (row.requests_remaining / row.requests_limit) * 100);
    }
    if (row.tokens_limit !== null && row.tokens_remaining !== null) {
      percent = Math.min(percent, (row.tokens_remaining / row.tokens_limit) * 100);
    }
    
    return Math.max(0, Math.min(100, percent));
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: RateLimitTracker | null = null;

export function getRateLimitTracker(): RateLimitTracker {
  if (!instance) {
    instance = new RateLimitTracker();
  }
  return instance;
}
