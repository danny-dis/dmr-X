import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { keyRotationService } from '@dmr-x/quota';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { convertMessagesToAnthropic } from '../anthropic-messages.js';
import {
  toAnthropicTools,
  toAnthropicToolChoice,
  parseAnthropicContentBlocks,
  mapAnthropicStopReason,
} from '../anthropic-tools.js';
import { createAnthropicSSEIterator } from '../stream-normalizer.js';

/**
 * Generic Anthropic-compatible adapter for third-party providers
 * that expose an Anthropic-format API (proxies, self-hosted, etc.).
 *
 * Supports key rotation, rate limit tracking, and multi-key pools
 * just like GenericOpenAIAdapter.
 */
export class GenericAnthropicAdapter extends BaseAdapter {
  readonly providerId: string;
  readonly supportedModalities: Modality[] = ['llm'];

  private apiKey = '';
  /** Credential this adapter was initialised with (provider vault / OAuth). */
  private configuredKey = '';
  private apiKeys: string[] = [];
  private keyIndex = 0;

  constructor(providerId: string) {
    super();
    this.providerId = providerId;
  }

  private getBaseUrl(): string {
    return (this.config.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.configuredKey = (config.accessToken as string) || (config.apiKey as string) || '';
    this.apiKey = this.configuredKey;

    // Rotation exists to spread load across a POOL of keys. A single ambient
    // env var is not a pool and must not replace the vault credential this
    // adapter was initialised with — see generic-openai for the failure mode.
    const loadedKeys = keyRotationService.loadKeys(this.providerId);
    if (loadedKeys.length > 1 || (loadedKeys.length === 1 && !this.configuredKey)) {
      this.apiKeys = loadedKeys;
      this.keyIndex = 0;
      this.apiKey = loadedKeys[0];
    } else if (this.apiKey) {
      this.apiKeys = [this.apiKey];
    }

    // Enable rate limit tracking
    this.enableRateLimitTracking();
  }

  /**
   * See GenericOpenAIAdapter.setKeys — the pool must also reach
   * `keyRotationService`, which `getCurrentKey` consults first and which
   * otherwise only knows the environment's single key.
   */
  setKeys(keys: string[]): void {
    this.apiKeys = keys;
    this.keyIndex = 0;
    if (keys.length > 0) {
      this.apiKey = keys[0];
      keyRotationService.registerKeys(this.providerId, keys);
    }
  }

  private getCurrentKey(): string {
    // Single credential → use it as-is; consulting rotation here would hand
    // back an unrelated ambient env var.
    if (this.apiKeys.length <= 1) return this.apiKey;

    const rotated = keyRotationService.getNextKey(this.providerId);
    if (rotated) {
      this.apiKey = rotated;
      return rotated;
    }
    const key = this.apiKeys[this.keyIndex % this.apiKeys.length];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    this.apiKey = key;
    return key;
  }

  protected async checkHealth(): Promise<void> {
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (key) {
      headers['x-api-key'] = key;
    }

    const response = await this.fetchWithTimeout(
      `${this.getBaseUrl()}/v1/messages`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        timeoutMs: 10000,
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Auth error: HTTP ${response.status}`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Health check failed: HTTP ${response.status}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'llm') {
      throw new Error(`Unsupported modality: ${request.modality}`);
    }

    const start = Date.now();
    const key = this.getCurrentKey();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (key) {
      headers['x-api-key'] = key;
    }

    // Convert messages to Anthropic format, preserving tool_use/tool_result
    // history and image blocks instead of flattening them to text.
    const { system, messages } = convertMessagesToAnthropic(request.messages || []);

    const body: Record<string, any> = {
      model: request.model,
      max_tokens: request.max_tokens || 4096,
      messages,
      tools: toAnthropicTools(request.tools),
      tool_choice: toAnthropicToolChoice(request.tool_choice),
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
    if (request.stop) body.stop_sequences = request.stop;

    try {
      const response = await this.fetchWithTimeout(
        `${this.getBaseUrl()}/v1/messages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
          timeoutMs: options?.timeoutMs ?? 120000,
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new ProviderError(
          `Anthropic API error: ${response.status} ${errorBody}`,
          this.providerId,
          response.status,
        );
      }

      const data: any = await response.json();
      const latencyMs = Date.now() - start;

      // Parse the FULL content array -- not just joined text -- so tool_use
      // blocks survive alongside (or instead of) text.
      const parsedContent = parseAnthropicContentBlocks(data.content);

      return {
        modality: 'llm',
        requestId: data.id || `msg_${Date.now()}`,
        providerId: this.providerId,
        modelId: data.model || request.model,
        latencyMs,
        usage: {
          prompt_tokens: data.usage?.input_tokens || 0,
          completion_tokens: data.usage?.output_tokens || 0,
          total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        message: {
          role: 'assistant',
          content: parsedContent.text,
          ...(parsedContent.toolCalls ? { tool_calls: parsedContent.toolCalls } : {}),
        },
        finishReason: mapAnthropicStopReason(data.stop_reason),
      };
    } catch (error) {
      throw this.handleAdapterError(error);
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const key = this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (key) {
      headers['x-api-key'] = key;
    }

    const { system, messages } = convertMessagesToAnthropic(request.messages || []);

    const body: Record<string, any> = {
      model: request.model,
      max_tokens: request.max_tokens || 4096,
      messages,
      tools: toAnthropicTools(request.tools),
      tool_choice: toAnthropicToolChoice(request.tool_choice),
      stream: true,
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
    if (request.stop) body.stop_sequences = request.stop;

    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.getBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(
        `Anthropic API error: ${response.status} ${errorBody}`,
        this.providerId,
        response.status,
      );
    }

    // Anthropic's SSE protocol is event-typed, not choice/delta-shaped like
    // OpenAI's -- see createAnthropicSSEIterator's docstring. Using
    // createOpenAISSEIterator here is what left every stream through an
    // Anthropic-compatible custom provider silently empty.
    yield* createAnthropicSSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    // Generic Anthropic providers don't have a standard models endpoint
    // Return empty list — models are configured manually
    return [];
  }
}
