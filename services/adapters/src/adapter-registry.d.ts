import type { ProviderAdapter, ProviderConfig } from './adapter.interface.js';
export declare class AdapterRegistry {
    private adapters;
    private configs;
    register(adapter: ProviderAdapter): void;
    get(providerId: string): ProviderAdapter | undefined;
    initialize(providerId: string, config: ProviderConfig): Promise<void>;
    healthCheckAll(): Promise<Map<string, boolean>>;
    list(): string[];
    disposeAll(): Promise<void>;
}
//# sourceMappingURL=adapter-registry.d.ts.map