import { ProviderError } from '@dmr-x/core';
import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
  TokenStreamChunk,
  DoneStreamChunk,
  TokenUsage,
} from '@dmr-x/core';
import { logger, parseOpenAISSE } from '@dmr-x/utils';
import type { ProviderConfig, ExecuteOptions, HealthStatus, ModelInfo } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { normalizeGeminiUsage } from '../cache-usage.js';

// --- Gemini API model id mapping (mirrors VertexAIAdapter.mapModelId) ---
const GEMINI_MODEL_MAP: Record<string, string> = {
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.6-flash-preview': 'gemini-3.6-flash',
  'gemini-3.5-flash': 'gemini-3.5-flash',
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
  'gemini-1.5-pro': 'gemini-1.5-pro-002',
  'gemini-1.5-pro-002': 'gemini-1.5-pro-002',
  'gemini-1.5-flash': 'gemini-1.5-flash-002',
  'gemini-1.5-flash-002': 'gemini-1.5-flash-002',
  'text-embedding': 'text-embedding-004',
  'text-embedding-004': 'text-embedding-004',
  'textembedding': 'text-embedding-004',
};

// --- Tool schema field selection -------------------------------------------
//
// `FunctionDeclaration` exposes `parameters` and `parametersJsonSchema` as a
// proto **oneof** — exactly one may be sent.
//
// * `parameters` is a subset of OpenAPI 3.0 mapped onto the
//   `google.ai.generativelanguage_v1beta.Schema` message. Its proto JSON fields
//   are exactly GOOGLE_SCHEMA_PROTO_KEYS below. Google's REST parser rejects
//   unknown names ("Invalid JSON payload received. Unknown field ..."), which is
//   why an OpenCode/zod tool schema carrying `$schema`, `$defs`, `$ref`,
//   `allOf` or `additionalProperties` gets HTTP 400 "Bad Request" on
//   tool-bearing requests while a plain request succeeds. (`default` is a proto
//   field precisely "so that developers who send schemas with a `default` field
//   don't get unknown-field errors" — the same failure mode.)
// * `parametersJsonSchema` takes an arbitrary JSON Schema `google.protobuf.Value`
//   and preserves the caller's schema byte-for-byte, but requires Gemini 2.5+ and
//   has an undocumented nesting-depth limit (~32), so it is only used when the
//   schema actually needs it, and only on models that support it.
const GOOGLE_SCHEMA_PROTO_KEYS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'items',
  'maxItems', 'minItems', 'properties', 'required', 'minProperties',
  'maxProperties', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern',
  'example', 'anyOf', 'propertyOrdering', 'default',
]);

/** Schema-valued maps: keys are names (property/definition), not keywords. */
const SCHEMA_MAP_KEYS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);

/** True when `schema` uses keywords the `parameters` (Schema proto) field rejects. */
function needsJsonSchemaField(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(needsJsonSchemaField);
  if (!schema || typeof schema !== 'object') return false;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GOOGLE_SCHEMA_PROTO_KEYS.has(key)) return true;
    if (SCHEMA_MAP_KEYS.has(key)) {
      // `$defs`/`definitions`/`patternProperties` already returned true above
      // (they are not proto fields); this branch therefore only ever runs for
      // `properties`, whose values are schemas keyed by *property name*.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.values(value).some(needsJsonSchemaField)) return true;
      }
      continue;
    }
    if (needsJsonSchemaField(value)) return true;
  }
  return false;
}

/**
 * Recursively drop every key that is not a `google...Schema` proto field.
 * Only used for pre-2.5 models, which accept `parameters` but not
 * `parametersJsonSchema` — there the alternative to a lossy subset is a 400.
 * Structure (`properties`/`items`/`anyOf`) and constraints that *are* proto
 * fields survive untouched; `$ref`/`$defs` cannot be inlined here, so callers
 * on those legacy models lose only the reference indirection, never the tool.
 */
function toGoogleParametersSubset(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGoogleParametersSubset);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GOOGLE_SCHEMA_PROTO_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, toGoogleParametersSubset(sub)]),
      );
      continue;
    }
    out[key] = toGoogleParametersSubset(value);
  }
  return out;
}

/** `parametersJsonSchema` shipped with Gemini 2.5; older models reject the field. */
function supportsParametersJsonSchema(modelId: string): boolean {
  const match = /gemini-(\d+)\.(\d+)/.exec(modelId);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 5);
}

/**
 * OpenAI `tool_choice` → `ToolConfig.functionCallingConfig`.
 * Without this, `required` / a named function silently degrades to Gemini's
 * default AUTO: the model may answer in text when the caller demanded a call.
 * `allowedFunctionNames` is only legal alongside mode ANY (or VALIDATED).
 */
function buildToolConfig(
  toolChoice: UnifiedRequest['tool_choice'],
): Record<string, unknown> | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
  if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  if (
    typeof toolChoice === 'object'
    && toolChoice.type === 'function'
    && toolChoice.function?.name
  ) {
    return {
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.function.name] },
    };
  }
  return undefined;
}

/** Does the caller demand an actual tool call (vs. letting the model choose)? */
function isForcedToolCall(toolChoice: UnifiedRequest['tool_choice']): boolean {
  if (toolChoice === 'required') return true;
  return typeof toolChoice === 'object'
    && toolChoice !== null
    && toolChoice.type === 'function';
}

/**
 * Redact credentials from text that originated upstream, before it becomes an
 * error message / log line. Google's own 400 bodies sometimes quote the request
 * URL back — and this adapter puts the API key in that URL's `key=` query
 * param — so query credentials and bare `AIza…` keys are stripped while the
 * meaningful part of the upstream detail (the actual validation failure) is
 * kept verbatim.
 */
function sanitizeUpstreamMessage(message: string): string {
  if (typeof message !== 'string' || !message) return message;
  return message
    .replace(
      /([?&](?:key|api[_-]?key|apikey|token|access_token|auth)=)[^&\s"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED]');
}

/** Gemini candidate finishReason → unified finish reason. */
function mapGeminiFinishReason(reason: string | undefined): UnifiedResponse['finishReason'] {
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  // Any other Gemini reason (SAFETY, RECITATION, OTHER, …) passes through
  // unchanged — same as this adapter has always forwarded it.
  return (reason || 'stop') as UnifiedResponse['finishReason'];
}

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
      throw this.adaptError(error, 'chat');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.filter((p: any) => !p.thought && p.text)
      .map((p: any) => p.text)
      .join('') || '';
    // A functionCall without a name cannot be turned into an OpenAI tool_call;
    // carrying it through would emit `function.name: undefined` and hang
    // tool-calling clients. (Part-level `functionCall` filter also matches the
    // empty-content guard below, which needs to see real calls only.)
    const functionCalls = (candidate?.content?.parts || []).filter(
      (p: any) => p.functionCall && typeof p.functionCall.name === 'string' && p.functionCall.name,
    );
    if (!text.trim() && functionCalls.length === 0) {
      throw new ProviderError(
        'Gemini chat: upstream returned HTTP 200 with empty content and no tool calls',
        this.providerId,
        502,
      );
    }
    if (request.response_format?.type === 'json_object' && functionCalls.length === 0) {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ProviderError('Gemini chat: upstream returned invalid JSON object', this.providerId, 502);
      }
    }
    // A FORCED tool call (`required`, or one named function) that came back as
    // plain text is a failed tool turn. Returning it as a normal completion
    // would silently downgrade the caller's contract to "text success", so it
    // is surfaced as a 502 and the router falls back / retries instead.
    if (
      functionCalls.length === 0
      && request.tools && request.tools.length > 0
      && isForcedToolCall(request.tool_choice)
    ) {
      throw new ProviderError(
        `Gemini chat: forced tool call produced no tool_calls (finishReason=${candidate?.finishReason ?? 'unknown'})`,
        this.providerId,
        502,
      );
    }

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
              // `arguments` must always be a JSON string; an absent `args`
              // object would otherwise serialize as `undefined`.
              arguments: JSON.stringify(fc.functionCall.args ?? {}),
            },
          })),
        } : {}),
      },
      usage: normalizeGeminiUsage(data.usageMetadata),
      finishReason: mapGeminiFinishReason(candidate?.finishReason),
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
      });
    } catch (error) {
      throw this.adaptError(error, 'stream');
    }

    yield* this.streamNativeGemini(response, request, options);
  }

  /**
   * Normalize the NATIVE `:streamGenerateContent?alt=sse` payload into
   * StreamChunks.
   *
   * Gemini frames are `{candidates:[{content:{parts:[…]}}]}` — there is no
   * `choices[0].delta` and no `[DONE]` marker, so handing this response to
   * `createOpenAISSEIterator` yields one `undefined` per frame: no text, no
   * tool calls, no usage and no terminal `done` ever reach the router (which
   * then reports "Upstream stream completed with zero content tokens" and
   * falls away from a perfectly healthy provider).
   */
  private async *streamNativeGemini(
    response: Response,
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): AsyncIterable<StreamChunk> {
    const body = response.body;
    if (!body) throw new Error('Response body is null');

    const eventStream = parseOpenAISSE(body);
    if (options?.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        void eventStream.cancel(signal.reason).catch(() => {});
      } else {
        const onAbort = () => { void eventStream.cancel(signal.reason).catch(() => {}); };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const requestId = `gemini_api_${Date.now()}`;
    const modelId = request.model || 'unknown';
    let index = 0;
    let toolIndex = 0;
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;
    let emittedDone = false;

    const doneChunk = (): DoneStreamChunk => ({
      type: 'done',
      index: index++,
      data: {
        requestId,
        modelId,
        ...(finishReason ? { finishReason } : {}),
        ...(usage ? { usage } : {}),
      },
    });

    for await (const data of eventStream) {
      if (!data || data === '[DONE]') continue;

      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        // The parse failure echoes the offending frame — redact it like any
        // other upstream text before it lands in a log line.
        logger.warn(
          { err: sanitizeUpstreamMessage(String(err)) },
          'Gemini SSE: malformed JSON chunk, skipping',
        );
        continue;
      }

      if (parsed.error) {
        // Keep Google's detail (it names the offending field) but never any
        // credential that may be quoted alongside it. Flagged as a chunk error
        // so a trailing error frame can fall back instead of hard-failing.
        const detail = typeof parsed.error === 'string'
          ? parsed.error
          : parsed.error.message || JSON.stringify(parsed.error);
        const err = new Error(`Gemini SSE error: ${sanitizeUpstreamMessage(detail)}`) as Error & {
          code?: string;
          __streamChunkError?: boolean;
        };
        err.code = 'upstream_sse_error';
        err.__streamChunkError = true;
        throw err;
      }

      if (parsed.promptFeedback?.blockReason) {
        throw new Error(`Stream blocked by content safety filters: ${parsed.promptFeedback.blockReason}`);
      }

      if (parsed.usageMetadata) usage = normalizeGeminiUsage(parsed.usageMetadata);

      const candidate = parsed.candidates?.[0];
      if (candidate) {
        let content = '';
        const toolCalls: NonNullable<TokenStreamChunk['data']['tool_calls']> = [];
        for (const part of candidate.content?.parts || []) {
          // Extended thinking rides in-band; it is not user-visible content
          // (mirrors the non-streaming path).
          if (part.thought) continue;
          if (typeof part.text === 'string' && part.text.length > 0) {
            content += part.text;
          } else if (part.functionCall?.name) {
            let args: unknown = part.functionCall.args;
            if (args === null || typeof args !== 'object' || Array.isArray(args)) args = {};
            toolCalls.push({
              index: toolIndex++,
              id: `gemini_tc_${toolIndex}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(args),
              },
            });
          }
          // A functionCall with no name is not expressible as an OpenAI
          // tool_call either — dropping it beats emitting `name: undefined`.
        }

        if (content || toolCalls.length > 0) {
          const chunk: TokenStreamChunk = {
            type: 'token',
            index: index++,
            data: {
              ...(content ? { content } : {}),
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
          };
          yield chunk;
        }

        if (candidate.finishReason) {
          finishReason = mapGeminiFinishReason(candidate.finishReason) ?? undefined;
        }
      }

      if (finishReason && !emittedDone) {
        emittedDone = true;
        yield doneChunk();
        break;
      }
    }

    // Gemini terminates by closing the SSE connection rather than sending a
    // sentinel, so a stream that never carried a finishReason still has to
    // end with a `done` frame or the route waits on a terminal frame forever.
    if (!emittedDone) yield doneChunk();
  }

  /**
   * Map a caught transport/upstream failure onto a ProviderError and redact
   * any credential Google echoed back in the message.
   */
  private adaptError(error: unknown, context: string): unknown {
    let mapped: unknown;
    try {
      mapped = this.handleAdapterError(error, context);
    } catch (caught) {
      mapped = caught;
    }
    if (mapped instanceof Error) {
      const sanitized = sanitizeUpstreamMessage(mapped.message);
      if (sanitized !== mapped.message) mapped.message = sanitized;
    }
    return mapped;
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

  /**
   * Map one OpenAI-style tool onto `FunctionDeclaration`, choosing the side of
   * the `parameters` / `parametersJsonSchema` oneof the schema can travel on
   * without Google rejecting the payload. Nothing is stripped on models that
   * support JSON Schema: the caller's schema is forwarded verbatim.
   */
  private buildFunctionDeclaration(
    tool: NonNullable<UnifiedRequest['tools']>[number],
    modelId: string,
  ): Record<string, unknown> {
    const declaration: Record<string, unknown> = {
      name: tool.function.name,
      description: tool.function.description,
    };
    const schema = tool.function.parameters;
    if (schema && typeof schema === 'object') {
      if (needsJsonSchemaField(schema)) {
        if (supportsParametersJsonSchema(modelId)) {
          declaration.parametersJsonSchema = schema;
        } else {
          // Pre-2.5 models have no `parametersJsonSchema` field; an unknown
          // field would 400 on its own, so fall back to the proto-supported
          // subset instead of dropping the declaration.
          declaration.parameters = toGoogleParametersSubset(schema);
        }
      } else {
        declaration.parameters = schema;
      }
    }
    return declaration;
  }

  private convertToGeminiRequest(request: UnifiedRequest): Record<string, unknown> {
    const systemMessages = request.messages?.filter(m => m.role === 'system') || [];
    const nonSystemMessages = request.messages?.filter(m => m.role !== 'system') || [];

    // OpenAI call ids are opaque (`call_…`); Gemini addresses a
    // functionResponse by the *declared* function name, so the id → name
    // mapping is recovered from the assistant turns of this same history.
    const toolNameById = new Map<string, string>();
    for (const msg of nonSystemMessages) {
      for (const tc of msg.tool_calls || []) {
        if (tc.id && tc.function?.name) toolNameById.set(tc.id, tc.function.name);
      }
    }

    const contents = nonSystemMessages.map(msg => {
      const parts: Array<Record<string, unknown>> = [];
      const isToolResult = msg.role === 'tool';

      if (isToolResult) {
        // A tool turn is replayed as exactly one functionResponse part — never
        // also as a text part, which would send the tool result twice.
        const text = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter(p => p.type === 'text').map(p => p.text).join('')
            : String(msg.content ?? '');
        const name = (msg.tool_call_id && toolNameById.get(msg.tool_call_id)) || msg.tool_call_id;

        if (name) {
          let response: unknown;
          try { response = JSON.parse(text); } catch { response = text; }
          // `functionResponse.response` is a google.protobuf.Struct, i.e. a JSON
          // *object*; Google documents `output` as the function-output key, so
          // scalars/arrays are wrapped instead of being sent (400) or dropped.
          if (response === null || typeof response !== 'object' || Array.isArray(response)) {
            response = { output: response };
          }
          parts.push({ functionResponse: { name, response } });
        } else if (text) {
          // No call id at all: the result cannot be addressed to a function,
          // but it still belongs in the turn — as user text, once.
          parts.push({ text });
        }
      } else if (typeof msg.content === 'string') {
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
          // A functionCall without a name is not expressible on the Gemini wire
          // (and would 400); drop that call rather than the whole turn.
          if (!tc.function?.name) continue;
          let args: unknown;
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          // `functionCall.args` is also a Struct: only an object can be sent.
          if (args === null || typeof args !== 'object' || Array.isArray(args)) args = {};
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    })
      // A turn can end up with no parts (blank user turn, tool result with no
      // call id and no content, assistant turn whose only tool_call had no
      // name). Google rejects an empty `contents[].parts` with a 400, so those
      // turns are omitted instead of invalidating the whole request.
      .filter(content => content.parts.length > 0);

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
      const modelId = this.mapModelId(request.model || 'gemini-2.0-flash');
      body.tools = [{
        functionDeclarations: request.tools.map(tool =>
          this.buildFunctionDeclaration(tool, modelId),
        ),
      }];
      // Only legal alongside `tools`: Google rejects a tool_config that
      // references no function declarations.
      const toolConfig = buildToolConfig(request.tool_choice);
      if (toolConfig) body.toolConfig = toolConfig;
    }

    if (Array.isArray(meta.safetySettings) && meta.safetySettings.length > 0) {
      body.safetySettings = meta.safetySettings;
    }

    return body;
  }
}
