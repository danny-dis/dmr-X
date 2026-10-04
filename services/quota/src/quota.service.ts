import crypto from 'node:crypto';

import { QuotaExhaustedError } from '@dmr-x/core';
import type { CandidateSet } from '@dmr-x/core';
import { getDb, createNamespacedCache } from '@dmr-x/db';
import { PROVIDER_CATALOG } from '@dmr-x/provider-catalog';
import { logger } from '@dmr-x/utils';

import { creditService } from '@dmr-x/billing';

import {
  CapacityManager,
  InMemoryCapacityStore,
  type CapacityReservation,
  type CapacityStore,
  type ReservationResult,
} from './capacity-manager.js';
import type { DemandVector, QuotaVector } from './quota-dimensions.js';
import {
  incReservationsAttempted,
  incReservationsSucceeded,
  incReservationsFailed,
} from './free-inference-metrics.js';


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

type AllocationPeriod = 'hourly' | 'daily' | 'monthly';

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

export class QuotaService {
  private capacityStore: CapacityStore = new InMemoryCapacityStore();
  private capacityManager: CapacityManager = new CapacityManager({
    store: this.capacityStore,
  });

  /**
   * Inject a shared CapacityStore (SQLite/Redis for multi-instance) and
   * rebind the manager to it. Single-node defaults to InMemory.
   */
  configureCapacityStore(store: CapacityStore, leaseMs?: number): void {
    this.capacityStore = store;
    this.capacityManager = new CapacityManager({
      store,
      ...(leaseMs !== undefined ? { leaseMs } : {}),
    });
  }

  getCapacityManager(): CapacityManager {
    return this.capacityManager;
  }

  registerQuotaVector(vector: QuotaVector): void {
    this.capacityManager.registerVector(vector);
  }

  /**
   * Atomic reserve→dispatch→reconcile path (Issue #16 Task 1).
   *
   * Call `reserveForDispatch()` before dispatch instead of read-then-check
   * (`filterByQuota` + `checkQuota`), then `commitDispatch()` on success or
   * `releaseDispatch()` on failure. The store's `tryReserve` is atomic — it
   * succeeds entirely or fails entirely, so N concurrent gateways cannot all
   * observe the same remaining quota and oversubscribe it.
   */
  async reserveForDispatch(
    providerId: string,
    modelId: string,
    keyId: string,
    request: unknown,
  ): Promise<ReservationResult> {
    incReservationsAttempted();
    const result = await this.capacityManager.reserve(providerId, modelId, keyId, request);
    if (result.success) {
      incReservationsSucceeded();
    } else {
      incReservationsFailed();
    }
    return result;
  }

  async commitDispatch(reservationId: string, actualUsage: DemandVector): Promise<void> {
    await this.capacityManager.commit(reservationId, actualUsage);
  }

  async releaseDispatch(reservationId: string): Promise<void> {
    await this.capacityManager.release(reservationId);
  }

  /**
   * Convenience wrapper: reserve → execute → commit/release.
   * `estimateActual` converts the provider response into actual usage for
   * reconciliation; when omitted the manager refunds the reservation delta
   * from the request estimate.
   */
  async dispatchWithReservation<T>(
    providerId: string,
    modelId: string,
    keyId: string,
    request: unknown,
    execute: (reservation: CapacityReservation) => Promise<T>,
    estimateActual?: (result: T) => DemandVector,
  ): Promise<T> {
    const reserved = await this.reserveForDispatch(providerId, modelId, keyId, request);
    if (!reserved.success || !reserved.reservation) {
      throw new QuotaExhaustedError();
    }
    const reservation = reserved.reservation;
    try {
      const result = await execute(reservation);
      const actual: DemandVector = estimateActual
        ? estimateActual(result)
        : { requests: 1, inputTokens: 0, outputTokens: 0, concurrency: 1 };
      await this.commitDispatch(reservation.id, actual);
      return result;
    } catch (err) {
      await this.releaseDispatch(reservation.id);
      throw err;
    }
  }

  /**
   * Durable tenant-budget hold for agent runs (admission SEC-002).
   *
   * `dispatchWithReservation` above guards PROVIDER capacity, not the
   * tenant/company budget. These holds guard the tenant budget instead:
   * `reserveAgentRun` atomically checks allocations + outstanding holds and
   * inserts a hold row in ONE synchronous SQLite transaction (BEGIN IMMEDIATE),
   * so N concurrent gateways cannot all observe the same remaining quota and
   * oversubscribe it. The reservation itself records NO usage — `settle`
   * records the measured actuals exactly once, `release` records nothing.
   * Holds are tenant-bound and expire (bounded TTL) so a crashed gateway can
   * never pin quota forever.
   */
  async reserveAgentRun(
    tenantId: string,
    providerKey: string,
    estimatedTokens: number,
    estimatedCostCents: number,
    opts?: { requestId?: string; ttlMs?: number; modelId?: string },
  ): Promise<{ ok: boolean; holdId?: string; reason?: string; status?: number }> {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS agent_quota_holds (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      provider_key TEXT NOT NULL DEFAULT 'agent',
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_quota_holds_tenant
      ON agent_quota_holds(tenant_id, expires_at)`);

    // Bounded TTL: default 10 min, clamped to [30s, 30min].
    const ttlMs = Math.min(Math.max(opts?.ttlMs ?? 10 * 60 * 1000, 30_000), 30 * 60 * 1000);
    const expiresIso = new Date(Date.now() + ttlMs).toISOString();
    const holdId = crypto.randomUUID();
    const key = providerKey && providerKey.length > 0 ? providerKey : 'agent';
    const wantTokens = Math.max(0, Math.floor(finiteNonNegative(estimatedTokens, 'estimated tokens')));
    const wantCents = Math.max(0, Math.round(finiteNonNegative(estimatedCostCents, 'estimated cost')));
    const wantDollars = wantCents / 100;

    // ONE synchronous transaction (better-sqlite3): no awaits between BEGIN
    // and COMMIT, so concurrent gateways serialize on the DB write lock and
    // cannot all observe the same remaining quota. Everything read here
    // (holds, allocations, cache usage, credits) is synchronous.
    try {
      // NOTE: DatabaseWrapper.transaction(fn) executes immediately (it is
      // NOT the better-sqlite3 curried form) — everything inside stays
      // synchronous between BEGIN and COMMIT.
      db.transaction(() => {
        const nowIso = new Date().toISOString();
        db.prepare(`DELETE FROM agent_quota_holds WHERE expires_at <= ?`).run(nowIso);
        const held = db.prepare(
          `SELECT COUNT(*) AS requests,
                  COALESCE(SUM(estimated_tokens), 0) AS tokens,
                  COALESCE(SUM(estimated_cost_cents), 0) AS cents
           FROM agent_quota_holds WHERE tenant_id = ? AND expires_at > ?`,
        ).get(tenantId, nowIso) as { requests: number; tokens: number; cents: number };
        const heldForScope = (providerScope: string | null) => {
          const params: unknown[] = [tenantId, nowIso];
          const providerClause = providerScope && providerScope !== 'agent'
            ? ' AND provider_key = ?'
            : '';
          if (providerClause) params.push(providerScope);
          return db.prepare(
            `SELECT COUNT(*) AS requests,
                    COALESCE(SUM(estimated_tokens), 0) AS tokens,
                    COALESCE(SUM(estimated_cost_cents), 0) AS cents
             FROM agent_quota_holds
             WHERE tenant_id = ? AND expires_at > ?${providerClause}`,
          ).get(...params) as { requests: number; tokens: number; cents: number };
        };

        // Credit balance is a hard spending limit: outstanding + estimate.
        if (wantCents > 0) {
          const creditCheck = creditService.checkSufficientCredits(tenantId, held.cents + wantCents);
          if (!creditCheck.sufficient) {
            throw new QuotaExhaustedError();
          }
        }

        const rows = db.prepare(
          `SELECT id, tenant_id, provider_id, max_requests, max_tokens, max_cost, period
           FROM quota_allocations WHERE tenant_id = ?`,
        ).all(tenantId) as any[];
        for (const row of rows) {
          const pid: string | null = row.provider_id ?? null;
          if (pid && pid !== key && pid !== 'agent') continue;
          const providerScope = pid && pid !== 'agent' ? pid : null;
          const period: AllocationPeriod = row.period === 'hourly' || row.period === 'daily'
            ? row.period
            : 'monthly';
          const usage = this.readDurableUsage(
            db,
            tenantId,
            providerScope,
            this.getPeriodStart(period),
            this.getPeriodEnd(period),
          );
          const heldInScope = heldForScope(providerScope);
          const requests = usage.requests;
          const tokens = usage.tokens;
          const cost = usage.costDollars;
          if (row.max_requests != null && requests + heldInScope.requests + 1 > row.max_requests) {
            throw new QuotaExhaustedError();
          }
          if (row.max_tokens != null && tokens + heldInScope.tokens + wantTokens > row.max_tokens) {
            throw new QuotaExhaustedError();
          }
          const maxCost = row.max_cost != null ? parseFloat(row.max_cost) : undefined;
          if (maxCost != null && cost + heldInScope.cents / 100 + wantDollars > maxCost) {
            throw new QuotaExhaustedError();
          }
        }

        // Free-tier model budgets are part of admission, not only candidate
        // filtering. Read durable usage so another gateway process cannot spend
        // the same daily/monthly allowance after this process loses its cache.
        if (wantCents === 0 && opts?.modelId) {
          const freeTier = PROVIDER_CATALOG
            .find((provider) => provider.id === key)
            ?.models.find((model) => model.id === opts.modelId)
            ?.freeTier;
          if (freeTier) {
            const providerHeld = heldForScope(key);
            const monthly = this.readDurableUsage(db, tenantId, key, this.getPeriodStart('monthly'), this.getPeriodEnd('monthly'));
            const daily = this.readDurableUsage(db, tenantId, key, this.getPeriodStart('daily'), this.getPeriodEnd('daily'));
            const monthlyLimit = freeTier.monthlyTokenBudget ?? 0;
            const dailyLimit = freeTier.dailyTokenBudget ?? 0;
            const dailyTokenLimit = freeTier.rateLimits.tpd ?? 0;
            const dailyRequestLimit = freeTier.rateLimits.rpd ?? 0;
            if (monthlyLimit > 0 && monthly.tokens + wantTokens + providerHeld.tokens > monthlyLimit) {
              throw new QuotaExhaustedError();
            }
            if (dailyLimit > 0 && daily.tokens + wantTokens + providerHeld.tokens > dailyLimit) {
              throw new QuotaExhaustedError();
            }
            if (dailyTokenLimit > 0 && daily.tokens + wantTokens + providerHeld.tokens > dailyTokenLimit) {
              throw new QuotaExhaustedError();
            }
            if (dailyRequestLimit > 0 && daily.requests + providerHeld.requests + 1 > dailyRequestLimit) {
              throw new QuotaExhaustedError();
            }
          }
        }

        db.prepare(
          `INSERT INTO agent_quota_holds
             (id, tenant_id, provider_key, estimated_tokens, estimated_cost_cents, request_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(holdId, tenantId, key, wantTokens, wantCents, opts?.requestId ?? null, expiresIso);
      });
      return { ok: true, holdId };
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        logger.warn({ tenantId, wantTokens, wantCents }, 'Agent quota hold rejected');
        return { ok: false, reason: 'quota/budget admission rejected: quota exceeded', status: 429 };
      }
      logger.warn({ tenantId, err }, 'Agent quota hold unavailable — failing closed');
      return { ok: false, reason: 'quota/budget admission rejected: quota service unavailable', status: 429 };
    }
  }

  /**
   * Release a hold WITHOUT recording usage (failure path). Never throws for
   * a missing/expired hold — expiry cleanup is idempotent by design.
   */
  async releaseAgentHold(holdId: string): Promise<void> {
    try {
      getDb().prepare(`DELETE FROM agent_quota_holds WHERE id = ?`).run(holdId);
    } catch {
      /* release is best-effort; expiry bounds the damage */
    }
  }

  /**
   * Settle a hold with MEASURED actuals (success path, incl. resume).
   * The settlement ledger and paid credit debit share one synchronous SQLite
   * transaction on the first attempt. If an older process already committed a
   * settlement before its debit failed, retrying debits the canonical amount
   * stored in that settlement row.
   */
  async settleAgentHold(
    holdId: string,
    actual: { tokens: number; costDollars: number },
    context?: { tenantId: string; providerKey: string; modelId?: string; promptTokens?: number; completionTokens?: number },
  ): Promise<void> {
    const db = getDb();
    const tokens = Math.floor(finiteNonNegative(actual.tokens, 'actual usage'));
    const costDollars = finiteNonNegative(actual.costDollars, 'actual usage');
    let settled: {
      tenantId: string;
      providerKey: string;
      modelId: string;
      tokens: number;
      costDollars: number;
    } | undefined;
    let isNewSettlement = false;

    try {
      const existing = db.prepare(
        `SELECT tenant_id, provider_key, model_id, actual_tokens, actual_cost_dollars
         FROM agent_quota_settlements WHERE hold_id = ?`,
      ).get(holdId) as {
        tenant_id: string;
        provider_key: string;
        model_id: string;
        actual_tokens: number;
        actual_cost_dollars: number;
      } | undefined;

      if (existing) {
        // Retries must use the durable ledger values, not changed response
        // arguments that could waive or duplicate the original spend.
        settled = {
          tenantId: existing.tenant_id,
          providerKey: existing.provider_key,
          modelId: existing.model_id,
          tokens: Number(existing.actual_tokens),
          costDollars: Number(existing.actual_cost_dollars),
        };
      } else {
        const row = db.prepare(
          `SELECT tenant_id, provider_key FROM agent_quota_holds WHERE id = ?`,
        ).get(holdId) as { tenant_id: string; provider_key: string } | undefined;
        const tenantId = row?.tenant_id ?? context?.tenantId;
        if (!tenantId) throw new Error('agent quota settlement requires tenant context');
        const providerKey = row?.provider_key || context?.providerKey || 'agent';
        const modelId = context?.modelId || providerKey;
        const persist = (): void => {
          db.prepare(
            `INSERT INTO agent_quota_settlements
               (hold_id, tenant_id, provider_key, model_id, actual_tokens, actual_cost_dollars)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(holdId, tenantId, providerKey, modelId, tokens, costDollars);
          db.prepare(`DELETE FROM agent_quota_holds WHERE id = ?`).run(holdId);
          this.insertDurableUsage(db, tenantId, providerKey, modelId, tokens, costDollars, holdId, context?.promptTokens);
          settled = { tenantId, providerKey, modelId, tokens, costDollars };
        };

        // CreditService invokes persist inside its own transaction. This keeps
        // the debit, claim, settlement, hold deletion, and usage rows atomic.
        if (costDollars > 0) {
          const debited = creditService.deductUsage(
            tenantId,
            Math.round(costDollars * 100),
            holdId,
            persist,
          );
          if (!debited) throw new Error('agent credit debit rejected');
        } else {
          db.transaction(persist);
        }
        isNewSettlement = true;
      }
    } catch (err) {
      logger.warn({ holdId, err }, 'Agent quota settlement unavailable');
      throw err;
    }

    if (!settled) throw new Error('agent quota settlement did not produce a ledger row');

    // Recover debits committed by the pre-transaction implementation. The
    // durable settlement row is authoritative for every retry.
    if (!isNewSettlement && settled.costDollars > 0) {
      const debited = creditService.deductUsage(
        settled.tenantId,
        Math.round(settled.costDollars * 100),
        holdId,
      );
      if (!debited) throw new Error('agent credit debit rejected');
    }

    if (isNewSettlement) {
      this.incrementQuotaCache(settled.tenantId, settled.providerKey, settled.tokens, settled.costDollars);
      await this.recordProviderBudgetUsage(settled.tenantId, settled.providerKey, settled.tokens);
    }
  }

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

  private getPeriodStart(period: AllocationPeriod): string {
    const now = new Date();
    if (period === 'hourly') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();
    }
    if (period === 'daily') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  private getPeriodEnd(period: AllocationPeriod): string {
    const now = new Date();
    if (period === 'hourly') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1).toISOString();
    }
    if (period === 'daily') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    }
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }

  private readDurableUsage(
    db: ReturnType<typeof getDb>,
    tenantId: string,
    providerId: string | null,
    from: string,
    to: string | null,
  ): { requests: number; tokens: number; costDollars: number } {
    const conditions = ['tenant_id = ?', 'created_at >= ?'];
    const params: unknown[] = [tenantId, from];
    if (providerId) {
      conditions.push('provider_id = ?');
      params.push(providerId);
    }
    if (to) {
      conditions.push('created_at < ?');
      params.push(to);
    }
    const row = db.prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM usage_records WHERE ${conditions.join(' AND ')}`,
    ).get(...params) as { requests: number; tokens: number; cost_cents: number };
    return {
      requests: Number(row?.requests ?? 0),
      tokens: Number(row?.tokens ?? 0),
      costDollars: Number(row?.cost_cents ?? 0) / 100,
    };
  }

  private insertDurableUsage(
    db: ReturnType<typeof getDb>,
    tenantId: string,
    providerId: string,
    modelId: string,
    tokens: number,
    costDollars: number,
    requestId: string | null,
    promptTokens?: number,
  ): void {
    const inputTokens = promptTokens === undefined ? 0 : Math.min(tokens, Math.floor(finiteNonNegative(promptTokens, 'prompt usage')));
    db.prepare(
      `INSERT INTO usage_records
         (id, tenant_id, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_cents, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      tenantId,
      providerId,
      modelId,
      inputTokens,
      tokens - inputTokens,
      tokens,
      Math.round(costDollars * 100),
      requestId,
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO billing_records (id, tenant_id, request_id, amount, description)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      tenantId,
      requestId,
      costDollars,
      `Usage: ${tokens} tokens via ${providerId}`,
    );
  }

  private incrementQuotaCache(tenantId: string, providerId: string, tokens: number, costDollars: number): void {
    const key = `${tenantId}:${providerId}`;
    quotaCache.hIncrBy(key, 'requests', 1);
    quotaCache.hIncrBy(key, 'tokens', tokens);
    quotaCache.hIncrBy(key, 'cost', Math.round(costDollars));
    quotaCache.expire(key, 30 * 24 * 60 * 60);
  }

  /**
   * Get accumulated token usage for a provider's free-tier budget (current month).
   *
   * The cache remains the fast path for explicit budget adjustments. Normal
   * request usage falls back to SQLite, so another gateway instance or a cache
   * eviction cannot make an exhausted budget look unused.
   */
  async getProviderBudgetUsage(tenantId: string, providerId: string, keyId?: string): Promise<number> {
    const periodKey = this.getCurrentMonthKey();
    const key = keyId
      ? `${tenantId}:${providerId}:${keyId}:${periodKey}`
      : `${tenantId}:${providerId}:${periodKey}`;
    const cached = budgetCache.get(key);
    const cachedTokens = Math.max(0, Number.parseInt(cached || '0', 10) || 0);
    // Credential-specific adjustments lack a durable per-key attribution column.
    if (keyId) return cachedTokens;
    const durableTokens = this.readDurableUsage(getDb(), tenantId, providerId, this.getPeriodStart('monthly'), this.getPeriodEnd('monthly')).tokens;
    return Math.max(cachedTokens, durableTokens);
  }

  /**
   * List per-key budget usage for a provider (current month).
   * Each entry is the token usage recorded against one credential bucket.
   */
  async getProviderKeyBudgets(
    tenantId: string,
    providerId: string
  ): Promise<Array<{ keyId: string; usage: number }>> {
    const periodKey = this.getCurrentMonthKey();
    const prefix = `${tenantId}:${providerId}:`;
    const suffix = `:${periodKey}`;
    const out: Array<{ keyId: string; usage: number }> = [];
    for (const key of budgetCache.keysByPrefix(prefix)) {
      if (key.length <= prefix.length + suffix.length) continue; // provider-wide bucket, not per-key
      if (!key.endsWith(suffix)) continue;
      out.push({
        keyId: key.slice(prefix.length, key.length - suffix.length),
        usage: parseInt(budgetCache.get(key) || '0'),
      });
    }
    return out;
  }

  /**
   * Get the next budget reset time (start of next calendar month).
   */
  getNextBudgetReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  /**
   * Get current month key in YYYY-MM format.
   */
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Record usage against a provider's free-tier monthly budget.
   * Period-aware: resets counter at the start of each calendar month.
   * When `keyId` is provided the usage is recorded per-key; otherwise it falls
   * back to the legacy provider-wide bucket.
   */
  async recordProviderBudgetUsage(
    tenantId: string,
    providerId: string,
    tokens: number,
    keyId?: string
  ): Promise<void> {
    const periodKey = this.getCurrentMonthKey();
    const key = keyId
      ? `${tenantId}:${providerId}:${keyId}:${periodKey}`
      : `${tenantId}:${providerId}:${periodKey}`;
    budgetCache.incrBy(key, tokens);
    // Expire at end of month + 7 days grace
    budgetCache.expire(key, 37 * 24 * 60 * 60);
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
    const db = getDb();
    const normalizedTokens = Math.max(0, Math.floor(tokens));
    const normalizedCost = Math.max(0, cost);
    this.incrementQuotaCache(tenantId, providerId, normalizedTokens, normalizedCost);
    db.transaction(() => {
      this.insertDurableUsage(
        db,
        tenantId,
        providerId,
        providerId,
        normalizedTokens,
        normalizedCost,
        null,
      );
    });

    // Deduct from credit balance if cost > 0
    if (normalizedCost > 0) {
      creditService.deductUsage(tenantId, Math.round(normalizedCost * 100));
    }

    // Check budget alerts asynchronously (fire-and-forget)
    this.checkBudgetAlerts(tenantId, providerId).catch(() => {});
  }

  /**
   * Check if usage has crossed alert thresholds and log warnings.
   * Thresholds: 80% (warning), 95% (critical), 100% (exhausted).
   */
  private async checkBudgetAlerts(tenantId: string, providerId: string): Promise<void> {
    try {
      const allocations = await this.getAllocations(tenantId);
      for (const allocation of allocations) {
        if (allocation.providerId && allocation.providerId !== providerId) continue;

        const usage = await this.getUsage(tenantId, allocation);

        // Check each limit dimension
        const checks: Array<{ limit?: number; used: number; label: string }> = [
          { limit: allocation.maxTokens, used: usage.tokens, label: 'tokens' },
          { limit: allocation.maxRequests, used: usage.requests, label: 'requests' },
          { limit: allocation.maxCost, used: usage.cost, label: 'cost' },
        ];

        for (const { limit, used, label } of checks) {
          if (!limit || limit <= 0) continue;
          const percent = (used / limit) * 100;

          if (percent >= 100) {
            logger.warn(
              { tenantId, providerId, limit, used, label, percent: Math.round(percent) },
              `Budget EXHAUSTED: ${label} limit reached`
            );
          } else if (percent >= 95) {
            logger.warn(
              { tenantId, providerId, limit, used, label, percent: Math.round(percent) },
              `Budget CRITICAL: ${label} at ${Math.round(percent)}%`
            );
          } else if (percent >= 80) {
            logger.info(
              { tenantId, providerId, limit, used, label, percent: Math.round(percent) },
              `Budget WARNING: ${label} at ${Math.round(percent)}%`
            );
          }
        }
      }
    } catch {
      // Don't let alert checking break the request path
    }
  }

  /**
   * Check if a request would exceed quota (including credit balance)
   */
  async checkQuota(
    tenantId: string,
    providerId: string,
    estimatedTokens: number,
    estimatedCost: number
  ): Promise<void> {
    // Check credit balance first (hard spending limit)
    if (estimatedCost > 0) {
      const creditCheck = creditService.checkSufficientCredits(tenantId, Math.round(estimatedCost * 100));
      if (!creditCheck.sufficient) {
        logger.warn(
          { tenantId, required: estimatedCost, available: creditCheck.balance / 100 },
          'Insufficient credit balance'
        );
        throw new QuotaExhaustedError();
      }
    }

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
