import { logger } from '@dmr-x/utils';
import { registryService } from './registry.service.js';
import type { AdapterRegistry } from '@dmr-x/adapters';
import { getDb } from '@dmr-x/db';

export class HealthChecker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private providerIdMap = new Map<string, string>(); // adapter ID -> DB UUID

  constructor(
    private adapterRegistry: AdapterRegistry,
    private checkIntervalMs: number = 30000
  ) {}

  start(): void {
    logger.info({ intervalMs: this.checkIntervalMs }, 'Health checker started');

    // Run immediately
    this.checkAll();

    // Then run on interval
    this.interval = setInterval(() => {
      this.checkAll();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Health checker stopped');
  }

  private loadProviderIdMap(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name FROM providers').all();
      for (const row of rows as any[]) {
        this.providerIdMap.set(row.name.toLowerCase(), row.id);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load provider ID map');
    }
  }

  private getProviderUuid(adapterId: string): string | null {
    // Try to find by name (case-insensitive)
    const uuid = this.providerIdMap.get(adapterId.toLowerCase());
    if (uuid) return uuid;

    // If not found, reload the map and try again
    this.loadProviderIdMap();
    return this.providerIdMap.get(adapterId.toLowerCase()) || null;
  }

  private async checkAll(): Promise<void> {
    // Ensure we have the provider ID mapping
    if (this.providerIdMap.size === 0) {
      this.loadProviderIdMap();
    }

    const adapters = this.adapterRegistry.list();

    for (const adapterId of adapters) {
      try {
        const adapter = this.adapterRegistry.get(adapterId);
        if (!adapter) continue;

        const providerUuid = this.getProviderUuid(adapterId);
        if (!providerUuid) {
          logger.warn({ adapterId }, 'Provider not found in database, skipping health check');
          continue;
        }

        const status = await adapter.healthCheck();
        registryService.updateHealth(providerUuid, status.healthy, status.latencyMs);

        if (!status.healthy) {
          logger.warn(
            { adapterId, providerUuid, error: status.error },
            'Provider unhealthy'
          );
        }
      } catch (error) {
        logger.error({ err: error, adapterId }, 'Health check failed');
        const providerUuid = this.getProviderUuid(adapterId);
        if (providerUuid) {
          registryService.updateHealth(providerUuid, false);
        }
      }
    }
  }
}
