/**
 * Free-inference control-plane metrics — Issue #16 Task 7.
 *
 * Simple in-memory counters (no external deps so both `services/quota`
 * and `services/router` can import without cycles):
 * - reservations attempted / succeeded / failed
 * - 429s avoided (admission control rejected before dispatch)
 * - Retry-After honors
 * - free-only violations (must stay zero)
 */

export interface FreeInferenceMetricsSnapshot {
  reservationsAttempted: number;
  reservationsSucceeded: number;
  reservationsFailed: number;
  rate429Avoided: number;
  retryAfterHonors: number;
  freeOnlyViolations: number;
}

const counters: FreeInferenceMetricsSnapshot = {
  reservationsAttempted: 0,
  reservationsSucceeded: 0,
  reservationsFailed: 0,
  rate429Avoided: 0,
  retryAfterHonors: 0,
  freeOnlyViolations: 0,
};

export function incReservationsAttempted(by = 1): void {
  counters.reservationsAttempted += by;
}

export function incReservationsSucceeded(by = 1): void {
  counters.reservationsSucceeded += by;
}

export function incReservationsFailed(by = 1): void {
  counters.reservationsFailed += by;
}

export function inc429Avoided(by = 1): void {
  counters.rate429Avoided += by;
}

export function incRetryAfterHonors(by = 1): void {
  counters.retryAfterHonors += by;
}

export function incFreeOnlyViolations(by = 1): void {
  counters.freeOnlyViolations += by;
}

export function getFreeInferenceMetrics(): FreeInferenceMetricsSnapshot {
  return { ...counters };
}

export function resetFreeInferenceMetrics(): void {
  counters.reservationsAttempted = 0;
  counters.reservationsSucceeded = 0;
  counters.reservationsFailed = 0;
  counters.rate429Avoided = 0;
  counters.retryAfterHonors = 0;
  counters.freeOnlyViolations = 0;
}
