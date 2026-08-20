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
import { normalizeGeminiUsage } from '../cache-usage.js';
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
      // Gemini 3.x series (latest)
      'gemini-3.1-pro': 'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
      'gemini-3.1-flash': 'gemini-3.1-flash-preview',
      'gemini-3.1-flash-preview': 'gemini-3.1-flash-preview',
      'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
      'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite-preview',
      'gemini-3.0-flash': 'gemini-3.0-flash-preview',
      'gemini-3.0-flash-preview': 'gemini-3.0-flash-preview',
      // Gemini 2.5 series
      'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
      'gemini-2.5-pro-preview-05-06': 'gemini-2.5-pro-preview-05-06',
      'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
      'gemini-2.5-flash-preview-04-17': 'gemini-2.5-flash-preview-04-17',
      'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
      // Gemini 2.0 series
      'gemini-pro': 'gemini-2.0-flash',
      'gemini-2.0-flash': 'gemini-2.0-flash',
      'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
      // Gemini 1.5 series (legacy)
      'gemini-1.5-pro': 'gemini-1.5-pro-002',
      'gemini-1.5-pro-002': 'gemini-1.5-pro-002',
      'gemini-1.5-flash': 'gemini-1.5-flash-002',
      'gemini-1.5-flash-002': 'gemini-1.5-flash-002',
      // Embeddings
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
      const parts: Array<Record<string, unknown>> = [];
      // Tool messages carry the tool RESULT in content — never a text part.
      if (typeof msg.content === 'string') {
        if (msg.content && msg.role !== 'tool') parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            if (part.text) parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url.url;
            // Gemini accepts base64 data URIs as inlineData and public URLs
            // as fileData. Previously image parts were silently dropped.
            if (url.startsWith('data:')) {
              const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
              if (match) {
                parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
              }
            } else {
              parts.push({ fileData: { fileUri: url } });
            }
          } else if (part.type === 'input_audio') {
            // Gemini takes audio the same way as images: inlineData with an
            // audio mime type.
            const fmt = part.input_audio.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            parts.push({ inlineData: { mimeType: fmt, data: part.input_audio.data } });
          }
        }
      }

      // Assistant tool_calls -> functionCall parts (Gemini wire format).
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }

      // Tool results -> functionResponse parts. Gemini puts these in a
      // user-role content block (the 'function' role is a Google SDK
      // convenience, not a wire value).
      if (msg.role === 'tool' && msg.tool_call_id) {
        let response: unknown;
        try {
          response = JSON.parse(String(msg.content));
        } catch {
          response = msg.content;
        }
        parts.push({ functionResponse: { name: msg.tool_call_id, response } });
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

    // Gemini-specific knobs threaded through metadata by the Gemini
    // converter (apps/gateway/src/converters/gemini-converter.ts).
    const meta = request.metadata ?? {};
    if (meta.topK !== undefined) generationConfig.topK = meta.topK;
    if (meta.candidateCount !== undefined) generationConfig.candidateCount = meta.candidateCount;
    if (meta.thinkingConfig) generationConfig.thinkingConfig = meta.thinkingConfig;
    if (request.response_format?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

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

    if (Array.isArray(meta.safetySettings) && meta.safetySettings.length > 0) {
      body.safetySettings = meta.safetySettings;
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
        timeoutMs: options?.timeoutMs ?? 120000,
        signal: options?.signal,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'chat');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    const candidate = data.candidates?.[0];
    // Join text parts but exclude thinking parts (thought: true) so extended
    // thinking is not spliced into the user-visible answer.
    const text = candidate?.content?.parts
      ?.filter((p: any) => !p.thought && p.text)
      .map((p: any) => p.text)
      .join('') || '';
    // Gemini can emit MULTIPLE parallel function calls in one candidate —
    // previously .find() kept only the first and silently dropped the rest.
    const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];

    return {
      modality: 'llm',
      requestId: `vertex_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      message: {
        role: 'assistant',
        content: text,
        ...(functionCalls.length > 0 ? {
          tool_calls: functionCalls.map((fc: any, i: number) => ({
            id: `vertex_tc_${Date.now()}_${i}`,
            type: 'function' as const,
            function: {
              name: fc.functionCall.name,
              arguments: JSON.stringify(fc.functionCall.args),
            },
          })),
        } : {}),
      },
      // Gemini already counts cached content inside promptTokenCount and
      // reports the cached subset separately — the normalizer keeps the full
      // count and records the cache read as its own field.
      usage: normalizeGeminiUsage(data.usageMetadata),
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
      // Gemini 3.x series (latest, June 2026)
      { modelId: 'gemini-3.1-pro-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'gemini-3.1-flash-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-3.1-flash-lite-preview', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'gemini-3.0-flash-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      // Gemini 2.5 series
      { modelId: 'gemini-2.5-pro-preview-05-06', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'gemini-2.5-flash-preview-04-17', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-2.5-flash-lite', modality: 'llm', capabilities: ['chat', 'vision'] },
      // Gemini 2.0 series (deprecated June 2026, migrate to 2.5/3.x)
      { modelId: 'gemini-2.0-flash', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-2.0-flash-lite', modality: 'llm', capabilities: ['chat', 'vision'] },
      // Gemini 1.5 series (legacy)
      { modelId: 'gemini-1.5-pro-002', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-1.5-flash-002', modality: 'llm', capabilities: ['chat', 'vision'] },
      // Embeddings
      { modelId: 'text-embedding-004', modality: 'embedding', capabilities: ['embedding'] },
    ];
  }
}
