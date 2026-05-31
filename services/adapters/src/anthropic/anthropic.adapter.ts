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
  ContentPart,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import {
  createHttpError,
  logger,
  EventStream,
  type HttpMeta,
  type ClaudeMessageParam,
  type ClaudeTextBlockParam,
  type ClaudeImageBlockParam,
  type ClaudeToolUseBlockParam,
  type ClaudeToolResultBlockParam,
} from '@dmr-x/utils';

export class AnthropicAdapter extends BaseAdapter {
  readonly providerId = 'anthropic';
  readonly supportedModalities: Modality[] = ['llm'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Anthropic doesn't have a simple health endpoint, so we just check if the API responds
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl || 'https://api.anthropic.com'}/v1/messages`,
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
    // We expect 200 or 400 (bad request), not 401/403 (auth issues)
    if (response.status === 401 || response.status === 403) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Anthropic auth error: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'llm') {
      throw new Error(`Anthropic only supports LLM modality, got: ${request.modality}`);
    }

    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
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
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Anthropic: ${httpError.message}`, this.providerId, response.status);
      }

      const data = await response.json() as Record<string, unknown>;
      const latencyMs = Date.now() - start;

      return {
        modality: 'llm',
        requestId: data.id as string,
        providerId: this.providerId,
        modelId: data.model as string,
        message: {
          role: 'assistant',
          content: (data.content as any[])?.[0]?.text || '',
        },
        usage: {
          prompt_tokens: (data.usage as Record<string, number>)?.input_tokens || 0,
          completion_tokens: (data.usage as Record<string, number>)?.output_tokens || 0,
          total_tokens: ((data.usage as Record<string, number>)?.input_tokens || 0) + ((data.usage as Record<string, number>)?.output_tokens || 0),
        },
        finishReason: (data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason) as 'stop' | 'length' | 'tool_calls' | 'content_filter' | null | undefined,
        latencyMs,
      };
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
    const { system, messages } = this.convertMessages(request.messages || []);

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
          temperature: request.temperature,
          stream: true,
        }),
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

    if (!response.body) throw new Error('Response body is null');

    // Use EventStream for robust SSE parsing (handles multiple boundary formats)
    const eventStream = new EventStream<Record<string, unknown>>(
      response.body,
      (msg) => {
        if (!msg.data) return { done: true, value: undefined };
        try {
          const parsed = JSON.parse(msg.data) as Record<string, unknown>;
          return { done: false, value: parsed };
        } catch (parseError) {
          // Skip malformed JSON -- return a sentinel that we filter below
          logger.debug({ err: parseError }, 'Anthropic SSE: skipped malformed JSON chunk');
          return { done: false, value: { _malformed: true } as Record<string, unknown> };
        }
      },
      { dataRequired: true },
    );

    let index = 0;

    for await (const parsed of eventStream) {
      // Skip malformed entries
      if (!parsed || (parsed as any)._malformed) continue;

      if (parsed.type === 'content_block_delta') {
        yield {
          type: 'token',
          data: { content: (parsed.delta as Record<string, string>)?.text || '' },
          index: index++,
        };
      } else if (parsed.type === 'message_stop') {
        yield {
          type: 'done',
          data: {},
          index: index++,
        };
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
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
  private convertMessages(messages: NonNullable<UnifiedRequest['messages']>): {
    system?: string;
    messages: ClaudeMessageParam[];
  } {
    let system: string | undefined;
    const converted: ClaudeMessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      if (msg.role === 'tool') {
        // Tool results become tool_result content blocks on a user message
        const toolResult: ClaudeToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };
        // Append to last user message or create a new one
        const lastMsg = converted[converted.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(toolResult);
        } else {
          converted.push({
            role: 'user',
            content: [toolResult],
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // Assistant message with tool calls
        const contentBlocks: (ClaudeTextBlockParam | ClaudeToolUseBlockParam)[] = [];

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
        converted.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      } else {
        // Convert ContentPart[] to Claude content blocks
        const contentBlocks: (ClaudeTextBlockParam | ClaudeImageBlockParam)[] =
          msg.content.map((part: ContentPart) => this.contentPartToClaudeBlock(part));
        converted.push({ role: msg.role as 'user' | 'assistant', content: contentBlocks });
      }
    }

    return { system, messages: converted };
  }

  /**
   * Convert an internal ContentPart to a Claude content block.
   */
  private contentPartToClaudeBlock(
    part: ContentPart,
  ): ClaudeTextBlockParam | ClaudeImageBlockParam {
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
  private extractTextFromContentParts(parts: ContentPart[]): string {
    return parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
  }

  /**
   * Safely parse a JSON string, returning the raw string on failure.
   */
  private safeParseJson(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str);
    } catch {
      return { _raw: str };
    }
  }
}
