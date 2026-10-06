import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';
import type { UnifiedRequest } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError } from '@dmr-x/utils';
import { describe, expect, it, vi } from 'vitest';

/**
 * OpenCode-compatible agents ship tool schemas produced by
 * `z.toJSONSchema()`-style converters. Those are real JSON Schema documents:
 * they carry `$schema`, `$defs`, `$ref`, `allOf` and `additionalProperties`.
 *
 * Google's native `functionDeclarations.parameters` field is a subset of
 * OpenAPI 3.0 mapped onto the `google.ai.generativelanguage_v1beta.Schema`
 * proto, whose fields are exactly: type, format, title, description, nullable,
 * enum, items, maxItems, minItems, properties, required, minProperties,
 * maxProperties, minimum, maximum, minLength, maxLength, pattern, example,
 * anyOf, propertyOrdering, default. Anything else (`$schema`, `$defs`, `$ref`,
 * `allOf`, `additionalProperties`, …) is an unknown proto JSON field and is
 * rejected with HTTP 400 — the "Upstream error from Google: Bad Request"
 * reported on tool-bearing requests while plain (tool-less) requests succeed.
 *
 * `functionDeclarations.parametersJsonSchema` (a proto oneof partner of
 * `parameters`, Gemini 2.5+) takes an arbitrary JSON Schema
 * `google.protobuf.Value`, so the schema can be forwarded unmodified.
 */
const GOOGLE_SCHEMA_PROTO_KEYS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'items',
  'maxItems', 'minItems', 'properties', 'required', 'minProperties',
  'maxProperties', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern',
  'example', 'anyOf', 'propertyOrdering', 'default',
]);

/** Keys whose values are maps of *named* schemas — names are not keywords. */
const SCHEMA_MAP_KEYS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);

/** Keys in `node` that the Google Schema proto would reject. */
function unsupportedSchemaKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) unsupportedSchemaKeys(item, found);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!GOOGLE_SCHEMA_PROTO_KEYS.has(key) && !found.includes(key)) found.push(key);
      if (SCHEMA_MAP_KEYS.has(key)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const subSchema of Object.values(value)) unsupportedSchemaKeys(subSchema, found);
        }
        continue;
      }
      unsupportedSchemaKeys(value, found);
    }
  }
  return found;
}

/** Representative OpenCode `bash` tool declaration (zod/JSON-Schema output). */
const OPENCODE_BASH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description: 'Execute a bash command and return stdout/stderr.',
    parameters: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: {
        exitCode: { type: 'integer', minimum: 0, maximum: 255 },
      },
      properties: {
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'The argv to execute.',
        },
        workdir: {
          type: 'string',
          description: 'Directory to run in.',
          nullable: true,
        },
        timeout_ms: { $ref: '#/$defs/exitCode' },
        policy: {
          allOf: [{ type: 'object' }],
          additionalProperties: false,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
};

async function captureNativePayload(
  request: UnifiedRequest,
  /** Parts of the mocked assistant turn; defaults to plain text. */
  replyParts?: Record<string, any>[],
) {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-key' });
  const parts = replyParts
    ?? [{
      text: request.response_format?.type === 'json_object' ? '{"ok":true}' : 'ok',
    }];
  const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts }, finishReason: 'STOP' }],
      }),
      { status: 200 },
    ),
  );
  await adapter.execute(request);
  const [, init] = fetchSpy.mock.calls[0];
  return JSON.parse(init.body as string) as Record<string, any>;
}

const baseRequest: UnifiedRequest = {
  modality: 'llm',
  model: 'gemini-3.1-flash-lite-preview',
  messages: [{ role: 'user', content: 'run ls' }],
  tools: [OPENCODE_BASH_TOOL],
  stream: false,
  metadata: {},
};

describe('Gemini native adapter — OpenCode tool schema contract', () => {
  it('never forwards JSON-Schema-only keywords through the OpenAPI-subset parameters field', async () => {
    const body = await captureNativePayload(baseRequest);
    const decl = body.tools[0].functionDeclarations[0];

    // `parameters` and `parametersJsonSchema` are a proto oneof: exactly one.
    const declared = ['parameters', 'parametersJsonSchema'].filter(k => k in decl);
    expect(declared).toHaveLength(1);

    if ('parameters' in decl) {
      expect(unsupportedSchemaKeys(decl.parameters)).toEqual([]);
    }

    // ...and no tool semantics may be silently dropped to make the request pass.
    const schema = decl.parameters ?? decl.parametersJsonSchema;
    expect(schema).toEqual(OPENCODE_BASH_TOOL.function.parameters);
    expect(decl.name).toBe('bash');
    expect(decl.description).toBe(OPENCODE_BASH_TOOL.function.description);
  });
});

describe('Gemini native adapter — tool history round-trip', () => {
  it('replays a tool call and its result exactly once, under the declared function name', async () => {
    const body = await captureNativePayload({
      ...baseRequest,
      tools: undefined,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'list files' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_6260fbb411664d8dbc292280',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":["ls"]}' },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_6260fbb411664d8dbc292280',
          content: 'file1.ts\nfile2.ts',
        },
      ],
    });

    expect(body.tools).toBeUndefined();
    expect(body.systemInstruction.parts).toEqual([{ text: 'You are terse.' }]);

    const [userTurn, modelTurn, toolTurn] = body.contents;
    expect(userTurn.role).toBe('user');

    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts).toEqual([
      { functionCall: { name: 'bash', args: { command: ['ls'] } } },
    ]);

    // Gemini puts tool results in a user-role content block, exactly once.
    expect(toolTurn.role).toBe('user');
    expect(toolTurn.parts).toHaveLength(1);
    const [functionResponse] = toolTurn.parts;
    // The name must be the FunctionDeclaration name, not the OpenAI call id.
    expect(functionResponse.functionResponse.name).toBe('bash');
    // `functionResponse.response` is a google.protobuf.Struct: a plain object.
    // A scalar/UTF-8 tool result must be wrapped (Google documents `output`).
    expect(functionResponse.functionResponse.response).toEqual({
      output: 'file1.ts\nfile2.ts',
    });
  });
});

const CLEAN_LOOKUP_TOOL = {
  type: 'function' as const,
  function: {
    name: 'lookup',
    description: 'Look up a record.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Record id.' } },
      required: ['id'],
    },
  },
};

describe('Gemini native adapter — tool_choice and response format', () => {
  it('maps OpenAI tool_choice onto toolConfig.functionCallingConfig', async () => {
    // A FORCED mode is answered with an actual tool call here: replying with
    // plain text is a contract failure the adapter must now reject (covered
    // separately below), so this payload-shape test mimics a compliant turn.
    const callReply = [{ functionCall: { name: 'bash', args: { command: ['ls'] } } }];
    const required = await captureNativePayload(
      { ...baseRequest, tool_choice: 'required' },
      callReply,
    );
    expect(required.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });

    const named = await captureNativePayload(
      { ...baseRequest, tool_choice: { type: 'function', function: { name: 'bash' } } },
      callReply,
    );
    expect(named.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['bash'] },
    });

    const none = await captureNativePayload({ ...baseRequest, tool_choice: 'none' });
    expect(none.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });

    const auto = await captureNativePayload({ ...baseRequest, tool_choice: 'auto' });
    expect(auto.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });

    // Unset stays unset: no behaviour change for requests that never set it.
    const plain = await captureNativePayload(baseRequest);
    expect(plain.toolConfig).toBeUndefined();
  });

  it('keeps JSON response mode next to tools and a clean schema on `parameters`', async () => {
    const body = await captureNativePayload({
      ...baseRequest,
      response_format: { type: 'json_object' },
      tools: [CLEAN_LOOKUP_TOOL],
    });

    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const decl = body.tools[0].functionDeclarations[0];
    expect('parametersJsonSchema' in decl).toBe(false);
    expect(decl.parameters).toEqual(CLEAN_LOOKUP_TOOL.function.parameters);
  });

  it('does not emit toolConfig for a tool_choice when no tools were sent', async () => {
    const body = await captureNativePayload({
      ...baseRequest,
      tools: undefined,
      tool_choice: 'required',
    });
    expect(body.toolConfig).toBeUndefined();
  });
});

const FAKE_GOOGLE_KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE012';

async function executeWithReply(
  request: UnifiedRequest,
  replyParts: Record<string, any>[],
) {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-key' });
  vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: replyParts }, finishReason: 'STOP' }],
      }),
      { status: 200 },
    ),
  );
  return adapter.execute(request);
}

describe('Gemini native adapter — tool-call failure contract', () => {
  it('rejects a forced tool call that came back as plain text instead of reporting success', async () => {
    const err: any = await executeWithReply(
      { ...baseRequest, tool_choice: 'required' },
      [{ text: 'Here is what I would have run.' }],
    ).then(() => null, e => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toMatch(/forced tool call/);
  });

  it('never emits a tool_call without a function name', async () => {
    const namedAndNameless: any = await executeWithReply(baseRequest, [
      { functionCall: { name: 'bash', args: { command: ['ls'] } } },
      { functionCall: { args: { nope: true } } },
      { text: ' trailing text' },
    ]);

    expect(namedAndNameless.message.tool_calls).toHaveLength(1);
    expect(namedAndNameless.message.tool_calls[0].function.name).toBe('bash');
    // `arguments` must always be a JSON string, even when the model omits args.
    expect(typeof namedAndNameless.message.tool_calls[0].function.arguments).toBe('string');

    // A turn whose only "call" is nameless is an empty turn — not a success
    // carrying `function.name: undefined`.
    const namelessOnly: any = await executeWithReply(
      baseRequest,
      [{ functionCall: { args: {} } }],
    ).then(() => null, e => e);
    expect(namelessOnly).toBeInstanceOf(ProviderError);
    expect(namelessOnly.message).toMatch(/empty content and no tool calls/);
  });

  it("keeps Google's validation detail but never its credential", async () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'Invalid JSON payload received for field'
          + ' .tools[0].functionDeclarations[0].parameters: Unknown field'
          + ' "additionalProperties". See https://generativelanguage.googleapis.com/v1beta'
          + `/models/gemini-2.0-flash:generateContent?key=${FAKE_GOOGLE_KEY}`,
      },
    });
    const httpError = createHttpError(400, {
      response: new Response(body, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
      request: new Request(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      ),
      body,
    });

    const adapter = new GeminiAPIAdapter();
    await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-key' });
    vi.spyOn(adapter as any, 'fetchWithTimeout').mockRejectedValue(httpError);

    const err: any = await adapter.execute(baseRequest).then(() => null, e => e);
    expect(err).toBeInstanceOf(ProviderError);
    // Why the request was rejected is the actionable part — keep it verbatim.
    expect(err.message).toContain('Unknown field "additionalProperties"');
    // ...but no credential may ride along in messages or logs.
    expect(err.message).not.toContain(FAKE_GOOGLE_KEY);
    expect(err.message).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });
});

/** Native `:streamGenerateContent?alt=sse` frames are Gemini-shaped, not OpenAI-shaped. */
function sseResponse(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function collectStream(request: UnifiedRequest, frames: unknown[]) {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-key' });
  const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(sseResponse(frames));
  const chunks: any[] = [];
  for await (const chunk of adapter.executeStream(request)) chunks.push(chunk);
  return { chunks, call: fetchSpy.mock.calls[0] as [string, RequestInit] };
}

describe('Gemini native adapter — native SSE normalization', () => {
  it('turns Gemini-shaped SSE frames into token/done StreamChunks', async () => {
    const { chunks, call } = await collectStream(baseRequest, [
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Running ' }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: 'bash', args: { command: ['ls'] } } }] } }] },
      {
        candidates: [{
          content: { parts: [{ text: ' done' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          thoughtsTokenCount: 5,
          totalTokenCount: 23,
        },
      },
    ]);

    // Native endpoint + payload still go through the same converter.
    expect(call[0]).toContain(':streamGenerateContent?alt=sse');
    expect(JSON.parse(call[1].body as string).tools[0].functionDeclarations[0].name).toBe('bash');

    // No `undefined` frames may reach the router (they dereference `chunk.type`).
    expect(chunks.every(c => c && typeof c.type === 'string')).toBe(true);

    const tokens = chunks.filter(c => c.type === 'token');
    expect(tokens.map(t => t.data.content ?? '').join('')).toBe('Running  done');

    const toolCallToken = tokens.find(t => Array.isArray(t.data.tool_calls) && t.data.tool_calls.length);
    expect(toolCallToken.data.tool_calls[0].function).toEqual({
      name: 'bash',
      arguments: '{"command":["ls"]}',
    });

    const done = chunks.filter(c => c.type === 'done');
    expect(done).toHaveLength(1);
    expect(done[0].data.finishReason).toBe('stop');
    // thoughtsTokenCount is billed output and must not be dropped.
    expect(done[0].data.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 12,
      total_tokens: 23,
    });
  });

  it('emits a terminal done frame even when the stream carries no finishReason', async () => {
    const { chunks } = await collectStream(baseRequest, [
      { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
    ]);
    expect(chunks.filter(c => c.type === 'done')).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'token', data: { content: 'partial' } });
  });

  it('flags a native error frame as a chunk error, without leaking credentials', async () => {
    const err: any = await collectStream(baseRequest, [{
      error: {
        code: 400,
        message: 'Invalid JSON payload received for field .tools[0]: Unknown field'
          + ` "additionalProperties". See ...?key=${FAKE_GOOGLE_KEY}`,
      },
    }]).then(() => null, e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.__streamChunkError).toBe(true);
    expect(err.message).toContain('Unknown field "additionalProperties"');
    expect(err.message).not.toContain(FAKE_GOOGLE_KEY);
    expect(err.message).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });
});
