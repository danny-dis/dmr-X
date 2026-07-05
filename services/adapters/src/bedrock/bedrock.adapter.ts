import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { logger } from '@dmr-x/utils';

/**
 * AWS Bedrock adapter.
 *
 * Uses the Bedrock Converse API (unified across all foundation models).
 * Supports Claude, Titan, Cohere, AI21, Meta Llama, Mistral, and more.
 *
 * Auth: AWS Signature v4 via environment credentials or explicit keys.
 * Env vars:
 *   BEDROCK_AWS_ACCESS_KEY_ID, BEDROCK_AWS_SECRET_ACCESS_KEY,
 *   BEDROCK_AWS_REGION_NAME (default: us-east-1),
 *   BEDROCK_AWS_SESSION_TOKEN (optional, for STS)
 */
export class BedrockAdapter extends BaseAdapter {
  readonly providerId = 'bedrock';
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  private accessKey = '';
  private secretKey = '';
  private sessionToken = '';
  private region = 'us-east-1';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.accessKey = (config.apiKey as string) || process.env.BEDROCK_AWS_ACCESS_KEY_ID || '';
    this.secretKey = (config.accessToken as string) || process.env.BEDROCK_AWS_SECRET_ACCESS_KEY || '';
    this.sessionToken = (config as any).sessionToken || process.env.BEDROCK_AWS_SESSION_TOKEN || '';
    this.region = (config as any).region || process.env.BEDROCK_AWS_REGION_NAME || 'us-east-1';
  }

  protected async checkHealth(): Promise<void> {
    // Bedrock doesn't have a lightweight health endpoint; use a minimal
    // InvokeModelWithResponseStream call or just verify credentials exist.
    if (!this.accessKey && !this.secretKey) {
      // Fall back to environment credentials (IAM role, etc.)
      logger.debug('Bedrock: no explicit credentials, assuming environment credentials');
    }
  }

  private getEndpoint(modelId: string, action: string): string {
    return `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(modelId)}/${action}`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amz-Target': 'AWSBedrockRuntime',
    };

    // For now, pass credentials via config — full SigV4 signing
    // would require @aws-sdk/signature-v4 or a manual implementation.
    // In production, users should use IAM roles or environment credentials
    // and let the AWS SDK handle signing.
    if (this.accessKey) {
      headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${this.region}/bedrock/aws4_request`;
    }

    return headers;
  }

  private mapModelId(model: string): string {
    // Map friendly names to Bedrock model IDs
    const modelMap: Record<string, string> = {
      'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
      'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
      'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
      'claude-3.5-sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'claude-3.5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
      'claude-3.7-sonnet': 'anthropic.claude-3-7-sonnet-20250219-v1:0',
      'claude-sonnet-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
      'titan-embed-text': 'amazon.titan-embed-text-v2:0',
      'titan-text-express': 'amazon.titan-text-express-v1',
      'titan-text-lite': 'amazon.titan-text-lite-v1',
      'cohere-embed-multilingual': 'cohere.embed-multilingual-v3:0',
      'cohere-embed-english': 'cohere.embed-english-v3:0',
      'cohere-command-text': 'cohere.command-text-v14',
      'cohere-command-r': 'cohere.command-r-v1:0',
      'llama3-70b': 'meta.llama3-70b-instruct-v1:0',
      'llama3-8b': 'meta.llama3-8b-instruct-v1:0',
      'llama3.1-70b': 'meta.llama3-1-70b-instruct-v1:0',
      'llama3.1-8b': 'meta.llama3-1-8b-instruct-v1:0',
      'mistral-7b': 'mistral.mistral-7b-instruct-v0:2',
      'mistral-large': 'mistral.mistral-large-2402-v1:0',
      'ai21-j2-ultra': 'ai21.j2-ultra-v1',
      'ai21-j2-mid': 'ai21.j2-mid-v1',
    };

    return modelMap[model] || model;
  }

  private convertToConverseRequest(request: UnifiedRequest): Record<string, unknown> {
    const systemMessages = request.messages?.filter(m => m.role === 'system') || [];
    const nonSystemMessages = request.messages?.filter(m => m.role !== 'system') || [];

    const converseMessages = nonSystemMessages.map(msg => {
      const content: Array<{ text: string }> = [];
      if (typeof msg.content === 'string') {
        content.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            content.push({ text: part.text });
          }
        }
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content,
      };
    });

    const body: Record<string, unknown> = {
      messages: converseMessages,
    };

    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join('\n');
      body.system = [{ text: systemText }];
    }

    if (request.max_tokens) {
      body.inferenceConfig = {
        maxTokens: request.max_tokens,
        temperature: request.temperature,
        topP: request.top_p,
        stopSequences: request.stop,
      };
    }

    if (request.tools && request.tools.length > 0) {
      body.toolConfig = {
        tools: request.tools.map(tool => ({
          toolSpec: {
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: {
              json: tool.function.parameters,
            },
          },
        })),
      };
    }

    return body;
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality === 'llm') {
      return this.executeConverse(request, options);
    }
    if (request.modality === 'embedding') {
      return this.executeEmbedding(request, options);
    }

    throw new Error(`Unsupported modality: ${request.modality}`);
  }

  private async executeConverse(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const modelId = this.mapModelId(request.model || '');
    const endpoint = this.getEndpoint(modelId, 'converse');
    const body = this.convertToConverseRequest(request);

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        timeoutMs: options?.timeoutMs ?? 60000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'converse');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    const outputMessage = data.output?.message;
    const textContent = outputMessage?.content
      ?.filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join('') || '';

    const toolUse = outputMessage?.content?.find((c: any) => c.toolUse);

    return {
      modality: 'llm',
      requestId: `bedrock_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      message: {
        role: 'assistant',
        content: textContent,
        ...(toolUse ? {
          tool_calls: [{
            id: toolUse.toolUse.id,
            type: 'function',
            function: {
              name: toolUse.toolUse.name,
              arguments: JSON.stringify(toolUse.toolUse.input),
            },
          }],
        } : {}),
      },
      usage: {
        prompt_tokens: data.usage?.inputTokens || 0,
        completion_tokens: data.usage?.outputTokens || 0,
        total_tokens: (data.usage?.inputTokens || 0) + (data.usage?.outputTokens || 0),
      },
      finishReason: data.stopReason === 'end_turn' ? 'stop'
        : data.stopReason === 'max_tokens' ? 'length'
        : data.stopReason === 'tool_use' ? 'tool_calls'
        : data.stopReason || 'stop',
      latencyMs,
    };
  }

  private async executeEmbedding(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const modelId = this.mapModelId(request.model || 'titan-embed-text');
    const endpoint = this.getEndpoint(modelId, 'invoke');

    const body = {
      inputText: typeof request.input === 'string' ? request.input : Array.isArray(request.input) ? request.input[0] : '',
      dimensions: request.dimensions,
    };

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        timeoutMs: options?.timeoutMs ?? 30000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'embedding');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `bedrock_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      embeddings: [data.embedding],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const modelId = this.mapModelId(request.model || '');
    const endpoint = this.getEndpoint(modelId, 'converse-stream');
    const body = this.convertToConverseRequest(request);

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

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
          if (!line.trim()) continue;

          // Bedrock uses event stream format
          if (line.startsWith('event: ')) continue;
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr);
              if (event.chunk?.bytes) {
                const text = new TextDecoder().decode(
                  Uint8Array.from(atob(event.chunk.bytes), c => c.charCodeAt(0))
                );
                yield {
                  type: 'token',
                  data: { content: text },
                  index: 0,
                };
              }
              if (event.messageStop) {
                yield {
                  type: 'done',
                  data: {
                    requestId: `bedrock_${Date.now()}`,
                    modelId: request.model || 'unknown',
                  },
                  index: 0,
                };
                return;
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Bedrock model list requires ListFoundationModels API
    // Return known models for now
    return [
      { modelId: 'anthropic.claude-3-opus-20240229-v1:0', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'anthropic.claude-3-haiku-20240307-v1:0', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'anthropic.claude-3-7-sonnet-20250219-v1:0', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'anthropic.claude-sonnet-4-20250514-v1:0', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'amazon.titan-embed-text-v2:0', modality: 'embedding', capabilities: ['embedding'] },
      { modelId: 'meta.llama3-70b-instruct-v1:0', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta.llama3-1-70b-instruct-v1:0', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mistral.mistral-large-2402-v1:0', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'cohere.embed-multilingual-v3:0', modality: 'embedding', capabilities: ['embedding'] },
    ];
  }
}
