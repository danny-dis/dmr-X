import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
import { createOpenAISSEIterator } from '../stream-normalizer.js';
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
export class GenericOpenAIAdapter extends BaseAdapter {
    providerId;
    supportedModalities = ['llm', 'embedding'];
    apiKey = '';
    constructor(providerId) {
        super();
        this.providerId = providerId;
    }
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        // Some free providers (e.g., Pollinations) don't need an API key
    }
    async checkHealth() {
        const headers = {};
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
            headers,
            timeoutMs: 5000,
        });
        if (!response.ok) {
            throw new Error(`Health check failed: ${response.status}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality === 'llm') {
            return this.executeChat(request, options);
        }
        if (request.modality === 'embedding') {
            return this.executeEmbedding(request, options);
        }
        throw new Error(`Unsupported modality: ${request.modality}`);
    }
    async executeChat(request, options) {
        const start = Date.now();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                tools: request.tools,
                tool_choice: request.tool_choice,
                temperature: request.temperature,
                max_tokens: request.max_tokens,
                top_p: request.top_p,
                frequency_penalty: request.frequency_penalty,
                presence_penalty: request.presence_penalty,
                stop: request.stop,
                response_format: request.response_format,
                seed: request.seed,
                stream: false,
            }),
            timeoutMs: options?.timeoutMs ?? 60000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`${this.providerId} error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'llm',
            requestId: data.id || `req_${Date.now()}`,
            providerId: this.providerId,
            modelId: data.model || request.model || 'unknown',
            message: data.choices?.[0]?.message,
            usage: data.usage,
            finishReason: data.choices?.[0]?.finish_reason,
            latencyMs,
        };
    }
    async executeEmbedding(request, options) {
        const start = Date.now();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await this.fetchWithTimeout(`${this.config.baseUrl}/embeddings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: request.model,
                input: request.input,
                encoding_format: request.encoding_format,
                dimensions: request.dimensions,
            }),
            timeoutMs: options?.timeoutMs ?? 30000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`${this.providerId} embedding error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'embedding',
            requestId: `emb_${Date.now()}`,
            providerId: this.providerId,
            modelId: data.model || request.model || 'unknown',
            embeddings: data.data?.map((d) => d.embedding),
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                tools: request.tools,
                tool_choice: request.tool_choice,
                temperature: request.temperature,
                max_tokens: request.max_tokens,
                stream: true,
            }),
            timeoutMs: options?.timeoutMs ?? 120000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`${this.providerId} stream error: ${error}`, this.providerId, response.status);
        }
        yield* createOpenAISSEIterator(response);
    }
    async listModels() {
        this.assertInitialized();
        const headers = {};
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
            headers,
        });
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        return (data.data || []).map((model) => ({
            modelId: model.id,
            modality: 'llm',
            capabilities: [],
        }));
    }
}
//# sourceMappingURL=generic-openai.adapter.js.map