import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';
import type { UnifiedRequest } from '@dmr-x/core';
import { describe, expect, it, vi } from 'vitest';

const apiKey = 'fixture+key/with?reserved=&characters';
const realSignature = '  opaque-Gemini-signature/+=  ';

function request(messages: UnifiedRequest['messages'] = [{ role: 'user', content: 'continue' }]): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'gemini-3.5-flash',
    messages,
    stream: false,
    metadata: {},
  };
}

function toolCall(id: string, name: string, args: string, signature?: string) {
  return {
    id,
    type: 'function' as const,
    function: { name, arguments: args },
    ...(signature === undefined ? {} : {
      extra_content: { google: { thought_signature: signature } },
    }),
  };
}

async function makeAdapter() {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey });
  return adapter;
}

function nativeReply(parts: Record<string, unknown>[]) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts }, finishReason: 'STOP' }],
  }), { status: 200 });
}

describe('Gemini native endpoint query composition', () => {
  it('keeps alt=sse and encodes the credential as an independent query value', async () => {
    const adapter = await makeAdapter();
    const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout')
      .mockResolvedValue(new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));

    for await (const _chunk of adapter.executeStream(request())) { /* consume */ }

    const url = new URL(fetchSpy.mock.calls[0][0]);
    expect(url.searchParams.get('alt')).toBe('sse');
    expect(url.searchParams.get('key')).toBe(apiKey);
    expect([...url.searchParams.keys()]).toEqual(['alt', 'key']);
  });

  it('keeps the non-stream generateContent endpoint and credential semantics', async () => {
    const adapter = await makeAdapter();
    const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
      nativeReply([{ text: 'ok' }]),
    );

    await adapter.execute(request());

    const url = new URL(fetchSpy.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1beta/models/gemini-3.5-flash:generateContent');
    expect(url.search).toBe(`?key=${encodeURIComponent(apiKey)}`);
    expect(url.searchParams.get('key')).toBe(apiKey);
  });
});

describe('Gemini native thought signatures', () => {
  it('replays existing and imported unsigned tool history without mutating the request', async () => {
    const messages: NonNullable<UnifiedRequest['messages']> = [
      { role: 'user', content: 'run both' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          toolCall('call-real', 'first', '{"x":1}', realSignature),
          toolCall('call-sibling', 'second', '{"y":2}'),
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          toolCall('call-imported', 'imported', '{"z":3}'),
          toolCall('call-imported-sibling', 'imported_sibling', '{}'),
        ],
      },
    ];
    const original = structuredClone(messages);
    const adapter = await makeAdapter();
    const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
      nativeReply([{ text: 'ok' }]),
    );

    await adapter.execute(request(messages));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.contents[1].parts).toEqual([
      { functionCall: { name: 'first', args: { x: 1 } }, thoughtSignature: realSignature },
      { functionCall: { name: 'second', args: { y: 2 } } },
    ]);
    expect(body.contents[2].parts).toEqual([
      { functionCall: { name: 'imported', args: { z: 3 } }, thoughtSignature: 'skip_thought_signature_validator' },
      { functionCall: { name: 'imported_sibling', args: {} } },
    ]);
    expect(messages).toEqual(original);
  });

  it('adds the documented marker only to the missing first signature in an unsigned batch', async () => {
    const adapter = await makeAdapter();
    const fetchSpy = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
      nativeReply([{ text: 'ok' }]),
    );
    const messages: NonNullable<UnifiedRequest['messages']> = [
      { role: 'user', content: 'continue' },
      {
        role: 'assistant', content: '', tool_calls: [
          toolCall('call-1', 'one', '{}'),
          toolCall('call-2', 'two', '{}'),
        ],
      },
    ];

    await adapter.execute(request(messages));
    const parts = JSON.parse(fetchSpy.mock.calls[0][1].body as string).contents[1].parts;
    expect(parts.map((part: any) => part.thoughtSignature)).toEqual([
      'skip_thought_signature_validator', undefined,
    ]);
  });

  it('preserves native response signatures on non-stream tool calls', async () => {
    const adapter = await makeAdapter();
    vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(nativeReply([
      { functionCall: { name: 'lookup', args: { id: '1' } }, thoughtSignature: realSignature },
    ]));

    const result = await adapter.execute(request());
    expect(result.message?.tool_calls?.[0].extra_content?.google?.thought_signature)
      .toBe(realSignature);
  });

  it('preserves native response signatures on streamed tool calls', async () => {
    const adapter = await makeAdapter();
    vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(new Response(
      `data: ${JSON.stringify({
        candidates: [{
          content: { parts: [{
            functionCall: { name: 'lookup', args: { id: '1' } },
            thoughtSignature: realSignature,
          }] },
          finishReason: 'STOP',
        }],
      })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));

    const chunks = [];
    for await (const chunk of adapter.executeStream(request())) chunks.push(chunk);
    const toolCallChunk: any = chunks.find((chunk: any) => chunk.data?.tool_calls?.length);
    expect(toolCallChunk.data.tool_calls[0].extra_content.google.thought_signature)
      .toBe(realSignature);
  });
});
