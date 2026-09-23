/**
 * QuotaVector builder and snapshot evaluator.
 *
 * Builds a QuotaVector from multiple sources (headers, learned limits, catalog)
 * and evaluates it against a DemandVector to produce a QuotaSnapshot for the
 * scheduler.
 */

import {
  QuotaVector,
  QuotaDimension,
  QuotaSnapshot,
  QuotaUnit,
  QuotaState,
  DemandVector,
  QuotaScope,
  ReplenishmentModel,
  evaluateState,
  hasHeadroom,
  isStale,
  computeTokenBucketRemaining,
  defaultStaleAfterMs,
} from './quota-dimensions.js';

export {
  QuotaVector,
  QuotaDimension,
  QuotaSnapshot,
  QuotaUnit,
  QuotaState,
  DemandVector,
  QuotaScope,
  ReplenishmentModel,
  isStale,
  hasHeadroom,
  evaluateState,
  computeTokenBucketRemaining,
  defaultStaleAfterMs,
};

interface BuildDimensionParams {
  unit: QuotaUnit;
  scope: QuotaScope;
  scopeId: string;
  limit: number | null;
  remaining: number | null;
  replenishment?: ReplenishmentModel;
  resetAtMs?: number | null;
  state?: QuotaState;
  confidence?: number;
  observedAtMs?: number;
  staleAfterMs?: number;
}

/**
 * Construct a QuotaDimension with sensible defaults.
 */
export function buildDimension(params: BuildDimensionParams): QuotaDimension {
  const now = Date.now();
  return {
    unit: params.unit,
    scope: params.scope,
    scopeId: params.scopeId,
    limit: params.limit,
    remaining: params.remaining,
    replenishment: params.replenishment ?? 'unknown',
    resetAtMs: params.resetAtMs ?? null,
    state: params.state ?? 'unknown',
    confidence: params.confidence ?? (params.limit !== null ? 0.8 : 0.0),
    observedAtMs: params.observedAtMs ?? now,
    staleAfterMs: params.staleAfterMs ?? defaultStaleAfterMs(),
  };
}

interface BuildVectorParams {
  providerId: string;
  modelId: string;
  keyId: string;
  dimensions: QuotaDimension[];
}

/**
 * Assemble a complete QuotaVector from constituent dimensions.
 */
export function buildVector(params: BuildVectorParams): QuotaVector {
  const lastObs = params.dimensions.reduce(
    (max, d) => Math.max(max, d.observedAtMs),
    0,
  );
  return {
    providerId: params.providerId,
    modelId: params.modelId,
    keyId: params.keyId,
    dimensions: params.dimensions,
    lastObservedAtMs: lastObs,
  };
}

/**
 * Evaluate a QuotaVector against a requested demand.
 *
 * Produces a QuotaSnapshot that tells the scheduler whether to route, wait,
 * failover, or reject. The evaluation is conservative:
 * - any required dimension that is not 'available' blocks routing
 * - for 'free_only', unknown/stale dimensions count as blocking
 * - retryAtMs is derived from the earliest reset/cool-down expiry
 */
export function evaluateVector(
  vector: QuotaVector,
  demand: DemandVector,
  nowMs: number = Date.now(),
): QuotaSnapshot {
  const blocking: QuotaDimension[] = [];
  let estimatedRemaining: number | null = null;
  let retryAtMs: number | null = null;

  const requiredDimensions = selectDimensionsForDemand(vector, demand);

  for (const dim of requiredDimensions) {
    const effectiveState = evaluateState(dim, nowMs);

    // Token-bucket: recompute remaining for freshness
    const remaining = dim.replenishment === 'token_bucket'
      ? computeTokenBucketRemaining(dim, nowMs)
      : dim.remaining;

    if (effectiveState !== 'available') {
      blocking.push({ ...dim, state: effectiveState });

      // Derive retry time from reset or stale threshold
      const dimRetry = deriveRetryTime(dim, nowMs);
      if (dimRetry !== null && (retryAtMs === null || dimRetry < retryAtMs)) {
        retryAtMs = dimRetry;
      }
      continue;
    }

    if (remaining !== null) {
      const headroom = remaining - demandForUnit(demand, dim.unit);
      if (headroom < 0) {
        blocking.push(dim);
        const dimRetry = deriveRetryTime(dim, nowMs);
        if (dimRetry !== null && (retryAtMs === null || dimRetry < retryAtMs)) {
          retryAtMs = null;
        }
        continue;
      }
      if (estimatedRemaining === null || headroom < estimatedRemaining) {
        estimatedRemaining = headroom;
      }
    }
  }

  const admissible = blocking.length === 0;
  const reason = admissible
    ? `All ${requiredDimensions.length} dimensions have headroom`
    : blockingExplanation(blocking, nowMs);

  let recommendation: QuotaSnapshot['recommendation'] = 'route';
  if (!admissible) {
    if (retryAtMs !== null && retryAtMs > nowMs) {
      recommendation = 'wait';
    } else if (retryAtMs === null && blocking.some(d => d.state === 'unknown')) {
      recommendation = 'failover';
    } else {
      recommendation = 'failover';
    }
  }

  return {
    providerId: vector.providerId,
    modelId: vector.modelId,
    keyId: vector.keyId,
    admissible,
    blockingDimensions: blocking,
    estimatedRemaining,
    recommendation,
    retryAtMs,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function selectDimensionsForDemand(
  vector: QuotaVector,
  demand: DemandVector,
): QuotaDimension[] {
  const units: QuotaUnit[] = ['concurrency'];
  if (demand.requests > 0) units.push('requests');
  if (demand.inputTokens > 0) units.push('input_tokens');
  if (demand.outputTokens > 0) units.push('output_tokens');
  if (demand.credits && demand.credits > 0) units.push('credits');
  return vector.dimensions.filter(d => units.includes(d.unit));
}

function demandForUnit(demand: DemandVector, unit: QuotaUnit): number {
  switch (unit) {
    case 'requests': return demand.requests;
    case 'input_tokens': return demand.inputTokens;
    case 'output_tokens': return demand.outputTokens;
    case 'total_tokens': return demand.inputTokens + demand.outputTokens;
    case 'concurrency': return demand.concurrency;
    case 'credits': return demand.credits ?? 0;
    default: return 0;
  }
}

function deriveRetryTime(dim: QuotaDimension, nowMs: number): number | null {
  if (dim.resetAtMs !== null && dim.resetAtMs > nowMs) {
    return dim.resetAtMs;
  }
  if (dim.state === 'stale' || dim.state === 'unknown') {
    // Stale data: retry after a fresh probe window
    return dim.observedAtMs + dim.staleAfterMs;
  }
  return null;
}

function blockingExplanation(blocking: QuotaDimension[], nowMs: number): string {
  const parts = blocking.map(d => {
    const stale = isStale(d, nowMs) ? ' (stale)' : '';
    const remaining = d.remaining === null ? 'unknown' : String(d.remaining);
    return `${d.unit}/${d.scope}=${d.scopeId}:${d.state}${stale}, remaining=${remaining}`;
  });
  return `Blocked on ${parts.join('; ')}`;
}
