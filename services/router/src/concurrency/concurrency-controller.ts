// services/router/src/concurrency/concurrency-controller.ts
export interface ConcurrencyConfig {
  maxConcurrency: number;
  minConcurrency?: number;
  backoffFactor?: number;
  recoveryThreshold?: number;
}

interface ConcurrencyState {
  inFlight: number;
  currentLimit: number;
  consecutiveSuccesses: number;
  lastErrorAt: number | null;
}

export class ConcurrencyController {
  private state = new Map<string, ConcurrencyConfig & ConcurrencyState>();

  constructor(private config: ConcurrencyConfig) {}

  private getKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  private getState(providerId: string, modelId: string): ConcurrencyState & ConcurrencyConfig {
    const key = this.getKey(providerId, modelId);
    let state = this.state.get(key);
    if (!state) {
      state = {
        inFlight: 0,
        currentLimit: this.config.maxConcurrency,
        consecutiveSuccesses: 0,
        lastErrorAt: null,
        ...this.config,
      };
      this.state.set(key, state);
    }
    return state;
  }

  tryAcquire(providerId: string, modelId: string): boolean {
    const state = this.getState(providerId, modelId);
    if (state.inFlight >= state.currentLimit) return false;
    state.inFlight++;
    return true;
  }

  acquire(providerId: string, modelId: string): void {
    const state = this.getState(providerId, modelId);
    state.inFlight++;
  }

  release(providerId: string, modelId: string): void {
    const state = this.getState(providerId, modelId);
    state.inFlight = Math.max(0, state.inFlight - 1);
  }

  getInFlight(providerId: string, modelId: string): number {
    return this.getState(providerId, modelId).inFlight;
  }

  getEffectiveLimit(providerId: string, modelId: string): number {
    return this.getState(providerId, modelId).currentLimit;
  }

  recordError(providerId: string, modelId: string, error: { status?: number }): void {
    const state = this.getState(providerId, modelId);
    const factor = this.config.backoffFactor ?? 0.5;
    const min = this.config.minConcurrency ?? 1;
    state.currentLimit = Math.max(min, Math.floor(state.currentLimit * factor));
    state.consecutiveSuccesses = 0;
    state.lastErrorAt = Date.now();
  }

  recordSuccess(providerId: string, modelId: string): void {
    const state = this.getState(providerId, modelId);
    const threshold = this.config.recoveryThreshold ?? 3;
    state.consecutiveSuccesses++;
    if (state.consecutiveSuccesses >= threshold) {
      state.currentLimit = Math.min(this.config.maxConcurrency, state.currentLimit + 1);
      state.consecutiveSuccesses = 0;
    }
  }
}
