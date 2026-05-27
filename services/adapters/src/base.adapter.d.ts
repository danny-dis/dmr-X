import type { ProviderAdapter, ProviderConfig, HealthStatus, ModelInfo, ExecuteOptions } from './adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
export declare abstract class BaseAdapter implements ProviderAdapter {
    abstract readonly providerId: string;
    abstract readonly supportedModalities: Modality[];
    protected config: ProviderConfig;
    protected initialized: boolean;
    initialize(config: ProviderConfig): Promise<void>;
    healthCheck(): Promise<HealthStatus>;
    protected abstract checkHealth(): Promise<void>;
    abstract execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
    abstract executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
    abstract listModels(): Promise<ModelInfo[]>;
    dispose(): Promise<void>;
    protected assertInitialized(): void;
    protected fetchWithTimeout(url: string, options?: RequestInit & {
        timeoutMs?: number;
    }): Promise<Response>;
}
//# sourceMappingURL=base.adapter.d.ts.map