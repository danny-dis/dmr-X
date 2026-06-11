import { BaseAdapter } from '../base.adapter.js';
import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, logger, type HttpMeta } from '@dmr-x/utils';

/**
 * Text Embeddings Inference (TEI) adapter
 * Supports embeddings and reranking via Hugging Face's TEI server
 */
export class TeiAdapter extends BaseAdapter {
  readonly providerId = 'tei';
  readonly supportedModalities: Modality[] = ['embedding', 'reranking'];

  protected async checkHealth(): Promise<void> {
    const baseUrl = this.config.baseUrl || 'http://localhost:8090';
    const response = await this.fetchWithTimeout(`${baseUrl}/health`, {
      timeoutMs: 5000,
    });
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`TEI health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'http://localhost:8090';
    const start = Date.now();

    try {
      if (request.modality === 'embedding') {
        return this.executeEmbedding(baseUrl, request, options);
      }

      if (request.modality === 'reranking') {
        return this.executeReranking(baseUrl, request, options);
      }

      throw new Error(`Unsupported modality: ${request.modality}`);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private async executeEmbedding(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    const response = await this.fetchWithTimeout(`${baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs,
        truncate: true,
      }),
      timeoutMs: options?.timeoutMs ?? 30000,
    });

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`TEI embedding: ${httpError.message}`, this.providerId, response.status);
    }

    const embeddings = await response.json() as number[][];
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `tei_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'tei-embedding',
      embeddings,
      latencyMs,
    };
  }

  private async executeReranking(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const query = typeof request.input === 'string' ? request.input : '';
    const documents = (request as any).documents || [];

    const response = await this.fetchWithTimeout(`${baseUrl}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        documents,
        truncate: true,
      }),
      timeoutMs: options?.timeoutMs ?? 30000,
    });

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`TEI reranking: ${httpError.message}`, this.providerId, response.status);
    }

    const results = await response.json() as Array<{ index: number; score: number }>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'reranking',
      requestId: `tei_rerank_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'tei-reranker',
      rerankResults: results.map(r => ({
        index: r.index,
        relevance_score: r.score,
      })),
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    // TEI doesn't support streaming for embeddings/reranking
    // Yield a single result
    const result = await this.execute(request, options);
    yield { type: 'token', data: { content: JSON.stringify(result) }, index: 0 };
    yield { type: 'done', data: {}, index: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const baseUrl = this.config.baseUrl || 'http://localhost:8090';
    const response = await this.fetchWithTimeout(`${baseUrl}/info`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    const modelId = data.model_id as string || 'tei-model';
    
    return [
      {
        modelId,
        modality: 'embedding' as Modality,
        capabilities: ['embedding'],
      },
    ];
  }
}