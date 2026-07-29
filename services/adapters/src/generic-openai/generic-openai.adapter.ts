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
  /** Credential this adapter was initialised with (provider vault / OAuth). */
  private configuredKey = '';
  private apiKeys: string[] = [];
  private keyIndex = 0;
  healthCheckTimeoutMs: number = 30000;

  constructor(providerId: string) {
    super();
    this.providerId = providerId;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.configuredKey = (config.accessToken as string) || (config.apiKey as string) || '';
    this.apiKey = this.configuredKey;

    // Load keys from rotation service.
    //
    // Rotation exists to spread load across a POOL of keys
    // (`X_API_KEYS=a,b,c` or `X_API_KEY_1..n`). A single ambient env var is
    // not a pool, and must not replace the credential this adapter was
    // initialised with from the provider vault — an OS-level env var that had
    // gone stale silently shadowed the working vault key and 401'd every chat
    // request, while `/v1/models` health checks kept passing because they run
    // before rotation is consulted.
    const loadedKeys = keyRotationService.loadKeys(this.providerId);
    if (loadedKeys.length > 1 || (loadedKeys.length === 1 && !this.configuredKey)) {
      this.apiKeys = loadedKeys;
      this.keyIndex = 0;
      this.apiKey = loadedKeys[0];
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
   * Set multiple keys for round-robin rotation.
   *
   * The pool is also handed to `keyRotationService`, because `getCurrentKey`
   * asks that service first. The service only ever learned keys from the
   * environment, so a provider that had one env key plus a vault pool
   * rotated over the env key alone — every request went to the same
   * credential and the other keys never took any load.
   */
  setKeys(keys: string[]): void {
    this.apiKeys = keys;
    this.keyIndex = 0;
    if (keys.length > 0) {
      this.apiKey = keys[0];
      keyRotationService.registerKeys(this.providerId, keys);
    }
  }

  /**
   * Get the current key for requests — delegates to key rotation service
   */
  private getCurrentKey(): string {
    // Single credential (the common case) → use it as-is. Consulting the
    // rotation service here would hand back an unrelated ambient env var.
    if (this.apiKeys.length <= 1) return this.apiKey;

    // A real pool → prefer quota-aware smart rotation, else round-robin.
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

  /**
   * Resolve the chat/completions URL for an arbitrary OpenAI-compatible
   * upstream. Some providers expose the endpoint WITH `/v1` already in
   * their base URL (e.g. `https://opencode.ai/zen/v1`,
   * `https://codestral.mistral.ai/v1`) while others point at the origin
   * or a custom path. We append `/chat/completions` when the base already
   * contains `/v1` (or `/v1beta`), otherwise add `/v1/chat/completions`,
   * so a single generic adapter works for both shapes.
   */
  private getChatCompletionsUrl(): string {
    const base = (this.config.baseUrl || '').replace(/\/+$/, '');
    // Already a full chat/completions path → use as-is.
    if (/\/chat\/completions$/.test(base)) return base;
    // Base already ends at the OpenAI mount: `/v1`, `/v1beta`, or the
    // Google OpenAI-compatible mount `/v1beta/openai` (and similar
    // `.../openai` paths). Append the endpoint directly.
    if (/\/(v1beta\/openai|v1|v1beta|openai)$/.test(base)) {
      return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
  }

  /**
   * Build a minimal, well-formed OpenAI chat body.
   *
   * Forwards only fields that real OpenAI-compatible APIs expect
   * (`model`, `messages`, `stream`, `temperature`, `max_tokens`, `top_p`,
   * `tools`, `tool_choice`, etc.) and DROPS `null`/`undefined`/empty
   * optional values instead of forwarding them blindly. This matters
   * because `JSON.stringify` emits `"seed":null` for a `null` seed, and
   * several strict upstreams (Mistral Codestral, opencode-zen) reject a
   * stray `seed: null` (and other empty params) with HTTP 400, which
   * otherwise 502s the whole request. We never strip fields that legit
   * OpenAI-compatible endpoints rely on, so providers like OpenRouter,
   * Together, and Groq keep working exactly as before.
   */
  private buildChatBody(request: UnifiedRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream,
    };

    const addIfPresent = (key: string, value: unknown): void => {
      if (value === undefined || value === null) return;
      if (typeof value === 'string' && value.trim() === '') return;
      if (Array.isArray(value) && value.length === 0) return;
      body[key] = value;
    };

    addIfPresent('temperature', request.temperature);
    addIfPresent('max_tokens', request.max_tokens);
    addIfPresent('top_p', request.top_p);
    addIfPresent('frequency_penalty', request.frequency_penalty);
    addIfPresent('presence_penalty', request.presence_penalty);
    addIfPresent('stop', request.stop);
    addIfPresent('seed', request.seed);
    addIfPresent('response_format', request.response_format);
    addIfPresent('n', request.n);

    // Only send tool calling when tools are actually provided.
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools;
      addIfPresent('tool_choice', request.tool_choice);
    }

    return body;
  }

  protected async checkHealth(): Promise<void> {
    // Boot-time health check: lightweight reachability probe only.
    // A real generation (chat-completion) probe is available via
    // checkGenerationCapability() and is intended to run on the periodic,
    // non-blocking HealthChecker — NOT during synchronous adapter init, where
    // a generation probe per provider would block gateway startup for minutes
    // when upstreams are slow/unreachable.
    const key = this.getCurrentKey();
    const headers: Record<string, string> = {};
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const res = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
      headers,
      timeoutMs: this.healthCheckTimeoutMs,
    });

    // 401/403 means the key is invalid/revoked and the provider cannot be
    // used — fail health. Other statuses (incl. 400/404/429) are tolerated as
    // reachable. We do NOT fail on a non-200 /models because some providers
    // (e.g. Google's OpenAI mount) don't expose /models.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Provider ${this.providerId} returned HTTP ${res.status} on /models — invalid or expired API key`,
      );
    }
  }

  /**
   * Generation-capability probe — performs a tiny chat completion to verify
   * the key can actually generate (catches revoked keys that still pass a
   * /models ping). Intended for the periodic, non-blocking HealthChecker,
   * NOT the synchronous boot checkHealth().
   */
  async checkGenerationCapability(): Promise<boolean> {
    const key = this.getCurrentKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const probeModel = (this.config as any)?.model || 'ping';
    try {
      const res = await this.fetchWithTimeout(this.getChatCompletionsUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: probeModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        timeoutMs: this.healthCheckTimeoutMs,
      });
      // 401/403 = invalid/revoked key => cannot generate.
      return res.status !== 401 && res.status !== 403;
    } catch {
      // A thrown probe (timeout, TLS blip, DNS hiccup, transient network
      // error) is UNKNOWN — NOT proof the provider is dead. Returning `false`
      // here would let a concurrent health-check sweep poison otherwise
      // reachable providers, collapsing the candidate pool and forcing all
      // `auto` traffic onto a single surviving backend. Genuinely-dead
      // providers are still caught at request time by the router's circuit
      // breaker + fallback chain. Only a definitive 401/403 (revoked key)
      // means "unhealthy".
      return true;
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

  /**
   * Try the request across the key pool.
   *
   * Before this, a single key-scoped failure failed the whole request even
   * when a sibling key would have served it, and the router then blacklisted
   * the model for a year on the strength of that one 404. With five free-tier
   * keys per provider that is the difference between a working pool and an
   * effectively single-key setup.
   *
   * This adapter keeps its own loop rather than using `BaseAdapter.withKeyRotation`
   * because its credential lives in `apiKeys` (fed by `getCurrentKey`'s
   * quota-aware rotation) rather than in the base `keyPool`. The retry policy —
   * `KEY_SCOPED_STATUSES` — is shared with the base class.
   *
   * With no pool (or one key) this is exactly one attempt — same as before.
   */
  private async executeChat(
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const attempts = Math.max(1, this.apiKeys.length);
    let lastError: unknown;
    // First attempt goes through normal (quota-aware) rotation. Retries walk
    // the pool explicitly from there: smart rotation scores by remaining
    // quota and would happily hand back the key that just failed, which
    // would burn every attempt on the same credential.
    const firstKey = this.getCurrentKey();
    const startIndex = Math.max(0, this.apiKeys.indexOf(firstKey));

    for (let i = 0; i < attempts; i++) {
      const key = i === 0 ? firstKey : this.apiKeys[(startIndex + i) % this.apiKeys.length];
      try {
        return await this.executeChatOnce(request, options, key);
      } catch (error) {
        lastError = error;
        const status = (error as { statusCode?: number })?.statusCode;
        const isLast = i === attempts - 1;
        if (isLast || !status || !GenericOpenAIAdapter.KEY_SCOPED_STATUSES.has(status)) {
          throw error;
        }
        logger.warn(
          { providerId: this.providerId, model: request.model, status, attempt: i + 1, of: attempts },
          'Key-scoped failure — retrying on the next key in the pool',
        );
      }
    }

    throw lastError;
  }

  private async executeChatOnce(
    request: UnifiedRequest,
    options?: ExecuteOptions,
    keyOverride?: string,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const key = keyOverride ?? this.getCurrentKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout(this.getChatCompletionsUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildChatBody(request, false)),
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
      response = await this.fetchWithTimeout(this.getChatCompletionsUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildChatBody(request, true)),
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
