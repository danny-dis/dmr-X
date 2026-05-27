import type { ProviderAdapter, ProviderConfig } from './adapter.interface.js';
import { logger } from '@dmr-x/utils';

export class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private configs = new Map<string, ProviderConfig>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
    logger.info({ providerId: adapter.providerId }, 'Adapter registered');
  }

  get(providerId: string): ProviderAdapter | undefined {
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
      const status = await adapter.healthCheck();
      results.set(id, status.healthy);
    }
    return results;
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose();
    }
    this.adapters.clear();
    this.configs.clear();
  }
}
