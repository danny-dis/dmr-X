import { describe, expect, it } from 'vitest';
import { ProviderError, type RoutingPlan, type UnifiedRequest } from '@dmr-x/core';
import { executeWithFallback } from '../../services/router/src/fallback/fallback-executor.js';

const plan: RoutingPlan = {
  primary: { providerId: 'google_native', modelId: 'gemini-3.1-flash-lite', adapterType: 'gemini-api', score: 1 },
  chain: [{ provider: { providerId: 'backup', modelId: 'free-model', adapterType: 'openai', score: 0 }, trigger: 'error', waitMs: 0 }],
  timeoutMs: 100, maxRetries: 1,
};
const request: UnifiedRequest = {
  model: 'auto', modality: 'llm', stream: false,
  messages: [{ role: 'user', content: 'Return JSON' }], metadata: { costFilter: 'free' },
  response_format: { type: 'json_object' },
};

describe('automatic free-only JSON recovery', () => {
  it('retries one invalid JSON response on the same free binding before cooling it down', async () => {
    const calls: string[] = [];
    const response = await executeWithFallback(plan, request, {
      execute: async (providerId) => {
        calls.push(providerId);
        if (providerId === 'google_native' && calls.length === 1) {
          throw new ProviderError('Gemini chat: upstream returned invalid JSON object', providerId, 502);
        }
        return { providerId, message: { role: 'assistant', content: '{"answer":7}' } } as any;
      },
    }, { globalTimeoutMs: 100, freeOnly: true });
    expect(response.providerId).toBe('google_native');
    expect(calls).toEqual(['google_native', 'google_native']);
  });
  it('falls back after a second invalid JSON response', async () => {
    const calls: string[] = [];
    const response = await executeWithFallback(plan, request, {
      execute: async (providerId) => {
        calls.push(providerId);
        if (providerId === 'google_native') {
          throw new ProviderError('Gemini chat: upstream returned invalid JSON object', providerId, 502);
        }
        return { providerId } as any;
      },
    }, { globalTimeoutMs: 100, freeOnly: true });
    expect(response.providerId).toBe('backup');
    expect(calls).toEqual(['google_native', 'google_native', 'backup']);
  });
  it('does not retry a non-JSON request for the same error', async () => {
    const calls: string[] = [];
    const response = await executeWithFallback(plan, { ...request, response_format: undefined }, {
      execute: async (providerId) => {
        calls.push(providerId);
        if (providerId === 'google_native') {
          throw new ProviderError('Gemini chat: upstream returned invalid JSON object', providerId, 502);
        }
        return { providerId } as any;
      },
    }, { globalTimeoutMs: 100, freeOnly: true });
    expect(response.providerId).toBe('backup');
    expect(calls).toEqual(['google_native', 'backup']);
  });
});
