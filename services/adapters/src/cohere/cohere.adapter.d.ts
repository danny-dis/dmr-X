import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
export declare class CohereAdapter extends BaseAdapter {
    readonly providerId = "cohere";
    readonly supportedModalities: Modality[];
    private apiKey;
    initialize(config: ProviderConfig): Promise<void>;
    protected checkHealth(): Promise<void>;
    execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
    private executeRerank;
    private executeEmbedding;
    executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=cohere.adapter.d.ts.map