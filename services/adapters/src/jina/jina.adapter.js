import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
export class JinaAdapter extends BaseAdapter {
    providerId = 'jina';
    supportedModalities = ['reranking', 'embedding'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Jina API key is required');
        }
    }
    async checkHealth() {
        // Jina doesn't have a simple health endpoint
        return;
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality === 'reranking') {
            return this.executeRerank(request, options);
        }
        if (request.modality === 'embedding') {
            return this.executeEmbedding(request, options);
        }
        throw new Error(`Unsupported modality: ${request.modality}`);
    }
    async executeRerank(request, options) {
        const start = Date.now();
        const response = await this.fetchWithTimeout('https://api.jina.ai/v1/rerank', {
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
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Jina rerank error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'reranking',
            requestId: `jina_rerank_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'jina-reranker-v2-base-multilingual',
            rerankResults: (data.results || []).map((r) => ({
                index: r.index,
                relevance_score: r.relevance_score,
            })),
            latencyMs,
        };
    }
    async executeEmbedding(request, options) {
        const start = Date.now();
        const response = await this.fetchWithTimeout('https://api.jina.ai/v1/embeddings', {
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
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Jina embedding error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'embedding',
            requestId: `jina_emb_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'jina-embeddings-v3',
            embeddings: data.data?.map((d) => d.embedding) || [],
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        const response = await this.execute(request, options);
        yield {
            type: 'done',
            data: response,
            index: 0,
        };
    }
    async listModels() {
        return [
            { modelId: 'jina-reranker-v2-base-multilingual', modality: 'reranking', capabilities: ['reranking', 'multilingual'] },
            { modelId: 'jina-embeddings-v3', modality: 'embedding', capabilities: ['embedding', 'multilingual'] },
        ];
    }
}
//# sourceMappingURL=jina.adapter.js.map