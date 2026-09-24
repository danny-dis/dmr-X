/**
 * Provider/Model Reliability Distributions — Issue #15 P0 Routing.
 *
 * Tracks reliability as distributions, not point scores. A model with
 * 0.99 success rate over 10,000 calls is not the same as one with 0.99
 * over 5 calls. We track success/failure counts, latency percentiles,
 * and time-decayed observations.
 */

export type ReliabilityAxis = 'availability' | 'latency' | 'success_rate' | 'cost_stability';

export interface ReliabilityObservation {
  providerId: string;
  modelId: string;
  success: boolean;
  latencyMs?: number;
  costCents?: number;
  timestamp: number;
}

export class ReliabilityDistribution {
  private totalSuccesses = 0;
  private totalFailures = 0;
  private latencySamples: number[] = [];
  private costSamples: number[] = [];
  private lastObservedAt = 0;
  private readonly maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
  }

  observe(obs: ReliabilityObservation): void {
    if (obs.success) {
      this.totalSuccesses++;
    } else {
      this.totalFailures++;
    }
    if (obs.latencyMs !== undefined) {
      this.latencySamples.push(obs.latencyMs);
      if (this.latencySamples.length > this.maxSamples) {
        this.latencySamples = this.latencySamples.slice(-this.maxSamples);
      }
    }
    if (obs.costCents !== undefined) {
      this.costSamples.push(obs.costCents);
      if (this.costSamples.length > this.maxSamples) {
        this.costSamples = this.costSamples.slice(-this.maxSamples);
      }
    }
    this.lastObservedAt = Math.max(this.lastObservedAt, obs.timestamp);
  }

  /** Sample success rate — raw proportion with confidence window. */
  get successRate(): number {
    const total = this.totalSuccesses + this.totalFailures;
    if (total === 0) return 0.5; // unknown — neutral prior
    return this.totalSuccesses / total;
  }

  /** Lower confidence bound (Wilson score interval, 95%). */
  get successRateLowerBound(): number {
    const n = this.totalSuccesses + this.totalFailures;
    if (n === 0) return 0;
    const z = 1.96; // 95% CI
    const p = this.successRate;
    const denom = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centre - spread) / denom);
  }

  get p50LatencyMs(): number | null {
    return this.percentile(50);
  }

  get p95LatencyMs(): number | null {
    return this.percentile(95);
  }

  get p99LatencyMs(): number | null {
    return this.percentile(99);
  }

  percentile(p: number): number | null {
    if (this.latencySamples.length === 0) return null;
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
  }

  get observationCount(): number {
    return this.totalSuccesses + this.totalFailures;
  }

  get isStale(): boolean {
    return Date.now() - this.lastObservedAt > 30 * 60 * 1000; // 30 min
  }

  get hasSufficientData(): boolean {
    return this.observationCount >= 10;
  }
}

export class ReliabilityRegistry {
  private distributions = new Map<string, ReliabilityDistribution>();

  private key(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  record(obs: ReliabilityObservation): void {
    const k = this.key(obs.providerId, obs.modelId);
    let dist = this.distributions.get(k);
    if (!dist) {
      dist = new ReliabilityDistribution();
      this.distributions.set(k, dist);
    }
    dist.observe(obs);
  }

  get(providerId: string, modelId: string): ReliabilityDistribution | undefined {
    return this.distributions.get(this.key(providerId, modelId));
  }

  getOrCreate(providerId: string, modelId: string): ReliabilityDistribution {
    let dist = this.distributions.get(this.key(providerId, modelId));
    if (!dist) {
      dist = new ReliabilityDistribution();
      this.distributions.set(this.key(providerId, modelId), dist);
    }
    return dist;
  }

  /** Rank candidates by reliability (highest success rate lower bound first). */
  rankByReliability(providerModels: Array<{ providerId: string; modelId: string }>): Array<{
    providerId: string;
    modelId: string;
    successRate: number;
    lowerBound: number;
  }> {
    return providerModels
      .map((pm) => {
        const dist = this.get(pm.providerId, pm.modelId);
        return {
          ...pm,
          successRate: dist?.successRate ?? 0.5,
          lowerBound: dist?.successRateLowerBound ?? 0,
        };
      })
      .sort((a, b) => b.lowerBound - a.lowerBound);
  }
}

export const reliabilityRegistry = new ReliabilityRegistry();
