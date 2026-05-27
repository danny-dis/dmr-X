import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
export class AnthropicAdapter extends BaseAdapter {
    providerId = 'anthropic';
    supportedModalities = ['llm'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Anthropic API key is required');
        }
    }
    async checkHealth() {
        // Anthropic doesn't have a simple health endpoint, so we just check if the API responds
        const response = await this.fetchWithTimeout(`${this.config.baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'hi' }],
            }),
            timeoutMs: 10000,
        });
        // We expect 200 or 400 (bad request), not 401/403 (auth issues)
        if (response.status === 401 || response.status === 403) {
            throw new Error(`Anthropic auth error: ${response.status}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality !== 'llm') {
            throw new Error(`Anthropic only supports LLM modality, got: ${request.modality}`);
        }
        const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
        const start = Date.now();
        // Convert OpenAI messages format to Anthropic format
        const { system, messages } = this.convertMessages(request.messages || []);
        const response = await this.fetchWithTimeout(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: request.model || 'claude-3-5-sonnet-20241022',
                max_tokens: request.max_tokens || 4096,
                system,
                messages,
                temperature: request.temperature,
                top_p: request.top_p,
                stream: false,
            }),
            timeoutMs: options?.timeoutMs ?? 60000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Anthropic error: ${error}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'llm',
            requestId: data.id,
            providerId: this.providerId,
            modelId: data.model,
            message: {
                role: 'assistant',
                content: data.content?.[0]?.text || '',
            },
            usage: {
                prompt_tokens: data.usage?.input_tokens || 0,
                completion_tokens: data.usage?.output_tokens || 0,
                total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
            },
            finishReason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
        const { system, messages } = this.convertMessages(request.messages || []);
        const response = await this.fetchWithTimeout(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: request.model || 'claude-3-5-sonnet-20241022',
                max_tokens: request.max_tokens || 4096,
                system,
                messages,
                temperature: request.temperature,
                stream: true,
            }),
            timeoutMs: options?.timeoutMs ?? 120000,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new ProviderError(`Anthropic stream error: ${error}`, this.providerId, response.status);
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
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const data = trimmed.slice(6);
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'content_block_delta') {
                        yield {
                            type: 'token',
                            data: { content: parsed.delta?.text || '' },
                            index: index++,
                        };
                    }
                    else if (parsed.type === 'message_stop') {
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
        // Anthropic doesn't have a models endpoint, return known models
        return [
            { modelId: 'claude-3-5-sonnet-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
            { modelId: 'claude-3-5-haiku-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
            { modelId: 'claude-3-opus-20240229', modality: 'llm', capabilities: ['vision', 'tool_use'] },
        ];
    }
    convertMessages(messages) {
        let system;
        const converted = [];
        for (const msg of messages || []) {
            if (msg.role === 'system') {
                system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            }
            else {
                converted.push({
                    role: msg.role,
                    content: msg.content,
                });
            }
        }
        return { system, messages: converted };
    }
}
//# sourceMappingURL=anthropic.adapter.js.map