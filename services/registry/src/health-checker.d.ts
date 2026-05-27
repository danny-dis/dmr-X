import type { AdapterRegistry } from '@dmr-x/adapters';
export declare class HealthChecker {
    private adapterRegistry;
    private checkIntervalMs;
    private interval;
    constructor(adapterRegistry: AdapterRegistry, checkIntervalMs?: number);
    start(): void;
    stop(): void;
    private checkAll;
}
//# sourceMappingURL=health-checker.d.ts.map