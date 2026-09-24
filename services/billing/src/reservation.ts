/**
 * Budget Reservation / Reconciliation — Issue #15 P0 Economics.
 *
 * Atomic reserve → dispatch → commit → release lifecycle for budget
 * allocations. Mirrors the quota capacity reservation pattern but for
 * economic budgets (cents/credits).
 */

export type ReservationStatus = 'reserved' | 'committed' | 'released' | 'expired';

export interface BudgetReservation {
  id: string;
  tenantId: string;
  amountCents: number;
  status: ReservationStatus;
  reservedAt: number;
  committedAt?: number;
  releasedAt?: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

export interface ReservationResult {
  success: boolean;
  reservation?: BudgetReservation;
  reason?: string;
}

export interface BudgetReservationStore {
  create(tenantId: string, amountCents: number, ttlMs: number): Promise<ReservationResult>;
  commit(id: string, actualCents: number): Promise<{ adjusted: number } | null>;
  release(id: string): Promise<boolean>;
  get(id: string): Promise<BudgetReservation | null>;
  getActiveForTenant(tenantId: string): Promise<BudgetReservation[]>;
}

export class InMemoryBudgetStore implements BudgetReservationStore {
  private reservations = new Map<string, BudgetReservation>();
  private balances = new Map<string, number>();

  constructor(initialBalances?: Record<string, number>) {
    if (initialBalances) {
      for (const [tenant, balance] of Object.entries(initialBalances)) {
        this.balances.set(tenant, balance);
      }
    }
  }

  setBalance(tenantId: string, cents: number): void {
    this.balances.set(tenantId, cents);
  }

  getBalance(tenantId: string): number {
    return this.balances.get(tenantId) ?? 0;
  }

  async create(tenantId: string, amountCents: number, ttlMs: number): Promise<ReservationResult> {
    const current = this.balances.get(tenantId) ?? 0;
    if (current < amountCents) {
      return { success: false, reason: 'insufficient_budget' };
    }
    this.balances.set(tenantId, current - amountCents);

    const now = Date.now();
    const reservation: BudgetReservation = {
      id: `bres_${now}_${Math.random().toString(36).slice(2, 9)}`,
      tenantId,
      amountCents,
      status: 'reserved',
      reservedAt: now,
      expiresAt: now + ttlMs,
    };
    this.reservations.set(reservation.id, reservation);
    return { success: true, reservation };
  }

  async commit(id: string, actualCents: number): Promise<{ adjusted: number } | null> {
    const res = this.reservations.get(id);
    if (!res) return null;
    if (res.status !== 'reserved') return null;

    res.status = 'committed';
    res.committedAt = Date.now();

    // Reconcile: if actual < reserved, return the difference
    const diff = res.amountCents - actualCents;
    if (diff > 0) {
      const bal = this.balances.get(res.tenantId) ?? 0;
      this.balances.set(res.tenantId, bal + diff);
    }

    return { adjusted: diff };
  }

  async release(id: string): Promise<boolean> {
    const res = this.reservations.get(id);
    if (!res) return false;
    if (res.status !== 'reserved') return false;

    res.status = 'released';
    res.releasedAt = Date.now();

    // Return full reserved amount since it was never consumed
    const bal = this.balances.get(res.tenantId) ?? 0;
    this.balances.set(res.tenantId, bal + res.amountCents);

    return true;
  }

  async get(id: string): Promise<BudgetReservation | null> {
    return this.reservations.get(id) ?? null;
  }

  async getActiveForTenant(tenantId: string): Promise<BudgetReservation[]> {
    return [...this.reservations.values()].filter(
      (r) => r.tenantId === tenantId && r.status === 'reserved',
    );
  }
}

export async function reserveAndDispatch<T>(
  store: BudgetReservationStore,
  tenantId: string,
  amountCents: number,
  ttlMs: number,
  dispatch: () => Promise<T>,
  actualCostCents: (result: T) => number,
): Promise<{ result: T; reservationId: string; overageCents: number }> {
  const reservation = await store.create(tenantId, amountCents, ttlMs);
  if (!reservation.success || !reservation.reservation) {
    throw new Error(reservation.reason ?? 'reservation_failed');
  }

  try {
    const result = await dispatch();
    const actual = actualCostCents(result);
    await store.commit(reservation.reservation.id, actual);
    return {
      result,
      reservationId: reservation.reservation.id,
      overageCents: Math.max(0, actual - amountCents),
    };
  } catch (err) {
    await store.release(reservation.reservation.id);
    throw err;
  }
}
