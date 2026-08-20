import type { UnifiedRequest } from '@dmr-x/core';

import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * NVIDIA NIM adapter.
 * Uses OpenAI-compatible API at integrate.api.nvidia.com/v1.
 *
 * Env: NVIDIA_API_KEY
 */
export class NVIDIANIMAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'nvidia-nim';

  constructor() {
    super('nvidia-nim');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://integrate.api.nvidia.com/v1',
      apiKey: (config.apiKey as string) || process.env.NVIDIA_API_KEY || '',
    });
  }

  /**
   * NVIDIA's retrieval ("asymmetric") embedding models — the `nv-embedqa-*` /
   * `nemoretriever` / `arctic-embed` families — encode queries and documents
   * differently and REJECT a request that omits `input_type`:
   *
   *   HTTP 400 {"error":"'input_type' parameter is required for asymmetric models"}
   *
   * The OpenAI embedding schema has no such field, so the generic adapter never
   * sent it and every asymmetric model 502'd through the gateway even though a
   * direct call succeeds in ~0.6s. Symmetric models (nv-embed-v1) accept it
   * harmlessly, so it is safe to send for the whole provider.
   *
   * 'query' is the correct default here: DMR-X's /v1/embeddings is a
   * single-input endpoint used to embed a search query at request time.
   * Document-side embedding is a separate ingestion concern, and a caller that
   * needs it can pass input_type explicitly.
   */
  protected override embeddingRequestExtras(request: UnifiedRequest): Record<string, unknown> {
    const requested = (request as unknown as { input_type?: unknown }).input_type;
    return { input_type: typeof requested === 'string' ? requested : 'query' };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'nvidia/llama-3.1-nemotron-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'nvidia/llama-3.1-8b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta/llama-3.1-405b-instruct', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
