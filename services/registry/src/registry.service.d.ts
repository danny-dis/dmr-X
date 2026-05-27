import type { CandidateSet } from '@dmr-x/core';
export declare class RegistryService {
    private healthCheckInterval;
    getCandidates(modality?: string): Promise<CandidateSet>;
    private extractCapabilities;
    getProvider(providerId: string): Promise<any>;
    updateHealth(providerId: string, healthy: boolean, latencyMs?: number): Promise<void>;
    getProviderConfig(providerId: string): Promise<any>;
}
export declare const registryService: RegistryService;
//# sourceMappingURL=registry.service.d.ts.map