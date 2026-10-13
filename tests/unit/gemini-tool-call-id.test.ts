import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';
import type { UnifiedRequest } from '@dmr-x/core';
const req: UnifiedRequest = { modality: 'llm', model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'Use the tool.' }] };
afterEach(() => vi.restoreAllMocks());
function candidate(name: string) { return { content: { parts: [{ functionCall: { name, args: {} }, thoughtSignature: 'opaque-signature' }] }, finishReason: 'STOP' }; }
async function adapter() { const a = new GeminiAPIAdapter(); await a.initialize({ apiKey: 'unit-fixture' }); return a; }
describe('Gemini tool-call IDs across sequential turns', () => {
  it('uses distinct streamed IDs so older results keep their original tool name', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const a = await adapter(); let turn = 0;
    vi.spyOn(a as any, 'fetchWithTimeout').mockImplementation(async () => new Response('data: ' + JSON.stringify({ candidates: [candidate(turn++ === 0 ? 'write' : 'read')] }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    const calls: any[] = [];
    for (let n = 0; n < 2; n++) for await (const chunk of a.executeStream(req)) { const data = chunk.data as any; if (data.tool_calls?.length) calls.push(data.tool_calls[0]); }
    expect(calls).toHaveLength(2); expect(calls[0].id).not.toBe(calls[1].id);
    const body = (a as any).convertToGeminiRequest({ ...req, messages: [req.messages![0], { role: 'assistant', content: '', tool_calls: [calls[0]] }, { role: 'tool', tool_call_id: calls[0].id, content: 'written' }, { role: 'assistant', content: '', tool_calls: [calls[1]] }, { role: 'tool', tool_call_id: calls[1].id, content: 'read' }] });
    expect(body.contents[2].parts[0].functionResponse.name).toBe('write'); expect(body.contents[4].parts[0].functionResponse.name).toBe('read');
  });
  it('uses distinct nonstreamed IDs even when the clock has not advanced', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000); const a = await adapter();
    vi.spyOn(a as any, 'fetchWithTimeout').mockImplementation(async () => new Response(JSON.stringify({ candidates: [candidate('write')] })));
    const first = await a.execute(req); const second = await a.execute(req);
    expect(first.message!.tool_calls![0].id).not.toBe(second.message!.tool_calls![0].id);
  });
});
