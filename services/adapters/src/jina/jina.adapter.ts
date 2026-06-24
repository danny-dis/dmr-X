import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

export class JinaAdapter extends BaseAdapter {
  readonly providerId = 'jina';
  readonly supportedModalities: Modality[] = ['reranking', 'embedding'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Jina API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Jina health: try to access the embeddings endpoint with a minimal request
    // A 401/403 means auth is broken; any other response means the service is up
    try {
      const response = await this.fetchWithTimeout(
        'https://api.jina.ai/v1/embeddings',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: 'jina-embeddings-v3',
            input: ['health'],
          }),
          timeoutMs: 10000,
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Jina auth error: HTTP ${response.status}`);
      }
      // Any other status (200, 400, 429, 5xx) means the service is reachable
    } catch (err) {
      if (err instanceof Error && err.message.includes('Jina auth error')) {
        throw err;
      }
      // Network errors = unhealthy
      throw new Error(`Jina health check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality === 'reranking') {
      return this.executeRerank(request, options);
    }

    if (request.modality === 'embedding') {
      return this.executeEmbedding(request, options);
    }

    throw new Error(`Unsupported modality: ${request.modality}`);
  }

  private async executeRerank(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    const start = Date.now();

    const response = await this.fetchWithTimeout(
      'https://api.jina.ai/v1/rerank',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'jina-reranker-v2-base-multilingual',
          query: request.query,
          documents: request.documents,
          top_n: request.top_n,
        }),
        timeoutMs: options?.timeoutMs ?? 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Jina rerank: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'reranking',
      requestId: `jina_rerank_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'jina-reranker-v2-base-multilingual',
      rerankResults: ((data.results as any[]) || []).map((r: any) => ({
        index: r.index,
        relevance_score: r.relevance_score,
      })),
      latencyMs,
    };
  }

  private async executeEmbedding(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    const start = Date.now();

    const response = await this.fetchWithTimeout(
      'https://api.jina.ai/v1/embeddings',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'jina-embeddings-v3',
          input: Array.isArray(request.input) ? request.input : [request.input || ''],
        }),
        timeoutMs: options?.timeoutMs ?? 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Jina embedding: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `jina_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'jina-embeddings-v3',
      embeddings: (data.data as any[])?.map((d: any) => d.embedding) || [],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);
    yield {
      type: 'done',
      data: response,
      index: 0,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'jina-reranker-v2-base-multilingual', modality: 'reranking', capabilities: ['reranking', 'multilingual'] },
      { modelId: 'jina-embeddings-v3', modality: 'embedding', capabilities: ['embedding', 'multilingual'] },
    ];
  }
}
