import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
export class CohereAdapter extends BaseAdapter {
    providerId = 'cohere';
    supportedModalities = ['reranking', 'embedding'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Cohere API key is required');
        }
    }
    async checkHealth() {
        const response = await this.fetchWithTimeout('https://api.cohere.ai/v1/models', {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeoutMs: 5000,
        });
        if (!response.ok) {
            throw new Error(`Cohere health check failed: ${response.status}`);
        }
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
        const response = await this.fetchWithTimeout('https://api.cohere.ai/v1/rerank', {
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
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Cohere rerank error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'reranking',
            requestId: `cohere_rerank_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'rerank-english-v3.0',
            rerankResults: (data.results || []).map((r) => ({
                index: r.index,
                relevance_score: r.relevance_score,
            })),
            latencyMs,
        };
    }
    async executeEmbedding(request, options) {
        const start = Date.now();
        const response = await this.fetchWithTimeout('https://api.cohere.ai/v1/embed', {
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
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Cohere embedding error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'embedding',
            requestId: `cohere_emb_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'embed-english-v3.0',
            embeddings: data.embeddings?.float || [],
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
            { modelId: 'rerank-english-v3.0', modality: 'reranking', capabilities: ['reranking'] },
            { modelId: 'rerank-multilingual-v3.0', modality: 'reranking', capabilities: ['reranking', 'multilingual'] },
            { modelId: 'embed-english-v3.0', modality: 'embedding', capabilities: ['embedding'] },
            { modelId: 'embed-multilingual-v3.0', modality: 'embedding', capabilities: ['embedding', 'multilingual'] },
        ];
    }
}
//# sourceMappingURL=cohere.adapter.js.map