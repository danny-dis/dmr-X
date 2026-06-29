import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * In-flight request counters per provider:model.
 * TTL-based so entries expire when no requests are active.
 */
interface InFlightEntry {
  count: number;
  lastUpdated: number;
}

const inFlight = new Map<string, InFlightEntry>();
const TTL_MS = 30_000; // entries expire after 30s of no updates

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of inFlight) {
    if (now - entry.lastUpdated > TTL_MS) {
      inFlight.delete(key);
    }
  }
}

function getInFlightCount(providerId: string, modelId: string): number {
  const key = `${providerId}:${modelId}`;
  return inFlight.get(key)?.count ?? 0;
}

export function incrementInFlight(providerId: string, modelId: string): void {
  const key = `${providerId}:${modelId}`;
  const existing = inFlight.get(key);
  if (existing) {
    existing.count++;
    existing.lastUpdated = Date.now();
  } else {
    inFlight.set(key, { count: 1, lastUpdated: Date.now() });
  }
}

export function decrementInFlight(providerId: string, modelId: string): void {
  const key = `${providerId}:${modelId}`;
  const existing = inFlight.get(key);
  if (existing && existing.count > 0) {
    existing.count--;
    existing.lastUpdated = Date.now();
    if (existing.count === 0) {
      inFlight.delete(key);
    }
  }
}

/**
 * Least-busy routing strategy.
 * Selects the provider with the fewest in-flight requests.
 * Falls back to health/quality scoring when in-flight counts are tied.
 */
export function selectLeastBusy(candidates: CandidateSet): SelectedProvider | null {
  cleanup();

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      providerId: c.providerId,
      modelId: c.modelId,
      adapterType: c.providerName,
      score: c.qualityScore,
    };
  }

  // Sort by in-flight count (ascending), then by quality score (descending)
  const sorted = [...candidates].sort((a, b) => {
    const aInFlight = getInFlightCount(a.providerId, a.modelId);
    const bInFlight = getInFlightCount(b.providerId, b.modelId);
    if (aInFlight !== bInFlight) return aInFlight - bInFlight;
    return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
  });

  const selected = sorted[0];
  logger.debug(
    {
      providerId: selected.providerId,
      modelId: selected.modelId,
      inFlight: getInFlightCount(selected.providerId, selected.modelId),
    },
    'Least-busy routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
