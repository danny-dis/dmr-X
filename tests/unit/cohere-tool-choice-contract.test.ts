import { afterEach, describe, expect, it, vi } from 'vitest';
import { CohereAdapter } from '../../services/adapters/src/cohere/cohere.adapter.js';

const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const request: any = { modality: 'llm', model: 'command-a-03-2025', messages: [{ role: 'user', content: 'Read demo.js with the provided tool.' }], tools, tool_choice: 'required' };
afterEach(() => vi.restoreAllMocks());

describe('Cohere v2 tool-choice wire contract', () => {
  it.each([
    ['none', 'NONE'],
    [{ type: 'function', function: { name: 'read_file' } }, 'REQUIRED'],
  ])('retains explicit tool choice %j instead of silently allowing a direct answer', (toolChoice, nativeChoice) => {
    const adapter = new CohereAdapter();
    const body = (adapter as any).buildCohereChatBody({ ...request, tool_choice: toolChoice }, false);
    expect(body).toMatchObject({ tools, tool_choice: nativeChoice });
    expect(body).not.toHaveProperty('force_single_step');
  });

  it.each([false, true])('uses native REQUIRED instead of rejected force_single_step (stream=%s)', async (stream) => {
    const adapter = new CohereAdapter();
    await adapter.initialize({ apiKey: 'fixture-only', baseUrl: 'https://api.cohere.com/v2' });
    // Intercept only provider transport: exercise real adapter dispatch and body creation.
    const transport = vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValueOnce(
      stream
        ? new Response('event: message-end\ndata: {"type":"message-end","delta":{"finish_reason":"COMPLETE"}}\n\n')
        : new Response(JSON.stringify({ id: 'fixture-response', message: { content: [{ type: 'text', text: 'fixture' }] }, finish_reason: 'COMPLETE' })),
    );
    if (stream) { for await (const _chunk of adapter.executeStream(request)) { /* drain actual serializer */ } }
    else await adapter.execute(request);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.cohere.com/v2/chat');
    const body = JSON.parse(options.body);
    expect(body).not.toHaveProperty('force_single_step');
    expect(body).toMatchObject({ stream, model: request.model, tools, tool_choice: 'REQUIRED' });
  });
});
