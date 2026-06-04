import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, logger, EventStream, } from '@dmr-x/utils';
export class AnthropicAdapter extends BaseAdapter {
    providerId = 'anthropic';
    supportedModalities = ['llm'];
    apiKey = '';
    getBaseUrl() {
        return (this.config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
    }
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.accessToken || config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Anthropic API key is required');
        }
    }
    async checkHealth() {
        // Anthropic doesn't have a simple health endpoint, so we just check if the API responds
        const response = await this.fetchWithTimeout(`${this.getBaseUrl()}/v1/messages`, {
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
        // Accept 200 (success) or 400 (bad request = endpoint exists but params wrong)
        // Reject 401/403 (auth), 429 (rate limited = degraded), 5xx (service down)
        if (response.status === 401 || response.status === 403) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
            const httpError = createHttpError(response.status, httpMeta);
            throw new Error(`Anthropic auth error: ${httpError.message}`);
        }
        if (response.status === 429 || response.status >= 500) {
            throw new Error(`Anthropic health check failed: HTTP ${response.status}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality !== 'llm') {
            throw new Error(`Anthropic only supports LLM modality, got: ${request.modality}`);
        }
        const baseUrl = this.getBaseUrl();
        const start = Date.now();
        // Convert internal messages to Anthropic ClaudeMessageParam format
        const { system, messages } = this.convertMessages(request.messages || []);
        try {
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
                const body = await response.text();
                const httpMeta = { response, request: new Request(response.url), body };
                const httpError = createHttpError(response.status, httpMeta);
                throw new ProviderError(`Anthropic: ${httpError.message}`, this.providerId, response.status);
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
                finishReason: (data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason),
                latencyMs,
            };
        }
        catch (err) {
            throw this.handleAdapterError(err);
        }
    }
    async *executeStream(request, options) {
        this.assertInitialized();
        const baseUrl = this.getBaseUrl();
        const { system, messages } = this.convertMessages(request.messages || []);
        let response;
        try {
            response = await this.fetchWithTimeout(`${baseUrl}/v1/messages`, {
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
        }
        catch (err) {
            throw this.handleAdapterError(err, 'stream');
        }
        if (!response.ok) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
            const httpError = createHttpError(response.status, httpMeta);
            throw new ProviderError(`Anthropic stream: ${httpError.message}`, this.providerId, response.status);
        }
        if (!response.body)
            throw new Error('Response body is null');
        // Use EventStream for robust SSE parsing (handles multiple boundary formats)
        const eventStream = new EventStream(response.body, (msg) => {
            if (!msg.data)
                return { done: true, value: undefined };
            try {
                const parsed = JSON.parse(msg.data);
                return { done: false, value: parsed };
            }
            catch (parseError) {
                // Skip malformed JSON -- return a sentinel that we filter below
                logger.debug({ err: parseError }, 'Anthropic SSE: skipped malformed JSON chunk');
                return { done: false, value: { _malformed: true } };
            }
        }, { dataRequired: true });
        let index = 0;
        for await (const parsed of eventStream) {
            // Skip malformed entries
            if (!parsed || parsed._malformed)
                continue;
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
    }
    async listModels() {
        // Anthropic doesn't have a models endpoint, return known models
        return [
            { modelId: 'claude-3-5-sonnet-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
            { modelId: 'claude-3-5-haiku-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
            { modelId: 'claude-3-opus-20240229', modality: 'llm', capabilities: ['vision', 'tool_use'] },
        ];
    }
    /**
     * Convert internal Message[] to Anthropic ClaudeMessageParam[] format.
     *
     * This is the reverse of fromClaudeMessages() -- it takes the gateway's
     * internal message representation and produces Anthropic wire-format messages
     * suitable for sending to the Anthropic Messages API.
     */
    convertMessages(messages) {
        let system;
        const converted = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                continue;
            }
            if (msg.role === 'tool') {
                // Tool results become tool_result content blocks on a user message
                const toolResult = {
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id || '',
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                };
                // Append to last user message or create a new one
                const lastMsg = converted[converted.length - 1];
                if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
                    lastMsg.content.push(toolResult);
                }
                else {
                    converted.push({
                        role: 'user',
                        content: [toolResult],
                    });
                }
                continue;
            }
            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                // Assistant message with tool calls
                const contentBlocks = [];
                // Add text content if present
                const textContent = typeof msg.content === 'string'
                    ? msg.content
                    : this.extractTextFromContentParts(msg.content);
                if (textContent) {
                    contentBlocks.push({ type: 'text', text: textContent });
                }
                // Add tool_use blocks
                for (const tc of msg.tool_calls) {
                    contentBlocks.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: this.safeParseJson(tc.function.arguments),
                    });
                }
                converted.push({ role: 'assistant', content: contentBlocks });
                continue;
            }
            // Regular user/assistant messages
            if (typeof msg.content === 'string') {
                converted.push({ role: msg.role, content: msg.content });
            }
            else {
                // Convert ContentPart[] to Claude content blocks
                const contentBlocks = msg.content.map((part) => this.contentPartToClaudeBlock(part));
                converted.push({ role: msg.role, content: contentBlocks });
            }
        }
        return { system, messages: converted };
    }
    /**
     * Convert an internal ContentPart to a Claude content block.
     */
    contentPartToClaudeBlock(part) {
        switch (part.type) {
            case 'text':
                return { type: 'text', text: part.text };
            case 'image_url':
                return {
                    type: 'image',
                    source: { type: 'url', url: part.image_url.url },
                };
            case 'input_audio':
                // Anthropic doesn't support audio content blocks natively;
                // fall back to a text description
                return { type: 'text', text: `[audio: ${part.input_audio.format}]` };
            default:
                return { type: 'text', text: '[unsupported content part]' };
        }
    }
    /**
     * Extract concatenated text from ContentPart[].
     */
    extractTextFromContentParts(parts) {
        return parts
            .filter((p) => p.type === 'text')
            .map(p => p.text)
            .join('');
    }
    /**
     * Safely parse a JSON string, returning the raw string on failure.
     */
    safeParseJson(str) {
        try {
            return JSON.parse(str);
        }
        catch {
            return { _raw: str };
        }
    }
}
//# sourceMappingURL=anthropic.adapter.js.map