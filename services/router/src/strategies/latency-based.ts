import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Latency-based routing strategy.
 *
 * Tracks P50 and P95 latency per provider using an exponential moving average.
 * Routes to the provider with the lowest estimated latency.
 */

interface LatencyEntry {
  ema: number;      // Exponential moving average
  p95: number;      // Estimated P95
  count: number;
  lastUpdated: number;
}

const latency = new Map<string, LatencyEntry>();
const EMA_ALPHA = 0.3; // Smoothing factor (0.3 = responsive to recent values)
const P95_MULTIPLIER = 2.0; // Rough P95 estimate: EMA * 2

function getKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function recordLatency(providerId: string, modelId: string, latencyMs: number): void {
  const key = getKey(providerId, modelId);
  const existing = latency.get(key);

  if (existing) {
    // Update EMA
    existing.ema = existing.ema * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA;
    existing.count++;
    existing.lastUpdated = Date.now();
    // Update P95 estimate
    existing.p95 = existing.ema * P95_MULTIPLIER;
  } else {
    latency.set(key, {
      ema: latencyMs,
      p95: latencyMs * P95_MULTIPLIER,
      count: 1,
      lastUpdated: Date.now(),
    });
  }
}

export function getLatencyStats(providerId: string, modelId: string): { ema: number; p95: number; count: number } | null {
  const key = getKey(providerId, modelId);
  return latency.get(key) ?? null;
}

/**
 * Select provider with lowest estimated P95 latency.
 * Uses EMA when available, falls back to config avgLatencyMs.
 */
export function selectLowestLatency(candidates: CandidateSet): SelectedProvider | null {
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

  const sorted = [...candidates].sort((a, b) => {
    const aLatency = getEstimatedLatency(a);
    const bLatency = getEstimatedLatency(b);
    return aLatency - bLatency;
  });

  const selected = sorted[0];
  const stats = getLatencyStats(selected.providerId, selected.modelId);
  logger.debug(
    {
      providerId: selected.providerId,
      modelId: selected.modelId,
      estimatedLatencyMs: getEstimatedLatency(selected),
      hasRealData: !!stats,
    },
    'Latency-based routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}

function getEstimatedLatency(model: ProviderModel): number {
  const key = getKey(model.providerId, model.modelId);
  const stats = latency.get(key);
  if (stats && stats.count >= 3) {
    return stats.p95;
  }
  // Fall back to configured average latency
  return (model as any).avgLatencyMs ?? 5000;
}
