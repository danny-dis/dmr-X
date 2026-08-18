import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import type { ProviderConfig, ExecuteOptions, HealthStatus, ModelInfo } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { normalizeGeminiUsage } from '../cache-usage.js';
import { createOpenAISSEIterator } from '../stream-normalizer.js';

// --- Gemini API model id mapping (mirrors VertexAIAdapter.mapModelId) ---
const GEMINI_MODEL_MAP: Record<string, string> = {
  'gemini-3.1-pro': 'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3.1-flash': 'gemini-3.1-flash-preview',
  'gemini-3.1-flash-preview': 'gemini-3.1-flash-preview',
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite-preview',
  'gemini-3.0-flash': 'gemini-3.0-flash-preview',
  'gemini-3.0-flash-preview': 'gemini-3.0-flash-preview',
  'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-pro-preview-05-06': 'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-flash-preview-04-17': 'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
  'gemini-1.5-pro': 'gemini-1.5-pro-002',
  'gemini-1.5-pro-002': 'gemini-1.5-pro-002',
  'gemini-1.5-flash': 'gemini-1.5-flash-002',
  'gemini-1.5-flash-002': 'gemini-1.5-flash-002',
  'text-embedding': 'text-embedding-004',
  'text-embedding-004': 'text-embedding-004',
  'textembedding': 'text-embedding-004',
};

/** Gemini API adapter — hits the native `generativelanguage.googleapis.com`
 *  endpoint (`/v1beta/models/<model>:generateContent` / `:streamGenerateContent`)
 *  instead of the OpenAI-compatible mount. Primary for Gemini streaming;
 *  the existing `google` GenericOpenAIAdapter (OpenAI-compatible) remains
 *  registered as a secondary fallback for non-streaming and OpenAI-format clients.
 */
export class GeminiAPIAdapter extends BaseAdapter {
  readonly providerId = 'google_native';
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || process.env.GOOGLE_API_KEY || '';
  }

  protected async checkHealth(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('No GOOGLE_API_KEY configured');
    }
  }

  // --- Non-streaming: native generateContent ---
  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();
    if (request.modality === 'llm') return this.executeChat(request, options);
    if (request.modality === 'embedding') return this.executeEmbedding(request, options);
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
    const text = candidate?.content?.parts
      ?.filter((p: any) => !p.thought && p.text)
      .map((p: any) => p.text)
      .join('') || '';
    const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];

    return {
      modality: 'llm',
      requestId: `gemini_api_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      message: {
        role: 'assistant',
        content: text,
        ...(functionCalls.length > 0 ? {
          tool_calls: functionCalls.map((fc: any, i: number) => ({
            id: `gemini_tc_${Date.now()}_${i}`,
            type: 'function' as const,
            function: {
              name: fc.functionCall.name,
              arguments: JSON.stringify(fc.functionCall.args),
            },
          })),
        } : {}),
      },
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
      requestId: `gemini_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'unknown',
      embeddings: data.predictions?.map((p: any) => p.embeddings?.values || []),
      latencyMs,
    };
  }

  // --- Streaming: native streamGenerateContent?alt=sse ---
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
        signal: options?.signal,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    yield* createOpenAISSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'gemini-3.1-pro-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'gemini-3.1-flash-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-3.1-flash-lite-preview', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'gemini-3.0-flash-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-2.5-pro-preview-05-06', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'gemini-2.5-flash-preview-04-17', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-2.5-flash-lite', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'gemini-2.0-flash', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-2.0-flash-lite', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'gemini-1.5-pro-002', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'gemini-1.5-flash-002', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'text-embedding-004', modality: 'embedding', capabilities: ['embedding'] },
    ];
  }

  // --- Helpers (mirrors VertexAIAdapter) ---

  private getEndpoint(modelId: string, action: string): string {
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    return `${base}/models/${modelId}:${action}?key=${this.apiKey}`;
  }

  private mapModelId(model: string): string {
    return GEMINI_MODEL_MAP[model] || model;
  }

  private convertToGeminiRequest(request: UnifiedRequest): Record<string, unknown> {
    const systemMessages = request.messages?.filter(m => m.role === 'system') || [];
    const nonSystemMessages = request.messages?.filter(m => m.role !== 'system') || [];

    const contents = nonSystemMessages.map(msg => {
      const parts: Array<Record<string, unknown>> = [];
      if (typeof msg.content === 'string') {
        if (msg.content) parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            if (part.text) parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
              if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            } else {
              parts.push({ fileData: { fileUri: url } });
            }
          } else if (part.type === 'input_audio') {
            const fmt = part.input_audio.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            parts.push({ inlineData: { mimeType: fmt, data: part.input_audio.data } });
          }
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }

      if (msg.role === 'tool' && msg.tool_call_id) {
        let response: unknown;
        try { response = JSON.parse(String(msg.content)); } catch { response = msg.content; }
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

    const meta = request.metadata ?? {};
    if (meta.topK !== undefined) generationConfig.topK = meta.topK;
    if (meta.candidateCount !== undefined) generationConfig.candidateCount = meta.candidateCount;
    if (meta.thinkingConfig) generationConfig.thinkingConfig = meta.thinkingConfig;
    if (request.response_format?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    const body: Record<string, unknown> = { contents, generationConfig };

    if (systemMessages.length > 0) {
      const systemText = systemMessages.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
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
}
