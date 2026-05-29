import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

export class CohereAdapter extends BaseAdapter {
  readonly providerId = 'cohere';
  readonly supportedModalities: Modality[] = ['reranking', 'embedding'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Cohere API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      'https://api.cohere.ai/v1/models',
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 5000,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Cohere health check failed: ${httpError.message}`);
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
      'https://api.cohere.ai/v1/rerank',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'rerank-english-v3.0',
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
      throw new ProviderError(`Cohere rerank: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'reranking',
      requestId: `cohere_rerank_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'rerank-english-v3.0',
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
      'https://api.cohere.ai/v1/embed',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'embed-english-v3.0',
          texts: Array.isArray(request.input) ? request.input : [request.input || ''],
          input_type: 'search_document',
          embedding_types: ['float'],
        }),
        timeoutMs: options?.timeoutMs ?? 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Cohere embedding: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `cohere_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'embed-english-v3.0',
      embeddings: (data.embeddings as Record<string, unknown>)?.float as number[][] || [],
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
      { modelId: 'rerank-english-v3.0', modality: 'reranking', capabilities: ['reranking'] },
      { modelId: 'rerank-multilingual-v3.0', modality: 'reranking', capabilities: ['reranking', 'multilingual'] },
      { modelId: 'embed-english-v3.0', modality: 'embedding', capabilities: ['embedding'] },
      { modelId: 'embed-multilingual-v3.0', modality: 'embedding', capabilities: ['embedding', 'multilingual'] },
    ];
  }
}
