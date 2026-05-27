import { logger } from '@dmr-x/utils';
export class BaseAdapter {
    config = { baseUrl: '' };
    initialized = false;
    async initialize(config) {
        this.config = config;
        this.initialized = true;
        logger.info({ providerId: this.providerId }, 'Adapter initialized');
    }
    async healthCheck() {
        const start = Date.now();
        try {
            await this.checkHealth();
            return { healthy: true, latencyMs: Date.now() - start };
        }
        catch (error) {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async dispose() {
        this.initialized = false;
        logger.info({ providerId: this.providerId }, 'Adapter disposed');
    }
    assertInitialized() {
        if (!this.initialized) {
            throw new Error(`Adapter ${this.providerId} not initialized`);
        }
    }
    async fetchWithTimeout(url, options = {}) {
        const { timeoutMs = 30000, ...fetchOptions } = options;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal,
            });
            return response;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
//# sourceMappingURL=base.adapter.js.map