import { BaseAdapter } from '../base.adapter.js';
import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, logger, type HttpMeta } from '@dmr-x/utils';

/** Parse an NDJSON (newline-delimited JSON) response body into an async iterable. */
async function* parseNDJSON<T extends Record<string, unknown>>(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<T> {
  if (!body) throw new Error('Response body is null');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as T;
        } catch (parseErr) {
          logger.debug({ err: parseErr }, 'Ollama NDJSON: skipped malformed JSON line');
        }
      }
    }
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as T;
      } catch (parseErr) {
        logger.debug({ err: parseErr }, 'Ollama NDJSON: skipped malformed JSON remainder');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OllamaAdapter extends BaseAdapter {
  readonly providerId = 'ollama';
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  protected async checkHealth(): Promise<void> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const response = await this.fetchWithTimeout(`${baseUrl}/api/tags`, {
      timeoutMs: 5000,
    });
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Ollama health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const start = Date.now();

    try {
      if (request.modality === 'llm') {
        return this.executeChat(baseUrl, request, options);
      }

      if (request.modality === 'embedding') {
        return this.executeEmbedding(baseUrl, request, options);
      }

      throw new Error(`Unsupported modality: ${request.modality}`);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private async executeChat(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
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
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Ollama: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'llm',
      requestId: `ollama_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model as string,
      message: {
        role: 'assistant',
        content: (data.message as Record<string, unknown>)?.content as string || '',
      },
      usage: {
        prompt_tokens: (data.prompt_eval_count as number) || 0,
        completion_tokens: (data.eval_count as number) || 0,
        total_tokens: ((data.prompt_eval_count as number) || 0) + ((data.eval_count as number) || 0),
      },
      finishReason: data.done ? 'stop' : 'length',
      latencyMs,
    };
  }

  private async executeEmbedding(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
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
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Ollama embedding: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `ollama_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'nomic-embed-text',
      embeddings: [data.embedding as number[]],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
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
      // Forward the caller's AbortSignal so a client disconnect
      // (e.g. SSE consumer gone) cancels the upstream request.
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? 120000,
    });

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Ollama stream: ${httpError.message}`, this.providerId, response.status);
    }

    let index = 0;
    for await (const parsed of parseNDJSON<{ message?: { content?: string }; done?: boolean }>(response.body)) {
      if (parsed.message?.content) {
        yield { type: 'token', data: { content: parsed.message.content }, index: index++ };
      }
      if (parsed.done) {
        yield { type: 'done', data: {}, index: index++ };
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const response = await this.fetchWithTimeout(`${baseUrl}/api/tags`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    return ((data.models as any[]) || []).map((model: any) => ({
      modelId: model.name,
      modality: 'llm' as Modality,
      capabilities: [],
    }));
  }
}
