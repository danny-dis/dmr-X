import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../packages/core/src/types/errors.js';
import { executeWithFallback, resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

beforeEach(() => resetModelErrorCache());

const plan = { primary: { providerId: 'primary', modelId: 'a', adapterType: 'test', score: 1 }, chain: [{ provider: { providerId: 'fallback', modelId: 'b', adapterType: 'test', score: .5 }, trigger: 'error' as const, waitMs: 0 }], timeoutMs: 100, maxRetries: 0 };
const request = (metadata: Record<string, unknown> = {}) => ({ modality: 'llm', stream: false, metadata, response_format: { type: 'json_object' as const }, messages: [{ role: 'user', content: 'x' }] });
const response = (providerId: string, content: string) => ({ modality: 'llm', requestId: 'r', providerId, modelId: 'm', latencyMs: 1, message: { role: 'assistant', content }, usage: { total_tokens: 1 } }) as any;

describe('output validation recovery', () => {
  it('recovers invalid JSON primary through a valid fallback without leaking content', async () => {
    const execute = vi.fn().mockResolvedValueOnce(response('primary', '```json\n{}\n```')).mockResolvedValueOnce(response('fallback', '{}'));
    const result = await executeWithFallback(plan as any, request() as any, { execute });
    expect(result.providerId).toBe('fallback');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('accepts a default tool-only response with one dispatch', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...response('primary', ''),
      message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
    });
    const toolRequest = { ...request(), response_format: undefined, tools: [{ type: 'function', function: { name: 'lookup' } }] };
    await expect(executeWithFallback(plan as any, toolRequest as any, { execute })).resolves.toMatchObject({ providerId: 'primary' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not report success until validation passes and releases the rejected slot', async () => {
    const execute = vi.fn().mockResolvedValueOnce(response('primary', '[]')).mockResolvedValueOnce(response('fallback', '{}'));
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const rateLimitService = {
      checkLimit: vi.fn(() => ({ allowed: true })), recordUsage: vi.fn(),
      acquireConcurrencySlot: vi.fn(), releaseConcurrencySlot: vi.fn(),
    };
    const result = await executeWithFallback(plan as any, request() as any, { execute }, { onSuccess, onFailure, rateLimitService: rateLimitService as any, requestId: 'validation' });
    expect(result.providerId).toBe('fallback');
    expect(onFailure).toHaveBeenCalledWith('primary');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('fallback');
    expect(rateLimitService.releaseConcurrencySlot).toHaveBeenCalledWith('primary', 'primary:validation');
    expect(rateLimitService.releaseConcurrencySlot).toHaveBeenCalledWith('fallback', 'fallback:validation');
  });

  it('keeps freeOnly recovery within the supplied candidate chain', async () => {
    const execute = vi.fn().mockResolvedValueOnce(response('primary', '[]')).mockResolvedValueOnce(response('fallback', '{}'));
    await expect(executeWithFallback(plan as any, request() as any, { execute }, { freeOnly: true })).resolves.toMatchObject({ providerId: 'fallback' });
    expect(execute.mock.calls.map(call => call[0])).toEqual(['primary', 'fallback']);
  });

  it('rejects invalid contracts before dispatch', async () => {
    const execute = vi.fn();
    await expect(executeWithFallback(plan as any, request({ outputContract: { minCharacters: Infinity } }) as any, { execute })).rejects.toBeInstanceOf(ValidationError);
    expect(execute).not.toHaveBeenCalled();
  });
});
