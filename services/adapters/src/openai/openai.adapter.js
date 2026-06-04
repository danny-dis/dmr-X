import { BaseAdapter } from '../base.adapter.js';
import { logger } from '@dmr-x/utils';
import { createOpenAISSEIterator } from '../stream-normalizer.js';
export class OpenAIAdapter extends BaseAdapter {
    providerId = 'openai';
    supportedModalities = ['llm', 'embedding', 'diffusion', 'audio_tts', 'audio_stt'];
    apiKey = '';
    getBaseUrl() {
        return (this.config.baseUrl || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
    }
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.accessToken || config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('OpenAI API key is required');
        }
    }
    async checkHealth() {
        // fetchWithTimeout throws HttpError on non-OK responses; base healthCheck() catches it
        await this.fetchWithTimeout(`${this.getBaseUrl()}/v1/models`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeoutMs: 5000,
        });
    }
    async execute(request, options) {
        this.assertInitialized();
        const baseUrl = this.getBaseUrl();
        const start = Date.now();
        try {
            if (request.modality === 'llm') {
                return this.executeChat(baseUrl, request, options);
            }
            if (request.modality === 'embedding') {
                return this.executeEmbedding(baseUrl, request, options);
            }
            if (request.modality === 'diffusion') {
                return this.executeImage(baseUrl, request, options);
            }
            throw new Error(`Unsupported modality: ${request.modality}`);
        }
        catch (err) {
            throw this.handleAdapterError(err);
        }
    }
    async executeChat(baseUrl, request, options) {
        const start = Date.now();
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: request.model || 'gpt-4o-mini',
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
                    n: request.n,
                    stream: false,
                }),
                timeoutMs: options?.timeoutMs ?? 60000,
            });
        }
        catch (error) {
            throw this.handleAdapterError(error, 'chat');
        }
        const data = (await response.json());
        const latencyMs = Date.now() - start;
        return {
            modality: 'llm',
            requestId: data.id,
            providerId: this.providerId,
            modelId: data.model,
            message: data.choices?.[0]?.message,
            usage: data.usage,
            finishReason: data.choices?.[0]?.finish_reason,
            latencyMs,
        };
    }
    async executeEmbedding(baseUrl, request, options) {
        const start = Date.now();
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: request.model || 'text-embedding-3-small',
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
        const data = (await response.json());
        const latencyMs = Date.now() - start;
        return {
            modality: 'embedding',
            requestId: `emb_${Date.now()}`,
            providerId: this.providerId,
            modelId: data.model,
            embeddings: data.data?.map((d) => d.embedding),
            latencyMs,
        };
    }
    async executeImage(baseUrl, request, options) {
        const start = Date.now();
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/images/generations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: request.model || 'dall-e-3',
                    prompt: request.prompt,
                    n: request.n || 1,
                    size: `${request.width || 1024}x${request.height || 1024}`,
                    quality: request.metadata?.quality || 'standard',
                    style: request.style || 'vivid',
                    response_format: request.metadata?.responseFormat || 'url',
                }),
                timeoutMs: options?.timeoutMs ?? 120000,
            });
        }
        catch (error) {
            throw this.handleAdapterError(error, 'image');
        }
        const data = (await response.json());
        const latencyMs = Date.now() - start;
        return {
            modality: 'diffusion',
            requestId: `img_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'dall-e-3',
            images: data.data,
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const baseUrl = this.getBaseUrl();
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: request.model || 'gpt-4o-mini',
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
        const baseUrl = this.getBaseUrl();
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
        }
        catch (error) {
            // Gracefully return empty list on any error (HTTP or transport)
            logger.debug({ err: error, providerId: this.providerId }, 'Failed to list models, returning empty list');
            return [];
        }
        const data = (await response.json());
        return (data.data || []).map((model) => ({
            modelId: model.id,
            modality: 'llm',
            capabilities: [],
        }));
    }
}
//# sourceMappingURL=openai.adapter.js.map