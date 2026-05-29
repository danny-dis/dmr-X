import type { ProviderAdapter, ProviderConfig } from './adapter.interface.js';
import { logger, CircuitBreaker, type CircuitBreakerOptions } from '@dmr-x/utils';

const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryThreshold: 3,
  resetTimeoutMs: 60000,
};

export class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private configs = new Map<string, ProviderConfig>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
    this.circuitBreakers.set(adapter.providerId, new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_OPTIONS));
    logger.info({ providerId: adapter.providerId }, 'Adapter registered');
  }

  get(providerId: string): ProviderAdapter | undefined {
    const cb = this.circuitBreakers.get(providerId);
    if (cb && !cb.canExecute()) {
      logger.warn({ providerId }, 'Adapter circuit breaker is open, rejecting request');
      return undefined;
    }
    return this.adapters.get(providerId);
  }

  async initialize(providerId: string, config: ProviderConfig): Promise<void> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Adapter not found: ${providerId}`);
    }
    await adapter.initialize(config);
    this.configs.set(providerId, config);
  }

  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [id, adapter] of this.adapters) {
      try {
        const status = await adapter.healthCheck();
        results.set(id, status.healthy);
        if (status.healthy) {
          this.circuitBreakers.get(id)?.recordSuccess();
        } else {
          this.circuitBreakers.get(id)?.recordFailure();
        }
      } catch {
        results.set(id, false);
        this.circuitBreakers.get(id)?.recordFailure();
      }
    }
    return results;
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  recordSuccess(providerId: string): void {
    this.circuitBreakers.get(providerId)?.recordSuccess();
  }

  recordFailure(providerId: string): void {
    this.circuitBreakers.get(providerId)?.recordFailure();
  }

  getCircuitBreakerState(providerId: string): string | undefined {
    return this.circuitBreakers.get(providerId)?.getState();
  }

  registerHooksOnAll(hookRegistrar: (adapter: ProviderAdapter) => void): void {
    for (const adapter of this.adapters.values()) {
      hookRegistrar(adapter);
    }
  }

  async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose();
    }
    this.adapters.clear();
    this.configs.clear();
    this.circuitBreakers.clear();
  }
}
