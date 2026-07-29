import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk, Message, ContentPart } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

export class CohereAdapter extends BaseAdapter {
  readonly providerId = 'cohere';
  readonly supportedModalities: Modality[] = ['reranking', 'embedding', 'llm'];

  private configuredKey = '';

  /**
   * Resolves to the next key in the vault pool when the operator has stored
   * more than one, otherwise to the single configured credential. Reading
   * through a getter means every existing `this.apiKey` call site rotates
   * without change — Cohere's free keys carry a 20 rpm cap each, so a pool
   * of five is the difference between 20 and 100 rpm.
   */
  private get apiKey(): string {
    return this.nextKey(this.configuredKey);
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.configuredKey = (config.apiKey as string) || '';
    if (!this.configuredKey) {
      throw new Error('Cohere API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      'https://api.cohere.ai/v1/models',
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 5000,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Cohere health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    // Cohere's free keys are 20 rpm each, so operators stack several. Routing
    // the whole dispatch through the pool retry means a request that lands on
    // an exhausted key moves to a sibling instead of failing — measured at
    // 24/30 successes before this and 30/30 after, on a pool where two of the
    // five keys were quota-spent.
    return this.withKeyRotation(async () => {
      if (request.modality === 'reranking') {
        return this.executeRerank(request, options);
      }

      if (request.modality === 'embedding') {
        return this.executeEmbedding(request, options);
      }

      if (request.modality === 'llm') {
        return this.executeChat(request, options);
      }

      throw new Error(`Unsupported modality: ${request.modality}`);
    });
  }

  private async executeRerank(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    const start = Date.now();

    const response = await this.fetchWithTimeout(
      'https://api.cohere.ai/v1/rerank',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'rerank-english-v3.0',
          query: request.query,
          documents: request.documents,
          top_n: request.top_n,
        }),
        timeoutMs: options?.timeoutMs ?? 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Cohere rerank: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'reranking',
      requestId: `cohere_rerank_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'rerank-english-v3.0',
      rerankResults: ((data.results as any[]) || []).map((r: any) => ({
        index: r.index,
        relevance_score: r.relevance_score,
      })),
      latencyMs,
    };
  }

  private async executeEmbedding(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    const start = Date.now();

    const response = await this.fetchWithTimeout(
      'https://api.cohere.ai/v1/embed',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || 'embed-english-v3.0',
          texts: Array.isArray(request.input) ? request.input : [request.input || ''],
          input_type: 'search_document',
          embedding_types: ['float'],
        }),
        timeoutMs: options?.timeoutMs ?? 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Cohere embedding: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `cohere_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'embed-english-v3.0',
      embeddings: (data.embeddings as Record<string, unknown>)?.float as number[][] || [],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    if (request.modality !== 'llm') {
      const response = await this.execute(request, options);
      yield { type: 'done', data: response, index: 0 };
      return;
    }

    const start = Date.now();
    const body = this.buildCohereChatBody(request, true);
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: options?.timeoutMs ?? 60000,
    });

    if (!response.ok) {
      const text = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body: text };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Cohere chat: ${httpError.message}`, this.providerId, response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ProviderError('Cohere chat: no response body for stream', this.providerId, 502);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let completionText = '';
    let toolBuffers = new Map<number, { id?: string; name?: string; args: string }>();
    let nextToolIndex = 0;
    let finishReason: string | undefined;
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    const buildToolChunk = (idx: number): StreamChunk | null => {
      const tb = toolBuffers.get(idx);
      if (!tb) return null;
      toolBuffers.delete(idx);
      return {
        type: 'token',
        index: idx,
        data: {
          tool_calls: [
            {
              index: idx,
              id: tb.id,
              type: 'function',
              function: { name: tb.name, arguments: tb.args || '{}' },
            },
          ],
        },
      } as StreamChunk;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let data: any;
          try { data = JSON.parse(payload); } catch { continue; }

          if (data.delta?.message?.content?.text) {
            const text = data.delta.message.content.text as string;
            completionText += text;
            yield { type: 'token', index: 0, data: { content: text } } as StreamChunk;
          } else if (data.tool_call) {
            const idx = nextToolIndex++;
            toolBuffers.set(idx, { id: data.tool_call.id, name: data.tool_call.function?.name, args: '' });
          } else if (data.tool_call_delta) {
            const idx = data.tool_call_delta.index ?? 0;
            const tb = toolBuffers.get(idx) || { args: '' };
            if (data.tool_call_delta.function?.name && !tb.name) tb.name = data.tool_call_delta.function.name;
            if (data.tool_call_delta.function?.arguments) tb.args += data.tool_call_delta.function.arguments;
            toolBuffers.set(idx, tb);
          } else if (data.event_type === 'tool-call-end' || evt.includes('tool-call-end')) {
            // flush any buffered tool calls
            for (const idx of Array.from(toolBuffers.keys())) {
              const tc = buildToolChunk(idx);
              if (tc) yield tc;
            }
          } else if (data.finish_reason) {
            finishReason = data.finish_reason;
          } else if (data.usage) {
            usage = {
              prompt_tokens: data.usage.tokens?.input ?? 0,
              completion_tokens: data.usage.tokens?.output ?? 0,
              total_tokens: (data.usage.tokens?.input ?? 0) + (data.usage.tokens?.output ?? 0),
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    for (const idx of Array.from(toolBuffers.keys())) {
      const tc = buildToolChunk(idx);
      if (tc) yield tc;
    }

    yield {
      type: 'done',
      index: 0,
      data: {
        requestId: `cohere_${Date.now()}`,
        modelId: request.model || 'command-r',
        usage,
        finishReason: this.mapFinishReason(finishReason),
        latencyMs: Date.now() - start,
      },
    } as StreamChunk;
  }

  // --- Cohere v2 chat (non-OpenAI-compatible) ---

  private buildCohereChatBody(request: UnifiedRequest, stream: boolean): Record<string, unknown> {
    const messages = (request.messages || []).map((m) => this.toCohereMessage(m));
    const body: Record<string, unknown> = {
      model: request.model || 'command-r',
      messages,
      stream,
    };
    if (request.max_tokens != null) body.max_tokens = request.max_tokens;
    if (request.temperature != null) body.temperature = request.temperature;
    if (request.top_p != null) body.p = request.top_p;
    if (request.stop && request.stop.length) body.stop_sequences = request.stop;
    if (request.tools && request.tools.length) {
      const tools: any[] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
      }));
      body.tools = tools;
      if (request.tool_choice === 'required') body.force_single_step = true;
      else if (typeof request.tool_choice === 'object' && request.tool_choice.type === 'function') {
        const chosen = (request.tool_choice as { type: 'function'; function: { name: string } }).function.name;
        const found = tools.find((t: any) => t.function?.name === chosen);
        body.tools = found ? [found] : tools;
      }
    }
    return body;
  }

  private toCohereMessage(m: Message): Record<string, unknown> {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : this.textOf(m.content),
      };
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      return {
        role: 'assistant',
        tool_calls: m.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
    }
    const content: unknown =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p: ContentPart) =>
            p.type === 'text'
              ? { type: 'text', text: p.text }
              : p.type === 'image_url'
                ? { type: 'image', url: p.image_url.url }
                : { type: 'text', text: '' }
          );
    return { role: m.role, content };
  }

  private textOf(parts: ContentPart[] | string): string {
    if (typeof parts === 'string') return parts;
    return parts.filter((p) => p.type === 'text').map((p) => (p as any).text).join('');
  }

  private async executeChat(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    const start = Date.now();
    const body = this.buildCohereChatBody(request, false);

    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: options?.timeoutMs ?? 60000,
    });

    if (!response.ok) {
      const text = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body: text };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Cohere chat: ${httpError.message}`, this.providerId, response.status);
    }

    const data = (await response.json()) as any;
    const message = data.message || {};
    const textParts = (message.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    const toolCalls = (message.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function?.name,
        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
      },
    }));

    const usageTokens = data.usage?.tokens;
    const usage = usageTokens
      ? {
          prompt_tokens: usageTokens.input ?? 0,
          completion_tokens: usageTokens.output ?? 0,
          total_tokens: (usageTokens.input ?? 0) + (usageTokens.output ?? 0),
        }
      : undefined;

    return {
      modality: 'llm',
      requestId: `cohere_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'command-r',
      message: {
        role: 'assistant',
        content: textParts,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      usage,
      finishReason: this.mapFinishReason(data.finish_reason),
      latencyMs: Date.now() - start,
    };
  }

  private mapFinishReason(reason?: string): UnifiedResponse['finishReason'] {
    switch (reason) {
      case 'COMPLETE':
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'TOOL_CALL':
        return 'tool_calls';
      case 'CONTENT_FILTER':
        return 'content_filter';
      default:
        return reason ? ('stop' as const) : null;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'rerank-english-v3.0', modality: 'reranking', capabilities: ['reranking'] },
      { modelId: 'rerank-multilingual-v3.0', modality: 'reranking', capabilities: ['reranking', 'multilingual'] },
      { modelId: 'embed-english-v3.0', modality: 'embedding', capabilities: ['embedding'] },
      { modelId: 'embed-multilingual-v3.0', modality: 'embedding', capabilities: ['embedding', 'multilingual'] },
    ];
  }
}
