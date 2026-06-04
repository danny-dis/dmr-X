import { logger, CircuitBreaker } from '@dmr-x/utils';
const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
    failureThreshold: 5,
    recoveryThreshold: 3,
    resetTimeoutMs: 60000,
};
export class AdapterRegistry {
    adapters = new Map();
    configs = new Map();
    circuitBreakers = new Map();
    register(adapter) {
        this.adapters.set(adapter.providerId, adapter);
        this.circuitBreakers.set(adapter.providerId, new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_OPTIONS));
        logger.info({ providerId: adapter.providerId }, 'Adapter registered');
    }
    get(providerId) {
        const cb = this.circuitBreakers.get(providerId);
        if (cb && !cb.canExecute()) {
            logger.warn({ providerId }, 'Adapter circuit breaker is open, rejecting request');
            return undefined;
        }
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
            try {
                const status = await adapter.healthCheck();
                results.set(id, status.healthy);
                // Note: circuit breaker recording is handled by HealthChecker to avoid double-counting
            }
            catch (error) {
                logger.warn({ err: error, providerId: id }, 'Health check threw, marking unhealthy');
                results.set(id, false);
            }
        }
        return results;
    }
    list() {
        return Array.from(this.adapters.keys());
    }
    recordSuccess(providerId) {
        this.circuitBreakers.get(providerId)?.recordSuccess();
    }
    recordFailure(providerId) {
        this.circuitBreakers.get(providerId)?.recordFailure();
    }
    getCircuitBreakerState(providerId) {
        return this.circuitBreakers.get(providerId)?.getState();
    }
    registerHooksOnAll(hookRegistrar) {
        for (const adapter of this.adapters.values()) {
            hookRegistrar(adapter);
        }
    }
    async disposeAll() {
        for (const adapter of this.adapters.values()) {
            await adapter.dispose();
        }
        this.adapters.clear();
        this.configs.clear();
        this.circuitBreakers.clear();
    }
}
//# sourceMappingURL=adapter-registry.js.map