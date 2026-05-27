import { logger } from '@dmr-x/utils';
export class AdapterRegistry {
    adapters = new Map();
    configs = new Map();
    register(adapter) {
        this.adapters.set(adapter.providerId, adapter);
        logger.info({ providerId: adapter.providerId }, 'Adapter registered');
    }
    get(providerId) {
        return this.adapters.get(providerId);
    }
    async initialize(providerId, config) {
        const adapter = this.adapters.get(providerId);
        if (!adapter) {
            throw new Error(`Adapter not found: ${providerId}`);
        }
        await adapter.initialize(config);
        this.configs.set(providerId, config);
    }
    async healthCheckAll() {
        const results = new Map();
        for (const [id, adapter] of this.adapters) {
            const status = await adapter.healthCheck();
            results.set(id, status.healthy);
        }
        return results;
    }
    list() {
        return Array.from(this.adapters.keys());
    }
    async disposeAll() {
        for (const adapter of this.adapters.values()) {
            await adapter.dispose();
        }
        this.adapters.clear();
        this.configs.clear();
    }
}
//# sourceMappingURL=adapter-registry.js.map