import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { HttpError, logger } from '@dmr-x/utils';
import { keyRotationService } from '@dmr-x/quota';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
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
  readonly providerId: string;
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  private apiKey = '';
  private apiKeys: string[] = [];
  private keyIndex = 0;
  healthCheckTimeoutMs: number = 30000;

  constructor(providerId: string) {
    super();
    this.providerId = providerId;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.accessToken as string) || (config.apiKey as string) || '';

    // Load keys from rotation service
    const loadedKeys = keyRotationService.loadKeys(this.providerId);
    if (loadedKeys.length > 0) {
      this.apiKeys = loadedKeys;
      this.keyIndex = 0;
    } else if (this.apiKey) {
      this.apiKeys = [this.apiKey];
    }

    // Enable rate limit tracking so response headers feed smart rotation
    this.enableRateLimitTracking();

    // Allow configurable health check timeout (for cold-start providers)
    if (this.config.healthCheckTimeoutMs != null) {
      this.healthCheckTimeoutMs = Number(this.config.healthCheckTimeoutMs);
    }

    // Some free providers (e.g., Pollinations) don't need an API key
  }

  /**
   * Set multiple keys for round-robin rotation
   */
  setKeys(keys: string[]): void {
    this.apiKeys = keys;
    this.keyIndex = 0;
    if (keys.length > 0) {
      this.apiKey = keys[0];
    }
  }

  /**
   * Get the current key for requests — delegates to key rotation service
   */
  private getCurrentKey(): string {
    // Use smart rotation if multiple keys available
    const rotated = keyRotationService.getNextKey(this.providerId);
    if (rotated) {
      this.apiKey = rotated;
      return rotated;
    }

    // Fallback to local round-robin
    if (this.apiKeys.length <= 1) return this.apiKey;
    const key = this.apiKeys[this.keyIndex % this.apiKeys.length];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    this.apiKey = key;
    return key;
  }

  protected async checkHealth(): Promise<void> {
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {};
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    try {
      // Try /models endpoint first
      await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
        headers,
        timeoutMs: this.healthCheckTimeoutMs,
      });
    } catch (error) {
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
          timeoutMs: this.healthCheckTimeoutMs,
        });
      } else {
        throw error;
      }
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    try {
      if (request.modality === 'llm') {
        return this.executeChat(request, options);
      }

      if (request.modality === 'embedding') {
        return this.executeEmbedding(request, options);
      }

      throw new Error(`Unsupported modality: ${request.modality}`);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private async executeChat(
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    let response: Response;
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
    } catch (error) {
      throw this.handleAdapterError(error, 'chat');
    }

    // Provider-specific header-based error detection
    // OpenRouter returns error info in response headers
    if (this.providerId === 'openrouter' && !response.ok) {
      const orError = response.headers.get('X-OpenRouter-Error-Message');
      const orType = response.headers.get('X-OpenRouter-Error-Type');
      if (orError) {
        let status = response.status;
        if (orType === 'rate_limited') status = 429;
        else if (orType === 'insufficient_quota') status = 402;
        else if (orType === 'invalid_api_key') status = 401;
        else if (orType === 'model_not_found') status = 404;
        throw new ProviderError(
          `${this.providerId} chat: ${orError}`,
          this.providerId,
          status,
        );
      }
    }

    const rawText = await response.text();
    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_parseErr) {
      // Some OpenAI-compatible providers (Pollinations legacy, Cloudflare
      // misconfigurations, etc.) return a non-JSON error body on 2xx
      // or send plain text. Surface the upstream body in the error so
      // the user can see WHY the provider failed instead of "Request
      // failed: 500".
      throw new ProviderError(
        `${this.providerId} chat: upstream returned non-JSON response (${response.status}): ${rawText.slice(0, 200)}`,
        this.providerId,
        response.status || 502,
      );
    }

    // Together AI puts status code inside error.code
    if (this.providerId === 'together' && data?.error?.code) {
      const code = parseInt(data.error.code, 10);
      if (!isNaN(code) && code >= 400) {
        throw new ProviderError(
          `${this.providerId} chat: ${data.error.message || JSON.stringify(data.error)}`,
          this.providerId,
          code,
        );
      }
    }

    // SiliconFlow returns 200 with error inside for rate limits
    if (this.providerId === 'siliconflow' && data?.error) {
      const msg = (data.error.message || '').toLowerCase();
      const code = msg.includes('rate limit') ? 429
                 : msg.includes('quota') ? 402
                 : msg.includes('auth') ? 401
                 : msg.includes('not found') ? 404
                 : response.status || 502;
      throw new ProviderError(
        `${this.providerId} chat: ${data.error.message || JSON.stringify(data.error)}`,
        this.providerId,
        code,
      );
    }

    if (data && data.error) {
      // Upstream returned an error envelope (e.g. Pollinations 429 with
      // { error: "Queue full...", status: 429 }). Throw as a ProviderError
      // so the router's fallback chain picks it up — and so the message
      // actually reaches the user.
      const status = data.status || response.status || 502;
      throw new ProviderError(
        `${this.providerId} chat: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`,
        this.providerId,
        status,
      );
    }

    // Gemini (free tier) returns 200 with finish_reason "content_filter" or
    // "safety" when content is blocked by safety filters instead of an error.
    // Throw a ProviderError so the fallback chain catches it.
    if (data.choices?.[0]?.finish_reason === 'content_filter' || data.choices?.[0]?.finish_reason === 'safety') {
      throw new ProviderError(
        `${this.providerId} chat: Response blocked by content safety filters (${data.choices[0].finish_reason})`,
        this.providerId,
        422,
      );
    }

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

  private async executeEmbedding(
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    let response: Response;
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
    } catch (error) {
      throw this.handleAdapterError(error, 'embedding');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model || request.model || 'unknown',
      embeddings: data.data?.map((d: any) => d.embedding),
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const key = this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    let response: Response;
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
        // Forward the caller's AbortSignal so a client disconnect
        // (e.g. SSE consumer gone) cancels the upstream request.
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    yield* createOpenAISSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {};
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
        headers,
      });
    } catch (error) {
      // Gracefully return empty list on any error (HTTP or transport)
      logger.debug({ err: error, providerId: this.providerId }, 'Failed to list models, returning empty list');
      return [];
    }

    const data: any = await response.json();
    return (data.data || []).map((model: any) => ({
      modelId: model.id,
      modality: 'llm' as Modality,
      capabilities: [],
    }));
  }
}
