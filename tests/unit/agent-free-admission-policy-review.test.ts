import { describe, expect, it, vi } from 'vitest';
import { Router } from '../../services/router/src/router.service.ts';
import { createInitialState } from '../../packages/utils/src/index.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';
import { preflightModelRun, settleAgentRun } from '../../apps/gateway/src/lib/agent-admission.js';

const TENANT = { id: 'tenant-free-policy', name: 'tenant-free-policy' };

const candidate = (providerId: string, modelId: string, extra: Record<string, unknown> = {}) => ({
  providerId,
  providerName: providerId,
  modelId,
  modality: 'llm',
  intelligenceLayer: 'executor',
  capabilityTier: 'executor',
  capabilities: ['streaming', 'tool_use'],
  contextLength: 128000,
  costPerInputToken: 0,
  costPerOutputToken: 0,
  avgLatencyMs: 10,
  qualityScore: 0.9,
  isHealthy: true,
  ...extra,
});

const freeCandidate = candidate('free-provider', 'free-model', { pricingTier: 'free' });
const paidCandidate = candidate('paid-provider', 'paid-model', {
  pricingTier: 'paid',
  costPerInputToken: 0.000001,
  costPerOutputToken: 0.000002,
});

function loopContext() {
  return {
    instanceId: 'instance-free-policy',
    definition: { id: 'definition-free-policy', name: 'free-policy', tenantId: TENANT.id, allowedTools: [] },
    instance: { id: 'instance-free-policy', agentDefinitionId: 'definition-free-policy', configOverride: {} },
    requestId: 'request-free-policy',
    tenantId: TENANT.id,
  } as any;
}

function runtime() {
  return {
    classifyProviderError: () => ({ retryable: false, reason: 'test failure' }),
    resolveFallbackModel: () => null,
  } as any;
}

async function runAliasLoop(stream: boolean, freeOnly?: boolean) {
  const calls: string[] = [];
  const router = new Router({ enableDecomposition: false });
  router.setCandidates([freeCandidate, paidCandidate] as any);
  router.setAdapterExecutor({
    execute: vi.fn(async (providerId: string, modelId: string) => {
      calls.push(`${providerId}/${modelId}`);
      if (providerId === 'free-provider') throw new Error('free provider unavailable');
      return {
        providerId,
        modelId,
        modality: 'llm',
        requestId: 'response-free-policy',
        latencyMs: 1,
        message: { role: 'assistant', content: 'paid response' },
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        finishReason: 'stop',
      } as any;
    }),
  });

  const conversation = createInitialState(`conversation-free-policy-${stream}-${freeOnly ?? 'missing'}`);
  conversation.messages = [{ role: 'user', content: 'Say hello' }];
  try {
    const result = await runAgentChatLoop({
      conversation,
      maxSteps: 1,
      model: 'auto',
      freeOnly,
      agentTools: [],
      agentToolDefs: undefined,
      body: { messages: [{ role: 'user', content: 'Say hello' }] },
      requestId: 'request-free-policy',
      tenant: TENANT,
      router,
      context: loopContext(),
      runtime: runtime(),
      stream,
      onStreamEvent: () => {},
      buildSystemPrompt: async () => 'You are a test agent.',
      agentDefinition: { id: 'definition-free-policy', name: 'free-policy', tenantId: TENANT.id, allowedTools: [] },
      loadedSkillIds: [],
    } as any);
    return { calls, result, error: undefined };
  } catch (error) {
    return { calls, result: undefined, error };
  }
}

describe('free admission policy review', () => {
  it('marks an alias admitted only by free resolution as freeOnly', async () => {
    const result = await preflightModelRun({
      model: 'auto',
      estimatedTokens: 100,
      maxSteps: 1,
      tenantId: TENANT.id,
      requestId: 'preflight-free-alias',
      getPricing: async () => null,
      resolveAliasFree: async () => true,
    });

    expect(result).toEqual({ admitted: true, estimatedCostCents: 0, isFree: true, freeOnly: true });
  });

  it('marks an explicitly paid model as not freeOnly', async () => {
    const reserveAgentRun = vi.fn(async () => ({ ok: true, holdId: 'hold-paid' }));
    const result = await preflightModelRun({
      model: 'paid-provider/paid-model',
      estimatedTokens: 100,
      maxSteps: 1,
      tenantId: TENANT.id,
      requestId: 'preflight-paid',
      getPricing: async () => ({
        providerId: 'paid-provider',
        modelId: 'paid-model',
        inputPricePer1kTokens: 1,
        outputPricePer1kTokens: 1,
      }),
      // A paid run needs a budget guard to admit; with one, it must NOT be
      // flagged free-only so the router is free to use paid candidates.
      quotaService: { checkQuota: async () => {}, reserveAgentRun },
    });

    expect(result).toMatchObject({ admitted: true, isFree: false, freeOnly: false });
    expect(reserveAgentRun).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'rejects a paid fallback after free alias admission in %s streaming mode without calling it',
    async (stream) => {
      const outcome = await runAliasLoop(stream, true);
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.calls).toEqual(['free-provider/free-model']);
    },
  );

  it('requires proof before an unresolved alias can route', async () => {
    const calls: string[] = [];
    const router = new Router({ enableDecomposition: false });
    router.setCandidates([paidCandidate] as any);
    router.setAdapterExecutor({
      execute: vi.fn(async (providerId: string) => {
        calls.push(providerId);
        return { providerId, modelId: 'paid-model', message: { role: 'assistant', content: 'paid' } } as any;
      }),
    });

    const conversation = createInitialState('conversation-unproven-alias');
    conversation.messages = [{ role: 'user', content: 'Say hello' }];
    await expect(
      runAgentChatLoop({
        conversation,
        maxSteps: 1,
        model: 'auto',
        agentTools: [],
        agentToolDefs: undefined,
        body: { messages: [{ role: 'user', content: 'Say hello' }] },
        requestId: 'request-unproven-alias',
        tenant: TENANT,
        router,
        context: loopContext(),
        runtime: runtime(),
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => 'You are a test agent.',
        agentDefinition: { id: 'definition-free-policy', name: 'free-policy', tenantId: TENANT.id, allowedTools: [] },
        loadedSkillIds: [],
      } as any),
    ).rejects.toThrow(/free-only admission proof/);
    expect(calls).toEqual([]);
  });

  it('keeps an explicitly paid model paid', async () => {
    const calls: string[] = [];
    const router = new Router({ enableDecomposition: false });
    router.setCandidates([paidCandidate] as any);
    router.setAdapterExecutor({
      execute: vi.fn(async (providerId: string, modelId: string) => {
        calls.push(`${providerId}/${modelId}`);
        return {
          providerId,
          modelId,
          message: { role: 'assistant', content: 'paid response' },
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          finishReason: 'stop',
        } as any;
      }),
    });

    const conversation = createInitialState('conversation-paid');
    conversation.messages = [{ role: 'user', content: 'Say hello' }];
    const result = await runAgentChatLoop({
      conversation,
      maxSteps: 1,
      model: 'paid-provider/paid-model',
      freeOnly: false,
      agentTools: [],
      agentToolDefs: undefined,
      body: { messages: [{ role: 'user', content: 'Say hello' }] },
      requestId: 'request-paid',
      tenant: TENANT,
      router,
      context: loopContext(),
      runtime: runtime(),
      stream: false,
      onStreamEvent: () => {},
      buildSystemPrompt: async () => 'You are a test agent.',
      agentDefinition: { id: 'definition-free-policy', name: 'free-policy', tenantId: TENANT.id, allowedTools: [] },
      loadedSkillIds: [],
    } as any);

    expect(result.lastResponseText).toBe('paid response');
    expect(calls).toEqual(['paid-provider/paid-model']);
  });

  it('attributes settlement to the actual routed provider instead of generic agent', async () => {
    const calls: Array<{ providerId: string; modelId: string }> = [];
    await settleAgentRun({
      tenantId: TENANT.id,
      model: 'auto',
      allSteps: [{
        message: { usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
        providerId: 'actual-provider',
        modelId: 'actual-model',
      }] as any,
      requestId: 'request-attribution',
      sums: { promptTokens: 2, completionTokens: 3, totalTokens: 5, cost: 0.01 },
      quotaService: {
        recordUsage: async (_tenantId, providerId, _tokens, _cost) => calls.push({ providerId, modelId: 'actual-model' }),
      } as any,
    });
    expect(calls).toEqual([{ providerId: 'actual-provider', modelId: 'actual-model' }]);
  });
});
