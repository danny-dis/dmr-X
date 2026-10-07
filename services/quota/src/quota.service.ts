import crypto from 'node:crypto';

import { QuotaExhaustedError } from '@dmr-x/core';
import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
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
import { buildQuotaPoolId, type DemandVector, type QuotaVector } from './quota-dimensions.js';
import { buildDimension, buildVector } from './quota-vector.js';
import { SQLiteCapacityStore } from './capacity-store-distributed.js';
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

export interface BeginInferenceOptions {
  requestId?: string;
  /** Caller has already accounted for tenant budget/debit (trusted agent context). */
  externalAccounting?: boolean;
  /** Concurrency limit for the administrative upstream bulkhead (default 4). */
  concurrencyLimit?: number;
  keyId?: string;
}

export interface InferenceAttemptHandle {
  settle(response: UnifiedResponse): Promise<void>;
  release(): Promise<void>;
}

/** Canonical price in DOLLARS per 1000 tokens. */
export interface InferencePrice {
  inputPer1k: number;
  outputPer1k: number;
  maxOutputTokens: number | null;
}

export interface InferenceEstimate {
  promptTokens: number;
  outputTokens: number;
  costDollars: number;
}

type AllocationPeriod =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'rolling_24h'
  | 'rolling_7d'
  | 'rolling_30d';

const ROLLING_PERIOD_MS: Partial<Record<AllocationPeriod, number>> = {
  rolling_24h: 24 * 60 * 60 * 1000,
  rolling_7d: 7 * 24 * 60 * 60 * 1000,
  rolling_30d: 30 * 24 * 60 * 60 * 1000,
};

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

export class QuotaService {
  private capacityStore: CapacityStore = new SQLiteCapacityStore();
  private capacityManager: CapacityManager = new CapacityManager({
    store: this.capacityStore,
  });

  /**
   * Inject a shared CapacityStore (SQLite/Redis for multi-instance) and
   * rebind the manager to it. SQLite is the production default; tests may
   * explicitly inject an in-memory store.
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
   * Admission for one inference attempt, BEFORE the provider is dispatched to.
   *
   * Two independent gates must both pass:
   *  1. provider capacity — a concurrency bulkhead over the upstream pool, and
   *  2. tenant budget — a durable `agent_quota_holds` row (skipped only when
   *     `externalAccounting` says the caller has already accounted for it).
   *
   * If either fails, the other side is released first and this throws
   * `QuotaExhaustedError`, so a rejected attempt can never leak a concurrency
   * slot or pin tenant quota.
   *
   * The returned handle is idempotent: repeated `settle` calls share one
   * promise (one ledger row, one debit), and `release` is safe to call again.
   */
  async beginInferenceAttempt(
    tenantId: string | undefined,
    providerId: string,
    modelId: string,
    request: UnifiedRequest,
    options?: BeginInferenceOptions,
  ): Promise<InferenceAttemptHandle> {
    const externalAccounting = options?.externalAccounting === true;
    const keyId = options?.keyId ?? 'dispatch';

    // Canonical price (dollars per 1000 tokens) + conservative estimate.
    // Ordinary tenants FAIL CLOSED on a missing/invalid price: without it the
    // dispatch cannot be priced, and dispatching anyway would spend unpriced
    // credit. `externalAccounting` skips only tenant accounting, so it may run
    // unpriced — provider capacity is still required below.
    const price = this.readInferencePrice(providerId, modelId);
    const estimate = this.estimateInferenceAttempt(request, price);
    if (!externalAccounting && tenantId) {
      if (!price) {
        logger.warn({ providerId, modelId }, 'No valid canonical price for model — failing closed');
        throw new QuotaExhaustedError();
      }
    }

    // --- Gate 1: tenant budget hold (durable, retryable) ---------------------
    let holdId: string | undefined;
    if (!externalAccounting && tenantId) {
      const estimatedCostCents = estimate.costDollars * 100;
      const hold = await this.reserveAgentRun(
        tenantId,
        providerId,
        estimate.promptTokens + estimate.outputTokens,
        estimatedCostCents,
        { ...(options?.requestId ? { requestId: options.requestId } : {}), modelId },
      );
      if (!hold.ok || !hold.holdId) {
        throw new QuotaExhaustedError();
      }
      holdId = hold.holdId;
    }

    // --- Gate 2: provider capacity (always required) -------------------------
    const reservation = await this.reserveProviderCapacity(providerId, modelId, keyId, request, options?.concurrencyLimit);
    if (!reservation) {
      // Release the other side before failing: no leaked hold.
      if (holdId) await this.releaseAgentHold(holdId);
      throw new QuotaExhaustedError();
    }

    // Keep the lease (and the agent hold) alive for as long as the stream runs.
    const startedAtMs = Date.now();
    const stopKeepalive = this.startAttemptKeepalive(reservation.id, holdId, startedAtMs);

    let settlePromise: Promise<void> | undefined;
    let releasePromise: Promise<void> | undefined;
    let settlementStarted = false;
    let settled = false;
    let releaseStarted = false;
    let lastSettlementError: unknown;
    let actual: ReturnType<QuotaService['actualInferenceUsage']> | undefined;

    const settle = (response: UnifiedResponse): Promise<void> => {
      if (settlePromise) return settlePromise;
      if (releaseStarted) return Promise.reject(new Error('Cannot settle a released inference attempt'));
      if (settled) return Promise.resolve();
      settlementStarted = true;
      actual ??= this.actualInferenceUsage(response, estimate, price);
      const measured = actual;
      settlePromise = (async () => {
        let tenantError: unknown;
        try {
          if (!externalAccounting && tenantId && holdId) {
            await this.settleAgentHold(
              holdId,
              { tokens: measured.totalTokens, costDollars: measured.costDollars },
              { tenantId, providerKey: providerId, modelId, promptTokens: measured.promptTokens },
            );
          }
        } catch (err) {
          // Preserve the tenant liability, but meter real upstream consumption
          // even when the tenant's debit needs retrying after a top-up.
          tenantError = err;
        }
        await this.commitDispatch(reservation.id, measured.demand);
        if (tenantError) throw tenantError;
        settled = true;
      })().catch((err: unknown) => {
        lastSettlementError = err;
        // Concurrent callers share this attempt; later calls can retry a
        // rejected settlement. The durable ledger makes the retry exactly-once.
        settlePromise = undefined;
        throw err;
      }).finally(stopKeepalive);
      return settlePromise;
    };

    const release = (): Promise<void> => {
      if (settled) return Promise.resolve();
      if (settlementStarted) {
        return settlePromise ?? Promise.reject(lastSettlementError ?? new Error('Inference settlement requires retry'));
      }
      if (releasePromise) return releasePromise;
      releaseStarted = true;
      releasePromise = (async () => {
        stopKeepalive();
        await this.releaseDispatch(reservation.id);
        if (holdId) await this.releaseAgentHold(holdId);
      })().catch((err: unknown) => {
        releasePromise = undefined;
        throw err;
      });
      return releasePromise;
    };

    return { settle, release };
  }

  /**
   * Provider capacity gate for one attempt.
   *
   * A registered vector is authoritative and is never overwritten. When the
   * manager exposes no vector for this tuple we register a clearly
   * ADMINISTRATIVE upstream concurrency-only vector: a local bulkhead that
   * bounds how many dispatches we put in flight per provider. It deliberately
   * measures nothing else — it is not a claim of free token or credit
   * entitlement, and its pool identity is shared across the provider's models.
   */
  private async reserveProviderCapacity(
    providerId: string,
    modelId: string,
    keyId: string,
    request: unknown,
    concurrencyLimit: number | undefined,
  ): Promise<CapacityReservation | null> {
    const manager = this.capacityManager as CapacityManager & {
      getVector?: (providerId: string, modelId: string, keyId: string) => QuotaVector | undefined;
    };
    if (typeof manager.getVector === 'function') {
      const registered = manager.getVector(providerId, modelId, keyId);
      if (!registered) {
        this.registerUpstreamBulkheadVector(providerId, modelId, keyId, concurrencyLimit);
      }
    }

    let result = await this.reserveForDispatch(providerId, modelId, keyId, request);
    if (!result.success && !result.reservation && this.isMissingVectorReason(result.reason)) {
      // Older CapacityManager (no getVector): the failed reservation itself is
      // the authoritative "no vector registered" signal. A vector that exists
      // but is exhausted produces a different reason and is never bypassed.
      this.registerUpstreamBulkheadVector(providerId, modelId, keyId, concurrencyLimit);
      result = await this.reserveForDispatch(providerId, modelId, keyId, request);
    }

    return result.success && result.reservation ? result.reservation : null;
  }

  private isMissingVectorReason(reason: string | undefined): boolean {
    return typeof reason === 'string' && reason.includes('No quota vector registered');
  }

  /**
   * Register the administrative upstream concurrency bulkhead.
   * `configuredLimit` defaults to 4 concurrent dispatches per provider pool.
   */
  private registerUpstreamBulkheadVector(
    providerId: string,
    modelId: string,
    keyId: string,
    configuredLimit: number | undefined,
  ): void {
    const limit =
      configuredLimit !== undefined && Number.isFinite(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : 4;
    const vector = buildVector({
      providerId,
      modelId,
      keyId,
      // Shared across every model of this provider: one upstream pool.
      poolId: buildQuotaPoolId(providerId, 'upstream', providerId),
      dimensions: [
        buildDimension({
          unit: 'concurrency',
          scope: 'upstream',
          scopeId: providerId,
          limit,
          remaining: limit,
          state: 'available',
          confidence: 1,
          replenishment: 'unknown',
          observedAtMs: Date.now(),
          staleAfterMs: Number.POSITIVE_INFINITY,
        }),
      ],
    });
    this.capacityManager.registerVector(vector);
  }

  /**
   * Bounded keep-alive for an active attempt: renews the capacity lease so a
   * long stream cannot lose its 30s lease mid-flight, and refreshes the agent
   * hold's expiry (never past 30 minutes from admission). Unref'd so it never
   * keeps the process alive.
   */
  private startAttemptKeepalive(reservationId: string, holdId: string | undefined, startedAtMs: number): () => void {
    const intervalMs = 10_000; // well under the 30s lease
    const timer = setInterval(() => {
      try {
        const manager = this.capacityManager as CapacityManager & { renew?: (id: string) => unknown };
        if (typeof manager.renew === 'function') manager.renew(reservationId);
      } catch (err) {
        logger.warn({ reservationId, err }, 'Capacity lease renew failed');
      }
      if (holdId) {
        try {
          const bounded = new Date(Math.min(Date.now() + 30 * 60 * 1000, startedAtMs + 30 * 60 * 1000)).toISOString();
          getDb().prepare('UPDATE agent_quota_holds SET expires_at = ? WHERE id = ?').run(bounded, holdId);
        } catch (err) {
          logger.warn({ holdId, err }, 'Agent hold keepalive refresh failed');
        }
      }
    }, intervalMs);
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(timer);
    return () => clearInterval(timer);
  }

  /** Canonical model price: DOLLARS per 1000 tokens, from `model_profiles`. */
  private readInferencePrice(providerId: string, modelId: string): InferencePrice | null {
    try {
      const row = getDb().prepare(
        `SELECT input_cost_per_1k, output_cost_per_1k, max_output_tokens
         FROM model_profiles WHERE provider_id = ? AND model_id = ?`,
      ).get(providerId, modelId) as {
        input_cost_per_1k: number | null;
        output_cost_per_1k: number | null;
        max_output_tokens: number | null;
      } | undefined;
      if (!row) return null;
      if (row.input_cost_per_1k == null || row.output_cost_per_1k == null) return null;
      const inputPer1k = Number(row.input_cost_per_1k);
      const outputPer1k = Number(row.output_cost_per_1k);
      if (!Number.isFinite(inputPer1k) || inputPer1k < 0) return null;
      if (!Number.isFinite(outputPer1k) || outputPer1k < 0) return null;
      const maxOutput = row.max_output_tokens == null ? null : Number(row.max_output_tokens);
      return {
        inputPer1k,
        outputPer1k,
        maxOutputTokens: maxOutput !== null && Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : null,
      };
    } catch (err) {
      logger.warn({ providerId, modelId, err }, 'Canonical price lookup failed — failing closed');
      return null;
    }
  }

  /**
   * Conservative pre-dispatch estimate.
   * Prompt covers messages AND tools; a serialized-request chars/4 allowance is
   * the floor so nothing in the payload escapes the estimate. Output is bounded
   * by request.max_tokens, then the model's max_output_tokens, then 1000.
   * A positive estimate stays positive — it is never rounded to zero cents.
   */
  private estimateInferenceAttempt(request: UnifiedRequest, price: InferencePrice | null): InferenceEstimate {
    let serialized = '';
    let messagesAndTools = '';
    try {
      serialized = JSON.stringify(request ?? {}) ?? '';
      messagesAndTools = JSON.stringify({ messages: request?.messages, tools: request?.tools }) ?? '';
    } catch {
      serialized = '';
    }
    const promptTokens = Math.max(1, Math.ceil(Math.max(serialized.length, messagesAndTools.length) / 4));

    const bounds: number[] = [];
    if (typeof request?.max_tokens === 'number' && Number.isFinite(request.max_tokens) && request.max_tokens > 0) {
      bounds.push(Math.floor(request.max_tokens));
    }
    if (price?.maxOutputTokens) bounds.push(price.maxOutputTokens);
    const outputTokens = bounds.length > 0 ? Math.min(...bounds) : 1000;

    const costDollars = price ? (promptTokens * price.inputPer1k + outputTokens * price.outputPer1k) / 1000 : 0;
    return { promptTokens, outputTokens, costDollars };
  }

  /**
   * Measured actuals for `settle`.
   *
   * Real usage is authoritative wherever the response reports it. When output
   * usage is missing on a completed or partial response we charge the
   * conservative estimate — an already dispatched generation is never refunded
   * as free. Prompt-cache note: `model_profiles` has no cache price columns, so
   * the full prompt (`TokenUsage.prompt_tokens` already includes cached reads
   * and writes) is billed at the normal input rate: the ceiling for cache
   * reads, with no invented write premium.
   */
  private actualInferenceUsage(
    response: UnifiedResponse,
    estimate: InferenceEstimate,
    price: InferencePrice | null,
  ): { promptTokens: number; completionTokens: number; totalTokens: number; costDollars: number; demand: DemandVector } {
    const usage = response?.usage;
    const promptTokens =
      usage && Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens >= 0
        ? Math.floor(usage.prompt_tokens)
        : estimate.promptTokens;
    const completionTokens =
      usage && usage.completion_tokens != null && Number.isFinite(usage.completion_tokens) && usage.completion_tokens >= 0
        ? Math.floor(usage.completion_tokens)
        : estimate.outputTokens;
    const totalTokens =
      usage && Number.isFinite(usage.total_tokens) && usage.total_tokens > 0
        ? Math.floor(usage.total_tokens)
        : promptTokens + completionTokens;
    const costDollars = price
      ? (promptTokens * price.inputPer1k + completionTokens * price.outputPer1k) / 1000
      : 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      costDollars,
      demand: {
        requests: 1,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        // The request has finished: hand the concurrency slot back on commit.
        concurrency: 0,
      },
    };
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
    // Fractional cents are real money: rounding here would turn a 0.07-cent
    // estimate into 0 and admit a run without holding any budget for it.
    const wantCents = Math.max(0, finiteNonNegative(estimatedCostCents, 'estimated cost'));
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
          // Same window vocabulary as readDurableUsage: hourly/daily/weekly/
          // monthly fixed windows plus rolling_24h/7d/30d. Anything unrecognized
          // keeps the historical monthly reading.
          const period = this.coerceAllocationPeriod(row.period);
          // Allocation-bound read: a manual reset cutoff for this allocation
          // applies here, while outstanding holds (counted separately below)
          // keep counting.
          const usage = this.readDurableUsage(
            db,
            tenantId,
            providerScope,
            this.getPeriodStart(period),
            this.getPeriodEnd(period),
            row.id as string,
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
            costDollars * 100,
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
        settled.costDollars * 100,
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
      // A candidate is governed by EVERY allocation that applies to it: the
      // provider-scoped ones and the global (provider_id IS NULL) one. Picking
      // only the first match lets an exhausted provider allocation hide behind
      // a generous global one.
      const applicable = allocations.filter(
        (a) => !a.providerId || a.providerId === candidate.providerId
      );

      let exceeded = false;
      for (const allocation of applicable) {
        const usage = await this.getUsage(tenantId, allocation);

        // A zero limit is an explicit "none allowed", not "unlimited".
        if (allocation.maxRequests != null && usage.requests >= allocation.maxRequests) {
          exceeded = true;
          break;
        }
        if (allocation.maxTokens != null && usage.tokens >= allocation.maxTokens) {
          exceeded = true;
          break;
        }
        if (allocation.maxCost != null && usage.cost >= allocation.maxCost) {
          exceeded = true;
          break;
        }
      }
      if (exceeded) continue;

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

  private normalizeAllocationPeriod(period: string): AllocationPeriod {
    if (
      period !== 'hourly' &&
      period !== 'daily' &&
      period !== 'weekly' &&
      period !== 'monthly' &&
      period !== 'rolling_24h' &&
      period !== 'rolling_7d' &&
      period !== 'rolling_30d'
    ) {
      throw new Error(`Unsupported quota period: ${period}`);
    }
    return period;
  }

  private getPeriodStart(period: AllocationPeriod, now = new Date()): string {
    if (period === 'hourly') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString();
    }
    if (period === 'daily') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    }
    if (period === 'weekly') {
      // Weeks start on MONDAY in UTC — (getUTCDay() + 6) % 7 days back.
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)).toISOString();
    }
    const rollingMs = ROLLING_PERIOD_MS[period];
    if (rollingMs !== undefined) {
      return new Date(now.getTime() - rollingMs).toISOString();
    }
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }

  private getPeriodEnd(period: AllocationPeriod, now = new Date()): string | null {
    if (period === 'hourly') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)).toISOString();
    }
    if (period === 'daily') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
    }
    if (period === 'weekly') {
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday + 7)).toISOString();
    }
    // Rolling windows have no upper bound: they track "the last N", and a
    // usage row can never be newer than the read that follows it.
    if (ROLLING_PERIOD_MS[period] !== undefined) return null;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  }

  /**
   * Period lookup that never throws inside admission: an unrecognized legacy
   * period keeps its old monthly interpretation instead of failing closed on
   * the request path.
   */
  private coerceAllocationPeriod(period: string | null | undefined): AllocationPeriod {
    if (!period) return 'monthly';
    try {
      return this.normalizeAllocationPeriod(period);
    } catch {
      return 'monthly';
    }
  }

  private readDurableUsage(
    db: ReturnType<typeof getDb>,
    tenantId: string,
    providerId: string | null,
    from: string,
    to: string | null,
    allocationId?: string,
  ): { requests: number; tokens: number; costDollars: number } {
    const conditions = ['tenant_id = ?', 'julianday(created_at) >= julianday(?)'];
    const params: unknown[] = [tenantId, from];
    if (providerId) {
      conditions.push('provider_id = ?');
      params.push(providerId);
    }
    if (to) {
      conditions.push('julianday(created_at) < julianday(?)');
      params.push(to);
    }
    // A manual reset only re-bases one allocation's window. The ledger itself
    // is append-only: rows before the cutoff are still there, they simply no
    // longer count for THIS allocation. Reads without an allocation bound
    // (provider budget caches) never see a marker.
    const reset = allocationId ? this.readAllocationReset(db, allocationId) : null;
    if (reset) {
      if (reset.resetAt) {
        conditions.push('julianday(created_at) >= julianday(?)');
        params.push(reset.resetAt);
      }
      if (reset.afterRowid != null) {
        conditions.push('rowid > ?');
        params.push(reset.afterRowid);
      }
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

  /**
   * Manual reset marker for one allocation (`quota_allocation_resets`, added by
   * migration 088). Returns null when the marker table is not provisioned yet
   * or this allocation has never been reset.
   */
  private readAllocationReset(
    db: ReturnType<typeof getDb>,
    allocationId: string,
  ): { resetAt: string | null; afterRowid: number | null } | null {
    try {
      const table = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'quota_allocation_resets'`,
      ).get();
      if (!table) return null;
      const row = db.prepare(
        `SELECT reset_at, after_rowid FROM quota_allocation_resets WHERE allocation_id = ?`,
      ).get(allocationId) as { reset_at: string | null; after_rowid: number | null } | undefined;
      if (!row) return null;
      return { resetAt: row.reset_at ?? null, afterRowid: row.after_rowid ?? null };
    } catch {
      return null;
    }
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
      costDollars * 100,
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
   * Record usage after a request.
   *
   * The ledger rows and the paid credit debit commit together: `deductUsage`
   * runs `persist` inside the SAME SQLite transaction as the balance decrement,
   * so an insufficient balance rolls back both and this method rejects. Nothing
   * is ever recorded without being paid for, and a succeeded debit can never be
   * dropped. Costs stay in fractional cents (0.00008 dollars -> 0.008 cents);
   * rounding them to whole cents would silently waive sub-cent spend.
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
    const requestId = crypto.randomUUID();
    const costCents = normalizedCost * 100;

    const persist = (): void => {
      this.insertDurableUsage(
        db,
        tenantId,
        providerId,
        providerId,
        normalizedTokens,
        normalizedCost,
        requestId,
      );
    };

    if (costCents > 0) {
      const debited = creditService.deductUsage(tenantId, costCents, requestId, persist);
      if (!debited) {
        logger.warn(
          { tenantId, providerId, costCents },
          'Usage debit rejected — no usage or billing row recorded',
        );
        // Fail loudly: the caller must not believe this usage was accounted.
        throw new QuotaExhaustedError();
      }
    } else {
      db.transaction(persist);
    }

    this.incrementQuotaCache(tenantId, providerId, normalizedTokens, normalizedCost);

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

      // `!= null` on purpose: a stored 0 is an explicit "none allowed", and a
      // truthiness check would silently treat it as unlimited.
      if (allocation.maxRequests != null && usage.requests >= allocation.maxRequests) {
        throw new QuotaExhaustedError();
      }
      if (allocation.maxTokens != null && (allocation.maxTokens === 0 || usage.tokens + estimatedTokens > allocation.maxTokens)) {
        throw new QuotaExhaustedError();
      }
      if (allocation.maxCost != null && (allocation.maxCost === 0 || usage.cost + estimatedCost > allocation.maxCost)) {
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
      // `!= null`, not truthiness: a stored 0 cost limit means "no spend".
      maxCost: row.max_cost != null ? parseFloat(String(row.max_cost)) : undefined,
      period: row.period,
    }));
  }

  private async getUsage(tenantId: string, allocation: QuotaAllocation): Promise<QuotaUsage> {
    // Same period vocabulary (and same legacy fallback) as reserveAgentRun, so
    // admission and read-usage can never disagree about the window. A missing or
    // unrecognized period reads as monthly instead of throwing: rejecting every
    // request over a malformed label would turn a data problem into an outage.
    const period = this.coerceAllocationPeriod(allocation.period);
    const now = new Date();
    // Allocation-bound: honors this allocation's manual reset cutoff.
    const usage = this.readDurableUsage(getDb(), tenantId, allocation.providerId ?? null,
      this.getPeriodStart(period, now), this.getPeriodEnd(period, now), allocation.id);
    return { requests: usage.requests, tokens: usage.tokens, cost: usage.costDollars };
  }

  /**
   * Reset quotas for a new period.
   *
   * Writes a durable per-allocation cutoff marker instead of deleting or
   * rewriting ledger rows: `usage_records` stays append-only and every money
   * claim (credit balance, credit transactions, settlements) is untouched.
   * Outstanding holds are hold rows, not usage rows, so a pending hold keeps
   * counting against the fresh window. Marker + cache clear commit in ONE
   * transaction, so a partially applied reset cannot exist.
   */
  async resetQuotas(tenantId?: string): Promise<void> {
    const db = getDb();

    // Get all allocations
    const rows = tenantId
      ? db.prepare('SELECT * FROM quota_allocations WHERE tenant_id = ?').all(tenantId) as any[]
      : db.prepare('SELECT * FROM quota_allocations').all() as any[];

    const resetAt = new Date().toISOString();

    db.transaction(() => {
      // Fallback provisioning for trees where migration 088 has not run yet.
      // Byte-compatible with packages/db/src/migrations/088 (IF NOT EXISTS on
      // both sides), so whichever lands first owns the same shape.
      db.exec(`CREATE TABLE IF NOT EXISTS quota_allocation_resets (
        allocation_id TEXT PRIMARY KEY REFERENCES quota_allocations(id) ON DELETE CASCADE,
        reset_at TEXT NOT NULL,
        after_rowid INTEGER NOT NULL
      )`);

      const cutoff = db.prepare(
        `SELECT COALESCE(MAX(rowid), 0) AS rowid FROM usage_records`,
      ).get() as { rowid: number };

      const writeMarker = db.prepare(
        `INSERT INTO quota_allocation_resets (allocation_id, reset_at, after_rowid)
         VALUES (?, ?, ?)
         ON CONFLICT(allocation_id) DO UPDATE SET
           reset_at = excluded.reset_at,
           after_rowid = excluded.after_rowid`,
      );

      for (const allocation of rows) {
        writeMarker.run(allocation.id, resetAt, cutoff.rowid);
        const key = `${allocation.tenant_id}:${allocation.provider_id || 'global'}`;
        quotaCache.del(key);
      }
    });

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
      // `!= null`, not truthiness: a stored 0 cost limit means "no spend".
      maxCost: row.max_cost != null ? parseFloat(String(row.max_cost)) : undefined,
      period: row.period,
    };
  }
}

export const quotaService = new QuotaService();
