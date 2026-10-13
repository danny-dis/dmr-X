import { describe, expect, it } from 'vitest';
import { GenericOpenAIAdapter } from '../../services/adapters/src/generic-openai/generic-openai.adapter.js';
import type { UnifiedRequest } from '@dmr-x/core';
const marker = 'skip_thought_signature_validator';
function call(id: string, signature?: string) {
  return { id, type: 'function' as const, function: { name: 'write', arguments: '{"enabled":false}' }, ...(signature !== undefined ? { extra_content: { google: { thought_signature: signature }, caller: { keep: true } } } : {}) };
}
function request(calls = [call('call_1')]): UnifiedRequest {
  return { modality: 'llm', model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'Disable the demo flag.' }, { role: 'assistant', content: '', tool_calls: calls }, { role: 'tool', tool_call_id: 'call_1', content: '{"enabled":false}' }], tools: [{ type: 'function', function: { name: 'write', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } } } } }] };
}
function body(req: UnifiedRequest, provider = 'google', baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai', stream = false): any {
  const a: any = new GenericOpenAIAdapter(provider); a.config = { baseUrl }; return a.buildChatBody(req, stream);
}
describe('Google OpenAI imported tool-history signatures', () => {
  it.each([false, true])('marks unsigned first calls for stream=%s without changing history data', stream => {
    const req = request(); const original = structuredClone(req); const b = body(req, 'google', undefined, stream);
    expect(b.messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(marker);
    expect(b.messages[1].tool_calls[0].function).toEqual(req.messages![1].tool_calls![0].function);
    expect(b.messages[2]).toEqual(req.messages![2]); expect(b.tools).toEqual(req.tools); expect(req).toEqual(original);
  });
  it('preserves signed first calls and unsigned parallel siblings exactly', () => {
    const req = request([call('call_1', 'opaque+/=signature'), call('call_2')]); const b = body(req);
    expect(b.messages).toEqual(req.messages); expect(b.messages[1].tool_calls[1].extra_content).toBeUndefined();
  });
  it('handles unsigned first calls in every sequential assistant batch', () => {
    const req = request(); req.messages!.push({ role: 'assistant', content: '', tool_calls: [call('call_2')] }, { role: 'tool', tool_call_id: 'call_2', content: 'ok' }); const b = body(req);
    expect(b.messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(marker); expect(b.messages[3].tool_calls[0].extra_content.google.thought_signature).toBe(marker);
  });
  it('fills an empty signature while retaining other extra content', () => {
    const req = request([call('call_1', '')]); const original = structuredClone(req); const b = body(req);
    expect(b.messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(marker); expect(b.messages[1].tool_calls[0].extra_content.caller).toEqual({ keep: true }); expect(req).toEqual(original);
  });
  it('recognizes the real Google mount under an alternate provider id', () => { expect(body(request(), 'custom').messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(marker); });
  it('does not alter unrelated providers or a deceptive Google substring', () => {
    const req = request(); expect(body(req, 'mistral', 'https://api.mistral.ai/v1').messages).toBe(req.messages);
    expect(body(req, 'custom', 'https://example.invalid/generativelanguage.googleapis.com/v1beta/openai').messages).toBe(req.messages);
  });
  it('leaves text-only and empty assistant histories unchanged', () => {
    const req: UnifiedRequest = { modality: 'llm', messages: [{ role: 'assistant', content: 'OK', tool_calls: [] }] }; expect(body(req).messages).toEqual(req.messages);
  });
});
