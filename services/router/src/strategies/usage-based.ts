import type { CandidateSet, ProviderModel, SelectedProvider } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

/**
 * Usage-based routing strategy.
 *
 * Tracks RPM (requests per minute) and TPM (tokens per minute) per deployment.
 * Selects providers weighted by remaining capacity (configured limit - current usage).
 * Requires RPM/TPM to be set in model config for weighted selection.
 */

interface UsageEntry {
  rpm: number;
  tpm: number;
  windowStart: number;
  totalTokens: number;
  requestCount: number;
}

const usage = new Map<string, UsageEntry>();
const WINDOW_MS = 60_000; // 1 minute window

function getKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function getCurrentUsage(key: string): UsageEntry {
  const now = Date.now();
  const existing = usage.get(key);
  if (existing && now - existing.windowStart < WINDOW_MS) {
    return existing;
  }
  // Reset window
  const entry: UsageEntry = { rpm: 0, tpm: 0, windowStart: now, totalTokens: 0, requestCount: 0 };
  usage.set(key, entry);
  return entry;
}

export function recordRequest(providerId: string, modelId: string, tokens: number): void {
  const key = getKey(providerId, modelId);
  const entry = getCurrentUsage(key);
  entry.requestCount++;
  entry.rpm++;
  entry.tpm += tokens;
  entry.totalTokens += tokens;
}

export function getUsageStats(providerId: string, modelId: string): { rpm: number; tpm: number } {
  const key = getKey(providerId, modelId);
  const entry = getCurrentUsage(key);
  return { rpm: entry.rpm, tpm: entry.tpm };
}

/**
 * Select provider using weighted random selection based on remaining capacity.
 * Providers with more headroom get higher weight.
 */
export function selectUsageBased(
  candidates: CandidateSet,
  options?: { rpm?: number; tpm?: number },
): SelectedProvider | null {
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

  const weighted = candidates.map((c) => {
    const stats = getUsageStats(c.providerId, c.modelId);
    const configRpm = (c as any).rpm || options?.rpm || 1000;
    const configTpm = (c as any).tpm || options?.tpm || 100000;

    // Headroom ratio: how much capacity remains
    const rpmHeadroom = Math.max(0, (configRpm - stats.rpm) / configRpm);
    const tpmHeadroom = Math.max(0, (configTpm - stats.tpm) / configTpm);
    const headroom = (rpmHeadroom + tpmHeadroom) / 2;

    // Quality bonus
    const qualityBonus = c.qualityScore ?? 0.5;

    // Combined weight: headroom (70%) + quality (30%)
    const weight = headroom * 0.7 + qualityBonus * 0.3;

    return { model: c, weight: Math.max(weight, 0.01) };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  // Weighted random pick
  let roll = Math.random() * totalWeight;
  let selectedIdx = 0;
  for (let i = 0; i < weighted.length; i++) {
    roll -= weighted[i].weight;
    if (roll <= 0) {
      selectedIdx = i;
      break;
    }
  }

  const selected = weighted[selectedIdx].model;
  logger.debug(
    {
      providerId: selected.providerId,
      modelId: selected.modelId,
      weight: weighted[selectedIdx].weight,
    },
    'Usage-based routing selected',
  );

  return {
    providerId: selected.providerId,
    modelId: selected.modelId,
    adapterType: selected.providerName,
    score: selected.qualityScore,
  };
}
