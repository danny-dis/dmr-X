import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

// ---------------------------------------------------------------------------
// Cloud Code types (subset needed for outbound requests)
// ---------------------------------------------------------------------------

interface CloudCodeContent {
  role: 'user' | 'model';
  parts: Array<
    | { text: string; thought?: boolean }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
    | { inlineData: { mimeType: string; data: string } }
  >;
}

interface CloudCodeEnvelope {
  project: string;
  model: string;
  request: {
    contents: CloudCodeContent[];
    systemInstruction?: CloudCodeContent;
    tools?: Array<{ functionDeclarations: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }> }>;
    generationConfig?: {
      temperature?: number;
      topP?: number;
      maxOutputTokens?: number;
      stopSequences?: string[];
      thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number };
    };
  };
  requestType: string;
  userAgent: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Antigravity Adapter
//
// This adapter handles outbound requests to Google's Cloud Code API.
// It converts DMR-X UnifiedRequest format to Cloud Code envelope format.
// ---------------------------------------------------------------------------

export class AntigravityAdapter extends BaseAdapter {
  readonly providerId = 'antigravity';
  readonly supportedModalities: Modality[] = ['llm'];

  private apiKey = '';
  private projectId = 'dmrx-gateway';

  private getBaseUrl(): string {
    return (this.config.baseUrl || 'https://cloudcode-pa.googleapis.com').replace(/\/+$/, '');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.accessToken as string) || (config.apiKey as string) || '';
    this.projectId = (config.projectId as string) || 'dmrx-gateway';

    // Antigravity adapter requires at least an OAuth token or API key
    if (!this.apiKey) {
      throw new Error('Antigravity adapter requires an API key or OAuth token');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Lightweight health check — just verify the endpoint is reachable
    await this.fetchWithTimeout(`${this.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
      timeoutMs: 5000,
    });
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();
    const start = Date.now();

    if (request.modality !== 'llm') {
      throw new Error(`Unsupported modality: ${request.modality}`);
    }

    try {
      const envelope = this.buildEnvelope(request);
      const isStreaming = request.stream !== false;

      if (isStreaming) {
        // For streaming, we use the SSE endpoint
        const response = await this.fetchWithTimeout(
          `${this.getBaseUrl()}/v1internal:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              Accept: 'text/event-stream',
            },
            body: JSON.stringify(envelope),
            signal: options?.signal,
            timeoutMs: options?.timeoutMs ?? 120000,
          },
        );

        // Parse SSE response
        const text = await response.text();
        const lines = text.split('\n').filter((l) => l.startsWith('data: '));
        const lastEvent = lines[lines.length - 1]?.slice(6);

        if (!lastEvent) {
          throw new Error('Empty response from Cloud Code');
        }

        const parsed = JSON.parse(lastEvent);
        const candidate = parsed.response?.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        // Extract text and tool calls from parts
        const textContent = parts
          .filter((p: any) => 'text' in p && !p.thought)
          .map((p: any) => p.text)
          .join('');

        const toolCalls = parts
          .filter((p: any) => 'functionCall' in p)
          .map((p: any) => ({
            id: p.functionCall.id ?? p.functionCall.name,
            type: 'function' as const,
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args),
            },
          }));

        return {
          modality: 'llm',
          requestId: envelope.requestId,
          providerId: this.providerId,
          modelId: request.model || 'unknown',
          message: {
            role: 'assistant',
            content: textContent || undefined,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          usage: parsed.response?.usageMetadata
            ? {
                prompt_tokens: parsed.response.usageMetadata.promptTokenCount ?? 0,
                completion_tokens: parsed.response.usageMetadata.candidatesTokenCount ?? 0,
                total_tokens: parsed.response.usageMetadata.totalTokenCount ?? 0,
              }
            : undefined,
          finishReason: this.mapFinishReason(candidate?.finishReason),
          latencyMs: Date.now() - start,
        };
      } else {
        // Non-streaming
        const response = await this.fetchWithTimeout(
          `${this.getBaseUrl()}/v1internal:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(envelope),
            timeoutMs: options?.timeoutMs ?? 60000,
          },
        );

        const parsed = await response.json() as Record<string, any>;
        const candidate = parsed.response?.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        const textContent = parts
          .filter((p: any) => 'text' in p && !p.thought)
          .map((p: any) => p.text)
          .join('');

        const toolCalls = parts
          .filter((p: any) => 'functionCall' in p)
          .map((p: any) => ({
            id: p.functionCall.id ?? p.functionCall.name,
            type: 'function' as const,
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args),
            },
          }));

        return {
          modality: 'llm',
          requestId: envelope.requestId,
          providerId: this.providerId,
          modelId: request.model || 'unknown',
          message: {
            role: 'assistant',
            content: textContent || undefined,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          usage: parsed.response?.usageMetadata
            ? {
                prompt_tokens: parsed.response.usageMetadata.promptTokenCount ?? 0,
                completion_tokens: parsed.response.usageMetadata.candidatesTokenCount ?? 0,
                total_tokens: parsed.response.usageMetadata.totalTokenCount ?? 0,
              }
            : undefined,
          finishReason: this.mapFinishReason(candidate?.finishReason),
          latencyMs: Date.now() - start,
        };
      }
    } catch (err) {
      throw this.handleAdapterError(err, 'execute');
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    if (request.modality !== 'llm') {
      throw new Error(`Unsupported modality: ${request.modality}`);
    }

    const envelope = this.buildEnvelope(request);
    let response: Response;

    try {
      response = await this.fetchWithTimeout(
        `${this.getBaseUrl()}/v1internal:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(envelope),
          signal: options?.signal,
          timeoutMs: options?.timeoutMs ?? 120000,
        },
      );
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    const body = response.body;
    if (!body) {
      throw new Error('Response body is null');
    }

    // Parse SSE stream
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let index = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            const candidate = parsed.response?.candidates?.[0];
            const parts = candidate?.content?.parts ?? [];

            // Emit text tokens
            for (const part of parts) {
              if ('text' in part && !part.thought) {
                yield {
                  type: 'token',
                  data: { content: part.text },
                  index: index++,
                } as StreamChunk;
              }
            }

            // Emit tool calls
            for (const part of parts) {
              if ('functionCall' in part) {
                yield {
                  type: 'token',
                  data: {
                    tool_calls: [{
                      id: part.functionCall.id ?? part.functionCall.name,
                      type: 'function',
                      function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                      },
                    }],
                  },
                  index: index++,
                } as StreamChunk;
              }
            }

            // Emit done if finishReason present
            if (candidate?.finishReason) {
              yield {
                type: 'done',
                data: {
                  prompt_tokens: parsed.response?.usageMetadata?.promptTokenCount ?? 0,
                  completion_tokens: parsed.response?.usageMetadata?.candidatesTokenCount ?? 0,
                  total_tokens: parsed.response?.usageMetadata?.totalTokenCount ?? 0,
                },
                index: index++,
              } as StreamChunk;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'gemini-2.5-pro', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'gemini-2.5-flash', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'gemini-3-flash', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'gemini-3-pro-high', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'claude-opus-4-6-thinking', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'claude-sonnet-4-5', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'gpt-oss-120b-medium', modality: 'llm', capabilities: ['chat', 'tools'] },
    ];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEnvelope(request: UnifiedRequest): CloudCodeEnvelope {
    // Convert messages to Cloud Code contents
    const contents: CloudCodeContent[] = [];

    for (const msg of request.messages ?? []) {
      if (msg.role === 'system') continue; // System goes to systemInstruction

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: CloudCodeContent['parts'] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            // Extract mime type and base64 data from data URL
            const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          }
        }
      }

      // Add tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }

      // Add tool results
      if (msg.role === 'tool' && msg.tool_call_id) {
        parts.push({
          functionResponse: {
            name: msg.tool_call_id,
            response: typeof msg.content === 'string'
              ? { result: msg.content }
              : { result: JSON.stringify(msg.content) },
          },
        });
      }

      if (parts.length > 0) {
        contents.push({ role: role as 'user' | 'model', parts });
      }
    }

    // Build system instruction
    const systemMessages = (request.messages ?? []).filter((m) => m.role === 'system');
    let systemInstruction: CloudCodeContent | undefined;
    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      systemInstruction = { role: 'user', parts: [{ text: systemText }] };
    }

    // Build tools
    const tools = request.tools?.map((t) => ({
      functionDeclarations: [{
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }],
    }));

    return {
      project: this.projectId,
      model: request.model || 'gemini-2.5-flash',
      request: {
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(tools ? { tools } : {}),
        generationConfig: {
          temperature: request.temperature,
          topP: request.top_p,
          maxOutputTokens: request.max_tokens,
          stopSequences: request.stop,
        },
      },
      requestType: 'agent',
      userAgent: 'dmr-x-gateway',
      requestId: `dmr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  private mapFinishReason(reason: string | undefined): UnifiedResponse['finishReason'] {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default: return 'stop';
    }
  }
}
