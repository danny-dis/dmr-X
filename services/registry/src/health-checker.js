import { logger } from '@dmr-x/utils';
import { registryService } from './registry.service.js';
export class HealthChecker {
    adapterRegistry;
    checkIntervalMs;
    interval = null;
    constructor(adapterRegistry, checkIntervalMs = 30000) {
        this.adapterRegistry = adapterRegistry;
        this.checkIntervalMs = checkIntervalMs;
    }
    start() {
        logger.info({ intervalMs: this.checkIntervalMs }, 'Health checker started');
        // Run immediately
        this.checkAll();
        // Then run on interval
        this.interval = setInterval(() => {
            this.checkAll();
        }, this.checkIntervalMs);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.info('Health checker stopped');
    }
    async checkAll() {
        const adapters = this.adapterRegistry.list();
        for (const providerId of adapters) {
            try {
                const adapter = this.adapterRegistry.get(providerId);
                if (!adapter)
                    continue;
                const status = await adapter.healthCheck();
                await registryService.updateHealth(providerId, status.healthy, status.latencyMs);
                if (!status.healthy) {
                    logger.warn({ providerId, error: status.error }, 'Provider unhealthy');
                }
            }
            catch (error) {
                logger.error({ err: error, providerId }, 'Health check failed');
                await registryService.updateHealth(providerId, false);
            }
        }
    }
}
//# sourceMappingURL=health-checker.js.map