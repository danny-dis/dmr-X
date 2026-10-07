import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedResponse, setCachedResponse } from '../../services/cache/src/cache.service.js';
const data = vi.hoisted(() => new Map<string, string>());
vi.mock('@dmr-x/db', () => ({ createNamespacedCache: () => ({
  get: (key: string) => data.get(key) ?? null,
  set: (key: string, value: string) => data.set(key, value),
  del: (key: string) => data.delete(key), incrBy: () => 1, expire: vi.fn(),
}) }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
const request = { model: 'auto', messages: [{ role: 'user', content: 'Explain the result.' }] };
beforeEach(() => data.clear());

describe('response cache acceptance', () => {
  it('does not replay truncated chat completions', () => {
    const response = { message: { role: 'assistant', content: 'Incomplete explanation' }, finishReason: 'length' };
    setCachedResponse('chat', 'tenant', request, response);
    expect(getCachedResponse('chat', 'tenant', request)).toBeNull();
  });

  it('isolates user identities within a tenant', () => {
    const response = { message: { role: 'assistant', content: 'Personal answer' }, finishReason: 'stop' };
    setCachedResponse('chat', 'tenant', { ...request, user: 'alice' }, response);
    expect(getCachedResponse('chat', 'tenant', { ...request, user: 'bob' })).toBeNull();
  });

  it.each([
    { message: { content: ' ' }, finishReason: 'stop' },
    { message: { content: 'Done', tool_calls: [{ id: 'call-1' }] }, finishReason: 'stop' },
    { message: { content: 'Done', refusal: 'declined' }, finishReason: 'stop' },
    { choices: [{ message: { content: 'Partial' }, finish_reason: 'length' }] },
    { error: 'upstream failed' },
  ])('rejects empty, stateful, refusal or error responses: %j', response => {
    setCachedResponse('chat', 'tenant', request, response);
    expect(getCachedResponse('chat', 'tenant', request)).toBeNull();
  });

  it('still caches complete chat and non-chat responses', () => {
    const response = { message: { content: 'A full answer' }, finishReason: 'stop' };
    setCachedResponse('chat', 'tenant', request, response);
    expect(getCachedResponse('chat', 'tenant', request)?.response).toEqual(response);
    const embedding = { data: [{ embedding: [0.1, 0.2] }] };
    setCachedResponse('embedding', 'tenant', { input: 'text' }, embedding);
    expect(getCachedResponse('embedding', 'tenant', { input: 'text' })?.response).toEqual(embedding);
  });
});
