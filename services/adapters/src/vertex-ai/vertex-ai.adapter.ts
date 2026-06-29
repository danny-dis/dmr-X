import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { createOpenAISSEIterator } from '../stream-normalizer.js';

/**
 * Google Vertex AI adapter.
 *
 * Uses Vertex AI Endpoints for Gemini, PaLM, Codey, and Imagen models.
 * Auth: Google Cloud ADC (Application Default Credentials) or API key.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS, VERTEX_PROJECT_ID, VERTEX_LOCATION,
 *   GOOGLE_API_KEY
 */
export class VertexAIAdapter extends BaseAdapter {
  readonly providerId = 'vertex_ai';
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  private projectId = '';
  private location = 'us-central1';
  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.projectId = (config as any).projectId || process.env.VERTEX_PROJECT_ID || '';
    this.location = (config as any).location || process.env.VERTEX_LOCATION || 'us-central1';
    this.apiKey = (config.apiKey as string) || process.env.GOOGLE_API_KEY || '';
  }

  protected async checkHealth(): Promise<void> {
    if (!this.projectId && !this.apiKey) {
      logger.debug('Vertex AI: no project ID or API key configured');
    }
  }

  private getEndpoint(modelId: string, action: string): string {
    const projectId = this.projectId;
    const location = this.location;

    // Support both API key and ADC auth
    if (this.apiKey) {
      return `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:${action}?key=${this.apiKey}`;
    }

    return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:${action}`;
  }

  private mapModelId(model: string): string {
    const modelMap: Record<string, string> = {
      'gemini-pro': 'gemini-2.0-flash',
      'gemini-1.5-pro': 'gemini-1.5-pro-002',
      'gemini-1.5-flash': 'gemini-1.5-flash-002',
      'gemini-2.0-flash': 'gemini-2.0-flash',
      'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
      'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
      'text-embedding': 'text-embedding-004',
      'text-embedding-004': 'text-embedding-004',
      'textembedding': 'text-embedding-004',
    };

    return modelMap[model] || model;
  }

  private convertToGeminiRequest(request: UnifiedRequest): Record<string, unknown> {
    const systemMessages = request.messages?.filter(m => m.role === 'system') || [];
    const nonSystemMessages = request.messages?.filter(m => m.role !== 'system') || [];

    const contents = nonSystemMessages.map(msg => {
      const parts: Array<{ text: string }> = [];
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          }
        }
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.stop) generationConfig.stopSequences = request.stop;

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join('\n');
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }];
    }

    return body;
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality === 'llm') {
      return this.executeChat(request, options);
    }
    if (request.modality === 'embedding') {
      return this.executeEmbedding(request, options);
    }

    throw new Error(`Unsupported modality: ${request.modality}`);
  }

  private async executeChat(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const modelId = this.mapModelId(request.model || 'gemini-2.0-flash');
    const endpoint = this.getEndpoint(modelId, 'generateContent');
    const body = this.convertToGeminiRequest(request);

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: options?.timeoutMs ?? 60000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'chat');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';
    const functionCall = candidate?.content?.parts?.find((p: any) => p.functionCall);

    return {
      modality: 'llm',
      requestId: `vertex_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      message: {
        role: 'assistant',
        content: text,
        ...(functionCall ? {
          tool_calls: [{
            id: `vertex_tc_${Date.now()}`,
            type: 'function',
            function: {
              name: functionCall.functionCall.name,
              arguments: JSON.stringify(functionCall.functionCall.args),
            },
          }],
        } : {}),
      },
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: candidate?.finishReason === 'STOP' ? 'stop'
        : candidate?.finishReason === 'MAX_TOKENS' ? 'length'
        : candidate?.finishReason || 'stop',
      latencyMs,
    };
  }

  private async executeEmbedding(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const modelId = this.mapModelId(request.model || 'text-embedding-004');
    const endpoint = this.getEndpoint(modelId, 'predict');

    const instances = Array.isArray(request.input)
      ? request.input.map(i => ({ content: i }))
      : [{ content: request.input as string }];

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances }),
        timeoutMs: options?.timeoutMs ?? 30000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'embedding');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `vertex_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      embeddings: data.predictions?.map((p: any) => p.embeddings?.values || []),
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const modelId = this.mapModelId(request.model || 'gemini-2.0-flash');
    const endpoint = this.getEndpoint(modelId, 'streamGenerateContent?alt=sse');
    const body = this.convertToGeminiRequest(request);

    let response: Response;
    try {
      response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    yield* createOpenAISSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'gemini-2.0-flash', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'gemini-2.5-pro-preview-05-06', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'gemini-2.5-flash-preview-04-17', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'gemini-1.5-pro-002', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'gemini-1.5-flash-002', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'text-embedding-004', modality: 'embedding', capabilities: ['embedding'] },
    ];
  }
}
