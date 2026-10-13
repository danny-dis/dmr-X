import { describe, expect, it } from 'vitest';
import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { Router } from '../../services/router/src/router.service.js';
import { GuardrailEngine } from '../../services/router/src/guardrails/guardrail-engine.js';

const candidate: CandidateSet[number] = {
  providerId: 'provider-a',
  providerName: 'provider-a',
  modelId: 'model-a',
  modality: 'llm',
  intelligenceLayer: 'executor',
  capabilityTier: 'executor',
  capabilities: ['general', 'streaming'],
  costPerInputToken: 0,
  costPerOutputToken: 0,
  costPerImage: 0,
  avgLatencyMs: 100,
  qualityScore: 0.9,
  isHealthy: true,
};

const complexPrompt =
  'Please build the frontend React UI and backend Node API with a database schema, write unit tests, and deploy the stack to Docker.';
const options = { path: '/v1/chat/completions', qualityTarget: 'balanced' as const };

function makeRouter() {
  const router = new Router();
  router.setGuardrailEngine(new GuardrailEngine({ enableInput: false, enableOutput: false }));
  router.setCandidates([candidate]);
  const executions: Array<{ providerId: string; modelId: string }> = [];
  router.setAdapterExecutor({
    execute: async (providerId: string, modelId: string): Promise<UnifiedResponse> => {
      executions.push({ providerId, modelId });
      return {
        modality: 'llm',
        requestId: 'fixture',
        providerId,
        modelId,
        message: { role: 'assistant', content: 'fixture response' },
        latencyMs: 1,
      };
    },
  });
  return { router, executions };
}

function request(overrides: Partial<UnifiedRequest> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'general-chat',
    messages: [{ role: 'user', content: complexPrompt }],
    stream: false,
    ...overrides,
  };
}

describe('Router plan-only agent contract', () => {
  it.each([
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'fixture tool result' },
  ])('keeps historical tool context out of text decomposition', async (toolHistory) => {
    const { router, executions } = makeRouter();
    const messages = [
      toolHistory,
      { role: 'user', content: complexPrompt },
    ] as unknown as UnifiedRequest['messages'];

    const { plan } = await router.route(request({ messages }), options);

    expect(plan.primary.providerId).toBe('provider-a');
    expect(executions).toHaveLength(1);
  });

  it('keeps a complex request with tools on the ordinary routing path', async () => {
    const { router, executions } = makeRouter();

    const { plan } = await router.route(request({
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    } as Partial<UnifiedRequest>), options);

    expect(plan.primary.providerId).toBe('provider-a');
    expect(executions).toHaveLength(1);
    expect(executions[0].providerId).toBe('provider-a');
  });

  it('keeps streaming plan-only requests on the concrete plan path', async () => {
    const { router, executions } = makeRouter();

    const { plan } = await router.route(request({ stream: true }), { ...options, planOnly: true });

    expect(executions).toEqual([]);
    expect(plan.primary.providerId).toBe('provider-a');
  });

  it('preserves an explicit provider pin when planning only', async () => {
    const { router, executions } = makeRouter();

    const { plan } = await router.route(request({ model: 'provider-a/model-a' }), { ...options, planOnly: true });

    expect(executions).toEqual([]);
    expect(plan.primary.providerId).toBe('provider-a');
    expect(plan.primary.modelId).toBe('model-a');
  });

  it('returns an executable concrete plan without executing a complex plan-only request', async () => {
    const { router, executions } = makeRouter();

    const { plan } = await router.route(request(), { ...options, planOnly: true });

    expect(executions).toEqual([]);
    expect(plan.primary.providerId).toBe('provider-a');
    expect(plan.primary.providerId).not.toBe('dmr-x-composite');
  });
});
