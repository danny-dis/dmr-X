import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
export declare class JinaAdapter extends BaseAdapter {
    readonly providerId = "jina";
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
//# sourceMappingURL=jina.adapter.d.ts.map