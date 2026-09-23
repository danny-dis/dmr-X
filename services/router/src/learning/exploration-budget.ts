export interface ExplorationConfig {
  maxExplorationRate: number;
  windowMs?: number;
}

export class ExplorationBudget {
  private explorations = new Map<string, number[]>();

  constructor(private config: ExplorationConfig) {}

  shouldExplore(providerId: string, modelId: string): boolean {
    const rate = this.getExplorationRate(providerId, modelId);
    return rate < this.config.maxExplorationRate;
  }

  recordExploration(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`;
    const times = this.explorations.get(key) ?? [];
    times.push(Date.now());
    this.explorations.set(key, times);
  }

  getExplorationRate(providerId: string, modelId: string): number {
    const key = `${providerId}:${modelId}`;
    const times = this.explorations.get(key) ?? [];
    const windowMs = this.config.windowMs ?? 3600000;
    const now = Date.now();
    const recent = times.filter(t => now - t < windowMs);
    this.explorations.set(key, recent);
    return Math.min(1, recent.length / 100);
  }
}