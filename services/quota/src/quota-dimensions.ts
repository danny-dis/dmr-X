/**
 * Canonical quota domain — Phase 1 of the free inference control plane.
 *
 * Replaces scalar quota assumptions (rpm/rpd/tpm/tpd on a flat provider+model
 * key) with dimensioned, scope-aware quota records. The design goal is to
 * distinguish explicitly between known-available, known-exhausted, unknown,
 * stale, probing, and cooling-down capacity — so that `free_only` can never
 * treat unknown/stale as unlimited.
 *
 * See docs/DMRX-FREE-INFERENCE-IMPLEMENTATION-PLAN.md Phase 1.
 */

// ---------------------------------------------------------------------------
// Scope — which entity a quota dimension applies to
// ---------------------------------------------------------------------------

export type QuotaScope =
  | 'account'
  | 'organization'
  | 'project'
  | 'key'
  | 'model'
  | 'endpoint'
  | 'upstream';

// ---------------------------------------------------------------------------
// Replenishment — how a quota window resets
// ---------------------------------------------------------------------------

export type ReplenishmentModel =
  | 'fixed_window'    // resets at a known point in time (e.g. UTC midnight)
  | 'sliding_window'  // rolling window of fixed duration
  | 'token_bucket'    // refills continuously at a known rate
  | 'unknown';        // cannot determine; assume worst case for free_only

// ---------------------------------------------------------------------------
// State — current knowledge about capacity along one dimension
// ---------------------------------------------------------------------------

export type QuotaState =
  | 'available'    // live data confirms headroom
  | 'exhausted'    // live data confirms no headroom
  | 'unknown'      // no live data ever observed
  | 'stale'        // had data but it exceeded the freshness window
  | 'probing'      // actively refreshing (a probe request is in-flight)
  | 'cooling_down'; // 429 received; waiting for reset or cooldown expiry

// ---------------------------------------------------------------------------
// Unit — what this dimension measures
// ---------------------------------------------------------------------------

export type QuotaUnit =
  | 'requests'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'concurrency'
  | 'credits'
  | 'neurons';

// ---------------------------------------------------------------------------
// QuotaDimension — a single measured axis of provider capacity
// ---------------------------------------------------------------------------

export interface QuotaDimension {
  /** What is being measured (requests, tokens, concurrency, etc.). */
  unit: QuotaUnit;

  /** Scope this limit applies to (key, model, account, etc.). */
  scope: QuotaScope;

  /** Human-readable identifier for the scoped entity (e.g. key UUID, model id). */
  scopeId: string;

  /** Published limit from catalog or headers; null if unknown. */
  limit: number | null;

  /** Remaining capacity at last observation; null if unknown. */
  remaining: number | null;

  /** How this dimension replenishes when exhausted. */
  replenishment: ReplenishmentModel;

  /** Epoch ms when this dimension next resets (null if unknown). */
  resetAtMs: number | null;

  /** Current knowledge state. */
  state: QuotaState;

  /** Confidence in [0, 1]. Higher = more trust in remaining/limit values. */
  confidence: number;

  /** Epoch ms of the last observation that updated this record. */
  observedAtMs: number;

  /** Epoch ms after which this record is considered stale. */
  staleAfterMs: number;
}

// ---------------------------------------------------------------------------
// QuotaVector — full capacity picture for one provider+key+model tuple
// ---------------------------------------------------------------------------

export interface QuotaVector {
  providerId: string;
  modelId: string;
  keyId: string;

  /** All measured dimensions for this tuple. */
  dimensions: QuotaDimension[];

  /** Epoch ms of the most recent observation across any dimension. */
  lastObservedAtMs: number;
}

// ---------------------------------------------------------------------------
// QuotaSnapshot — the evaluated view used by the scheduler/router
// ---------------------------------------------------------------------------

export interface QuotaSnapshot {
  providerId: string;
  modelId: string;
  keyId: string;

  /** True only when every required dimension is in 'available' state. */
  admissible: boolean;

  /** Dimensions that blocked admissibility (for routing traces). */
  blockingDimensions: QuotaDimension[];

  /** Estimated remaining headroom for the requested demand. */
  estimatedRemaining: number | null;

  /** Recommended next action. */
  recommendation: 'route' | 'wait' | 'failover' | 'reject';

  /** Earliest epoch ms when capacity may be available (null if unknown). */
  retryAtMs: number | null;

  /** Human-readable explanation (for routing traces / dashboard). */
  reason: string;
}

// ---------------------------------------------------------------------------
// DemandVector — estimated resource need for a single request
// ---------------------------------------------------------------------------

export interface DemandVector {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  concurrency: number;
  credits?: number;
}

// ---------------------------------------------------------------------------
// State evaluation helpers
// ---------------------------------------------------------------------------

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

/** Returns true when a dimension's observation is too old to trust. */
export function isStale(dim: QuotaDimension, nowMs: number = Date.now()): boolean {
  return nowMs - dim.observedAtMs > dim.staleAfterMs;
}

/** True if the dimension can currently absorb the requested amount. */
export function hasHeadroom(dim: QuotaDimension, amount: number): boolean {
  if (dim.state !== 'available') return false;
  if (dim.remaining === null) return false;
  return dim.remaining >= amount;
}

/**
 * Evaluate the current state of a dimension, possibly transitioning it
 * to 'stale' if the observation window has elapsed.
 */
export function evaluateState(dim: QuotaDimension, nowMs: number = Date.now()): QuotaState {
  if (isStale(dim, nowMs) && dim.state === 'available') {
    return 'stale';
  }
  return dim.state;
}

/**
 * Calculate the remaining capacity for a token-bucket dimension.
 * Returns null for other replenishment models (use .remaining directly).
 */
export function computeTokenBucketRemaining(dim: QuotaDimension, nowMs: number = Date.now()): number | null {
  if (dim.replenishment !== 'token_bucket') return dim.remaining;
  if (dim.limit === null || dim.remaining === null || dim.resetAtMs === null) return dim.remaining;

  const elapsed = (nowMs - dim.observedAtMs) / 1000;
  const refillRate = dim.limit / ((dim.resetAtMs - dim.observedAtMs) / 1000);
  const refilled = Math.min(dim.limit, dim.remaining + elapsed * refillRate);
  return Math.round(refilled);
}

/** Freshness window used when none is explicitly provided. */
export function defaultStaleAfterMs(): number {
  return DEFAULT_STALE_AFTER_MS;
}
