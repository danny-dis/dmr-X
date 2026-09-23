/**
 * Capacity reservation engine — Phase 2 of the free inference control plane.
 *
 * Sits between candidate selection and provider execution. Its job is to
 * prevent N concurrent requests from all observing the same remaining quota
 * and simultaneously selecting it (the "free-tier stampede" problem).
 *
 * Flow:
 *   candidate → estimate demand → validate every quota dimension
 *              → atomic reservation → dispatch → reconcile actual usage
 *              → release unused reservation
 *
 * See docs/DMRX-FREE-INFERENCE-IMPLEMENTATION-PLAN.md Phase 2.
 */

import {
  QuotaVector,
  QuotaDimension,
  QuotaSnapshot,
  DemandVector,
  QuotaUnit,
  buildVector,
  evaluateVector,
} from './quota-vector.js';

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

export type ReservationStatus = 'reserved' | 'committed' | 'released' | 'expired';

export interface ReservationDimension {
  unit: QuotaUnit;
  scopeId: string;
  reserved: number;
}

export interface CapacityReservation {
  id: string;
  candidateId: string;
  dimensions: ReservationDimension[];
  expiresAt: number;
  status: ReservationStatus;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Reservation result
// ---------------------------------------------------------------------------

export interface ReservationResult {
  success: boolean;
  reservation?: CapacityReservation;
  snapshot?: QuotaSnapshot;
  reason?: string;
}

// ---------------------------------------------------------------------------
// CapacityStore — pluggable backend for atomic reservations
// ---------------------------------------------------------------------------

export interface CapacityStore {
  /**
   * Atomically attempt to reserve capacity across multiple dimensions.
   * Must succeed entirely or fail entirely (no partial reservations).
   * Returns the updated remaining values, or null if any dimension cannot
   * satisfy the request.
   */
  tryReserve(
    dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }>,
  ): Promise<Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> | null>;

  /**
   * Release a reservation, returning capacity to the pool.
   */
  release(reservation: CapacityReservation): Promise<void>;

  /**
   * Commit a reservation (finalize after actual usage is known).
   * Adjusts remaining to reflect actual consumption.
   */
  commit(reservation: CapacityReservation, actualUsage: DemandVector): Promise<void>;

  /**
   * Expire reservations past their lease.
   */
  expireLeases(nowMs?: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// InMemoryCapacityStore — for tests and single-node deployments
// ---------------------------------------------------------------------------

export class InMemoryCapacityStore implements CapacityStore {
  private remaining = new Map<string, number>();

  constructor(initial?: Array<{ unit: QuotaUnit; scopeId: string; remaining: number }>) {
    if (initial) {
      for (const { unit, scopeId, remaining } of initial) {
        this.remaining.set(this.key(unit, scopeId), remaining);
      }
    }
  }

  private key(unit: QuotaUnit, scopeId: string): string {
    return `${unit}:${scopeId}`;
  }

  async tryReserve(
    dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }>,
  ): Promise<Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> | null> {
    // Phase 1: validate all dimensions can satisfy
    for (const d of dimensions) {
      const current = this.remaining.get(this.key(d.unit, d.scopeId)) ?? d.currentRemaining ?? 0;
      if (current < d.amount) {
        return null;
      }
    }
    // Phase 2: apply all decrements
    const result: Array<{ unit: QuotaUnit; scopeId: string; newRemaining: number }> = [];
    for (const d of dimensions) {
      const current = this.remaining.get(this.key(d.unit, d.scopeId)) ?? d.currentRemaining ?? 0;
      const newRemaining = current - d.amount;
      this.remaining.set(this.key(d.unit, d.scopeId), newRemaining);
      result.push({ unit: d.unit, scopeId: d.scopeId, newRemaining });
    }
    return result;
  }

  async release(reservation: CapacityReservation): Promise<void> {
    for (const d of reservation.dimensions) {
      const key = this.key(d.unit, d.scopeId);
      const current = this.remaining.get(key) ?? 0;
      this.remaining.set(key, current + d.reserved);
    }
  }

  async commit(reservation: CapacityReservation, actualUsage: DemandVector): Promise<void> {
    // Release the full reservation, then deduct actual usage
    for (const d of reservation.dimensions) {
      const key = this.key(d.unit, d.scopeId);
      const current = this.remaining.get(key) ?? 0;
      const actual = actualForUnit(actualUsage, d.unit);
      // We already reserved d.reserved; actual may be less. Return the difference.
      const refund = d.reserved - actual;
      this.remaining.set(key, current + refund);
    }
  }

  async expireLeases(_nowMs?: number): Promise<number> {
    // InMemory store doesn't track lease expiry; managed by CapacityManager
    return 0;
  }

  getRemaining(unit: QuotaUnit, scopeId: string): number | undefined {
    return this.remaining.get(this.key(unit, scopeId));
  }
}

function actualForUnit(actual: DemandVector, unit: QuotaUnit): number {
  switch (unit) {
    case 'requests': return actual.requests;
    case 'input_tokens': return actual.inputTokens;
    case 'output_tokens': return actual.outputTokens;
    case 'total_tokens': return actual.inputTokens + actual.outputTokens;
    case 'concurrency': return actual.concurrency;
    case 'credits': return actual.credits ?? 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// CapacityManager
// ---------------------------------------------------------------------------

export interface CapacityManagerConfig {
  store: CapacityStore;
  /** Reservation lease duration in ms (default: 30s) */
  leaseMs?: number;
  /** Demand estimator function */
  estimateDemand?: (request: unknown) => DemandVector;
}

export class CapacityManager {
  private readonly store: CapacityStore;
  private readonly leaseMs: number;
  private readonly estimateDemand: (request: unknown) => DemandVector;
  private readonly reservations = new Map<string, CapacityReservation>();
  private readonly vectors = new Map<string, QuotaVector>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: CapacityManagerConfig) {
    this.store = config.store;
    this.leaseMs = config.leaseMs ?? 30_000;
    this.estimateDemand = config.estimateDemand ?? defaultEstimateDemand;
  }

  /**
   * Register a QuotaVector for a candidate so the manager can look up
   * current remaining capacity when reserving.
   */
  registerVector(vector: QuotaVector): void {
    const key = this.candidateKey(vector.providerId, vector.modelId, vector.keyId);
    this.vectors.set(key, vector);
  }

  /**
   * Attempt to reserve capacity for a candidate.
   *
   * 1. Evaluates the vector against estimated demand
   * 2. If admissible, atomically reserves capacity across all dimensions
   * 3. Returns a ReservationResult with the reservation or failure reason
   */
  async reserve(
    providerId: string,
    modelId: string,
    keyId: string,
    request: unknown,
  ): Promise<ReservationResult> {
    const demand = this.estimateDemand(request);
    const candidateId = this.candidateKey(providerId, modelId, keyId);
    const vector = this.vectors.get(candidateId);

    if (!vector) {
      return { success: false, reason: `No quota vector registered for ${candidateId}` };
    }

    // Evaluate admissibility
    const snapshot = evaluateVector(vector, demand);
    if (!snapshot.admissible) {
      return { success: false, snapshot, reason: snapshot.reason };
    }

    // Build reservation dimensions from the vector
    const reservationDims = this.buildReservationDimensions(vector, demand);
    if (reservationDims.length === 0) {
      return { success: false, reason: 'No dimensions to reserve' };
    }

    // Attempt atomic reservation
    const reserved = await this.store.tryReserve(reservationDims);
    if (!reserved) {
      return { success: false, reason: 'Atomic reservation failed (race condition or stale data)' };
    }

    // Create reservation record
    const reservation: CapacityReservation = {
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      candidateId,
      dimensions: reservationDims.map((d, i) => ({
        unit: d.unit,
        scopeId: d.scopeId,
        reserved: d.amount,
      })),
      expiresAt: Date.now() + this.leaseMs,
      status: 'reserved',
      createdAt: Date.now(),
    };

    this.reservations.set(reservation.id, reservation);
    return { success: true, reservation };
  }

  /**
   * Commit a reservation after the request completes successfully.
   * Reconciles actual usage against the reservation.
   */
  async commit(reservationId: string, actualUsage: DemandVector): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    if (reservation.status !== 'reserved') return;

    await this.store.commit(reservation, actualUsage);
    reservation.status = 'committed';
    this.reservations.delete(reservationId);
  }

  /**
   * Release a reservation without committing (e.g. on error or cancellation).
   * Returns all reserved capacity to the pool.
   */
  async release(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    if (reservation.status !== 'reserved') return;

    await this.store.release(reservation);
    reservation.status = 'released';
    this.reservations.delete(reservationId);
  }

  /**
   * Start periodic sweep to expire orphaned reservations.
   */
  startSweep(intervalMs: number = 10_000): void {
    if (this.sweepInterval) return;
    this.sweepInterval = setInterval(() => {
      this.sweep();
    }, intervalMs);
  }

  /**
   * Stop the sweep interval.
   */
  stopSweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /**
   * Get the current reservation count (for observability).
   */
  getReservationCount(): number {
    return this.reservations.size;
  }

  /**
   * Get a reservation by id.
   */
  getReservation(id: string): CapacityReservation | undefined {
    return this.reservations.get(id);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private candidateKey(providerId: string, modelId: string, keyId: string): string {
    return `${providerId}:${modelId}:${keyId}`;
  }

  private buildReservationDimensions(
    vector: QuotaVector,
    demand: DemandVector,
  ): Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }> {
    const dims: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }> = [];

    for (const dim of vector.dimensions) {
      const amount = estimateForUnit(demand, dim.unit);
      if (amount > 0) {
        dims.push({
          unit: dim.unit,
          scopeId: dim.scopeId,
          amount,
          currentRemaining: dim.remaining,
        });
      }
    }
    return dims;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, res] of this.reservations) {
      if (res.expiresAt < now && res.status === 'reserved') {
        this.store.release(res).catch(() => {});
        res.status = 'expired';
        this.reservations.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Default demand estimator
// ---------------------------------------------------------------------------

function defaultEstimateDemand(request: unknown): DemandVector {
  const r = request as { max_tokens?: number; messages?: unknown[] };
  const outputTokens = r.max_tokens ?? 1000;
  // Rough input estimate: ~4 chars per token
  const messages = r.messages ?? [];
  const inputChars = JSON.stringify(messages).length;
  const inputTokens = Math.ceil(inputChars / 4);
  return {
    requests: 1,
    inputTokens,
    outputTokens,
    concurrency: 1,
  };
}

function estimateForUnit(demand: DemandVector, unit: QuotaUnit): number {
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
