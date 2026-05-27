import { BaseAdapter } from '../base.adapter.js';
import type { ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
export declare class OllamaAdapter extends BaseAdapter {
    readonly providerId = "ollama";
    readonly supportedModalities: Modality[];
    protected checkHealth(): Promise<void>;
    execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
    private executeChat;
    private executeEmbedding;
    executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=ollama.adapter.d.ts.map