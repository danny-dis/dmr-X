import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, logger, type HttpMeta } from '@dmr-x/utils';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { convertMessagesToAnthropic } from '../anthropic-messages.js';
import { planPromptCache } from '../prompt-cache.js';
import { normalizeAnthropicUsage } from '../cache-usage.js';
import {
  toAnthropicTools,
  toAnthropicToolChoice,
  parseAnthropicContentBlocks,
  mapAnthropicStopReason,
} from '../anthropic-tools.js';
import { createAnthropicSSEIterator } from '../stream-normalizer.js';

export class AnthropicAdapter extends BaseAdapter {
  readonly providerId = 'anthropic';
  readonly supportedModalities: Modality[] = ['llm'];

  private apiKey = '';

  private getBaseUrl(): string {
    return (this.config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.accessToken as string) || (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Anthropic doesn't have a simple health endpoint, so we just check if the API responds
    const response = await this.fetchWithTimeout(
      `${this.getBaseUrl()}/v1/messages`,
      {
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
      }
    );
    // Accept 200 (success) or 400 (bad request = endpoint exists but params wrong)
    // Reject 401/403 (auth), 429 (rate limited = degraded), 5xx (service down)
    if (response.status === 401 || response.status === 403) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Anthropic auth error: ${httpError.message}`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Anthropic health check failed: HTTP ${response.status}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'llm') {
      throw new Error(`Anthropic only supports LLM modality, got: ${request.modality}`);
    }

    const baseUrl = this.getBaseUrl();
    const start = Date.now();

    // Convert internal messages to Anthropic ClaudeMessageParam format,
    // injecting prompt-cache breakpoints when the request doesn't already
    // carry its own (planPromptCache defers to caller-supplied ones).
    const plan = planPromptCache(request);
    const { system, messages } = convertMessagesToAnthropic(request.messages || [], plan);

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
          tools: toAnthropicTools(request.tools),
          tool_choice: toAnthropicToolChoice(request.tool_choice),
          temperature: request.temperature,
          top_p: request.top_p,
          stop_sequences: request.stop,
          stream: false,
        }),
        timeoutMs: options?.timeoutMs ?? 120000,
        signal: options?.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Anthropic: ${httpError.message}`, this.providerId, response.status);
      }

      const data = await response.json() as Record<string, unknown>;
      const latencyMs = Date.now() - start;

      // Parse the FULL content array -- not just content[0] -- so tool_use
      // blocks survive alongside (or instead of) text.
      const parsedContent = parseAnthropicContentBlocks(data.content);

      return {
        modality: 'llm',
        requestId: data.id as string,
        providerId: this.providerId,
        modelId: data.model as string,
        message: {
          role: 'assistant',
          content: parsedContent.text,
          ...(parsedContent.toolCalls ? { tool_calls: parsedContent.toolCalls } : {}),
        },
        // Anthropic's `input_tokens` is only the uncached remainder --
        // normalizeAnthropicUsage adds the cache read/write components back
        // in so prompt_tokens reflects the full prompt, matching the other
        // providers' meaning of the field.
        usage: normalizeAnthropicUsage(data.usage),
        finishReason: mapAnthropicStopReason(data.stop_reason as string | null | undefined),
        latencyMs,
      };
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const baseUrl = this.getBaseUrl();
    const plan = planPromptCache(request);
    const { system, messages } = convertMessagesToAnthropic(request.messages || [], plan);

    let response: Response;
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
          tools: toAnthropicTools(request.tools),
          tool_choice: toAnthropicToolChoice(request.tool_choice),
          temperature: request.temperature,
          top_p: request.top_p,
          stop_sequences: request.stop,
          stream: true,
        }),
        // Forward the caller's AbortSignal so a client disconnect
        // (e.g. SSE consumer gone) cancels the upstream request.
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (err) {
      throw this.handleAdapterError(err, 'stream');
    }

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Anthropic stream: ${httpError.message}`, this.providerId, response.status);
    }

    // Anthropic's SSE protocol is event-typed (message_start /
    // content_block_start / content_block_delta / message_delta /
    // message_stop / ...), not choice/delta-shaped like OpenAI's, and needs
    // its own parser to surface text AND tool_use streaming correctly.
    yield* createAnthropicSSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic doesn't have a models endpoint, return known models
    return [
      { modelId: 'claude-3-5-sonnet-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
      { modelId: 'claude-3-5-haiku-20241022', modality: 'llm', capabilities: ['vision', 'tool_use'] },
      { modelId: 'claude-3-opus-20240229', modality: 'llm', capabilities: ['vision', 'tool_use'] },
    ];
  }

}
