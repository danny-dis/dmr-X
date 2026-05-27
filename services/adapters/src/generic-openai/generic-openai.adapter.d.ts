import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
/**
 * Generic OpenAI-compatible adapter for free-tier providers.
 *
 * Works with any provider that exposes an OpenAI-compatible API:
 * NVIDIA NIM, GitHub Models, Cloudflare Workers AI, Zhipu,
 * OpenRouter, Pollinations, LLM7, Kilo Gateway, Ollama Cloud, etc.
 *
 * Usage:
 *   const adapter = new GenericOpenAIAdapter('nvidia-nim');
 *   await adapter.initialize({ baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '...' });
 */
export declare class GenericOpenAIAdapter extends BaseAdapter {
    readonly providerId: string;
    readonly supportedModalities: Modality[];
    private apiKey;
    constructor(providerId: string);
    initialize(config: ProviderConfig): Promise<void>;
    protected checkHealth(): Promise<void>;
    execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
    private executeChat;
    private executeEmbedding;
    executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=generic-openai.adapter.d.ts.map