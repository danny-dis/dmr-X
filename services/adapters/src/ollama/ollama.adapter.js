import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
export class OllamaAdapter extends BaseAdapter {
    providerId = 'ollama';
    supportedModalities = ['llm', 'embedding'];
    async checkHealth() {
        const baseUrl = this.config.baseUrl || 'http://localhost:11434';
        const response = await this.fetchWithTimeout(`${baseUrl}/api/tags`, {
            timeoutMs: 5000,
        });
        if (!response.ok) {
            throw new Error(`Ollama health check failed: ${response.status}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        const baseUrl = this.config.baseUrl || 'http://localhost:11434';
        const start = Date.now();
        if (request.modality === 'llm') {
            return this.executeChat(baseUrl, request, options);
        }
        if (request.modality === 'embedding') {
            return this.executeEmbedding(baseUrl, request, options);
        }
        throw new Error(`Unsupported modality: ${request.modality}`);
    }
    async executeChat(baseUrl, request, options) {
        const start = Date.now();
        const response = await this.fetchWithTimeout(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model || 'llama3',
                messages: (request.messages || []).map((msg) => ({
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                })),
                stream: false,
                options: {
                    temperature: request.temperature,
                    num_predict: request.max_tokens,
                    top_p: request.top_p,
                },
            }),
            timeoutMs: options?.timeoutMs ?? 120000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Ollama error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'llm',
            requestId: `ollama_${Date.now()}`,
            providerId: this.providerId,
            modelId: data.model,
            message: {
                role: 'assistant',
                content: data.message?.content || '',
            },
            usage: {
                prompt_tokens: data.prompt_eval_count || 0,
                completion_tokens: data.eval_count || 0,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            },
            finishReason: data.done ? 'stop' : 'length',
            latencyMs,
        };
    }
    async executeEmbedding(baseUrl, request, options) {
        const start = Date.now();
        const response = await this.fetchWithTimeout(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model || 'nomic-embed-text',
                prompt: Array.isArray(request.input) ? request.input[0] : request.input,
            }),
            timeoutMs: options?.timeoutMs ?? 30000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Ollama embedding error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'embedding',
            requestId: `ollama_emb_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'nomic-embed-text',
            embeddings: [data.embedding],
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const baseUrl = this.config.baseUrl || 'http://localhost:11434';
        const response = await this.fetchWithTimeout(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model || 'llama3',
                messages: (request.messages || []).map((msg) => ({
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                })),
                stream: true,
                options: {
                    temperature: request.temperature,
                    num_predict: request.max_tokens,
                },
            }),
            timeoutMs: options?.timeoutMs ?? 120000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Ollama stream error: ${error}`, this.providerId, response.status);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('Response body is null');
        const decoder = new TextDecoder();
        let buffer = '';
        let index = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.message?.content) {
                        yield {
                            type: 'token',
                            data: { content: parsed.message.content },
                            index: index++,
                        };
                    }
                    if (parsed.done) {
                        yield {
                            type: 'done',
                            data: {},
                            index: index++,
                        };
                    }
                }
                catch {
                    // Skip malformed JSON
                }
            }
        }
    }
    async listModels() {
        this.assertInitialized();
        const baseUrl = this.config.baseUrl || 'http://localhost:11434';
        const response = await this.fetchWithTimeout(`${baseUrl}/api/tags`);
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        return (data.models || []).map((model) => ({
            modelId: model.name,
            modality: 'llm',
            capabilities: [],
        }));
    }
}
//# sourceMappingURL=ollama.adapter.js.map