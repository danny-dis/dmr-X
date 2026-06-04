import { BaseAdapter } from '../base.adapter.js';
import { HttpError, logger } from '@dmr-x/utils';
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
    apiKeys = [];
    keyIndex = 0;
    constructor(providerId) {
        super();
        this.providerId = providerId;
    }
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.accessToken || config.apiKey || '';
        // Some free providers (e.g., Pollinations) don't need an API key
    }
    /**
     * Set multiple keys for round-robin rotation
     */
    setKeys(keys) {
        this.apiKeys = keys;
        this.keyIndex = 0;
        if (keys.length > 0) {
            this.apiKey = keys[0];
        }
    }
    /**
     * Get the current key for requests
     */
    getCurrentKey() {
        if (this.apiKeys.length <= 1)
            return this.apiKey;
        // Round-robin: advance after each use
        const key = this.apiKeys[this.keyIndex % this.apiKeys.length];
        this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
        this.apiKey = key;
        return key;
    }
    async checkHealth() {
        const headers = {};
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        try {
            // Try /models endpoint first
            await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
                headers,
                timeoutMs: 5000,
            });
        }
        catch (error) {
            // If /models returns 404, try a minimal chat completion as a fallback
            if (error instanceof HttpError && error.statusCode === 404) {
                await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'ping', // Some providers might ignore the model name for a minimal check
                        messages: [{ role: 'user', content: 'ping' }],
                        max_tokens: 1,
                    }),
                    timeoutMs: 5000,
                });
            }
            else {
                throw error;
            }
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        try {
            if (request.modality === 'llm') {
                return this.executeChat(request, options);
            }
            if (request.modality === 'embedding') {
                return this.executeEmbedding(request, options);
            }
            throw new Error(`Unsupported modality: ${request.modality}`);
        }
        catch (err) {
            throw this.handleAdapterError(err);
        }
    }
    async executeChat(request, options) {
        const start = Date.now();
        const key = this.getCurrentKey();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (key) {
            headers['Authorization'] = `Bearer ${key}`;
        }
        let response;
        try {
            response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
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
        }
        catch (error) {
            throw this.handleAdapterError(error, 'chat');
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
        const key = this.getCurrentKey();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (key) {
            headers['Authorization'] = `Bearer ${key}`;
        }
        let response;
        try {
            response = await this.fetchWithTimeout(`${this.config.baseUrl}/embeddings`, {
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
        }
        catch (error) {
            throw this.handleAdapterError(error, 'embedding');
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
        const key = this.getCurrentKey();
        const headers = {
            'Content-Type': 'application/json',
        };
        if (key) {
            headers['Authorization'] = `Bearer ${key}`;
        }
        let response;
        try {
            response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
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
        }
        catch (error) {
            throw this.handleAdapterError(error, 'stream');
        }
        yield* createOpenAISSEIterator(response);
    }
    async listModels() {
        this.assertInitialized();
        const headers = {};
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        let response;
        try {
            response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
                headers,
            });
        }
        catch (error) {
            // Gracefully return empty list on any error (HTTP or transport)
            logger.debug({ err: error, providerId: this.providerId }, 'Failed to list models, returning empty list');
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