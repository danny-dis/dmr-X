import { describe, it, expect, vi } from 'vitest';

import {
  AGENT_SERVER_MAX_STEPS,
  AGENT_SERVER_MAX_TOKENS,
  AGENT_DISPATCH_MAX_STEPS,
  AGENT_TOOL_DEF_CAP,
  resolveAgentModel,
  clampAgentSteps,
  clampAgentTokens,
  splitRequiredOptional,
  resolveAgentToolCatalog,
  splitModelId,
  preflightAgentAdmission,
  sumLoopUsage,
  buildDispatchLoopInput,
} from '../../apps/gateway/src/lib/agent-admission.js';
import { createInitialState } from '../../packages/utils/src/index.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';

// Regression tests for the completion-architecture P1 admission gaps:
// policy-authorized model overrides, finite server caps, preflight admission
// without double reservation, actual prompt/completion settlement, unknown
// paid-pricing fail-closed, required-vs-optional tools, and dispatch running
// on the shared runAgentChatLoop engine.

const TENANT = { id: 'tenant-1', name: 'tenant-1' };

describe('agent admission boundaries', () => {
  describe('resolveAgentModel (policy-authorized overrides only)', () => {
    it('uses the policy default when the caller requests no model', () => {
      const out = resolveAgentModel(undefined, {}, () => 'auto');
      expect(out).toEqual({ model: 'auto' });
    });

    it('allows a requested model that matches the policy default', () => {
      const out = resolveAgentModel('auto', {}, () => 'auto');
      expect(out.model).toBe('auto');
      expect(out.error).toBeUndefined();
    });

    it('allows a requested model matching the definition preferredModel', () => {
      const out = resolveAgentModel('openai/gpt-4o', { preferredModel: 'openai/gpt-4o' }, () => 'auto');
      expect(out.model).toBe('openai/gpt-4o');
    });

    it('rejects a caller-supplied expensive override outside policy', () => {
      const out = resolveAgentModel('openai/gpt-4o', {}, () => 'auto');
      expect(out.error).toMatch(/policy/i);
      expect(out.status).toBe(403);
    });

    it('rejects a provider-pinned model unless it is the preferredModel', () => {
      const out = resolveAgentModel('anthropic/claude-opus-4-1', { preferredModel: 'openai/gpt-4o' }, () => 'auto');
      expect(out.error).toBeDefined();
      expect(out.status).toBe(403);
    });
  });

  describe('finite server-side caps (independent of client input)', () => {
    it('exposes a finite step cap', () => {
      expect(AGENT_SERVER_MAX_STEPS).toBeGreaterThan(0);
      expect(Number.isFinite(AGENT_SERVER_MAX_STEPS)).toBe(true);
    });

    it('clamps huge client maxSteps down to the server cap', () => {
      expect(clampAgentSteps(50)).toBe(AGENT_SERVER_MAX_STEPS);
      expect(clampAgentSteps(1000000)).toBe(AGENT_SERVER_MAX_STEPS);
    });

    it('preserves small client maxSteps and defaults sensibly', () => {
      expect(clampAgentSteps(3)).toBe(3);
      expect(clampAgentSteps(undefined)).toBeLessThanOrEqual(AGENT_SERVER_MAX_STEPS);
    });

    it('clamps client maxTokens to a finite server ceiling', () => {
      expect(AGENT_SERVER_MAX_TOKENS).toBeGreaterThan(0);
      expect(clampAgentTokens(1000000)).toBe(AGENT_SERVER_MAX_TOKENS);
      expect(clampAgentTokens(100)).toBe(100);
      // LOGIC-001 hardened: an omitted maxTokens gets the finite server
      // ceiling instead of undefined (unbounded runs).
      expect(clampAgentTokens(undefined)).toBe(AGENT_SERVER_MAX_TOKENS);
    });
  });

  describe('required-vs-optional tools (fail closed on missing required)', () => {
    const fakeDefs = (names: string[]) => (wanted: string[]) =>
      wanted
        .filter((n) => names.includes(n))
        .map((n) => ({ type: 'function', function: { name: n } }) as any);

    it('marks plain names required and optional: names optional', () => {
      expect(splitRequiredOptional(['read_file', 'optional:web_fetch'])).toEqual({
        required: ['read_file'],
        optional: ['web_fetch'],
      });
    });

    it('reports missing required tools for fail-closed handling', () => {
      const out = resolveAgentToolCatalog(['read_file', 'web_fetch'], fakeDefs(['read_file']));
      expect(out.requiredMissing).toEqual(['web_fetch']);
      expect(out.optionalMissing).toEqual([]);
      expect(out.defs.map((d: any) => d.function.name)).toEqual(['read_file']);
    });

    it('lets missing optional tools pass with the resolvable subset', () => {
      const out = resolveAgentToolCatalog(['read_file', 'optional:web_fetch'], fakeDefs(['read_file']));
      expect(out.requiredMissing).toEqual([]);
      expect(out.optionalMissing).toEqual(['web_fetch']);
      expect(out.missing).toEqual(['web_fetch']);
    });

    it('resolves an empty request to the full catalog with nothing missing', () => {
      const out = resolveAgentToolCatalog([], () => fakeDefs(['a', 'b'])(['a', 'b']));
      expect(out.requiredMissing).toEqual([]);
      expect(out.missing).toEqual([]);
      expect(out.defs.length).toBe(2);
    });
  });

  describe('splitModelId', () => {
    it('splits provider/model pins', () => {
      expect(splitModelId('openai/gpt-4o')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
    });

    it('leaves aliases provider-less', () => {
      expect(splitModelId('auto')).toEqual({ providerId: null, modelId: 'auto' });
    });
  });

  describe('preflightAgentAdmission (single preflight, no double reservation)', () => {
    it('fails closed when paid pricing is unknown', async () => {
      const checkQuota = vi.fn(async () => {});
      const out = await preflightAgentAdmission({
        pricing: null,
        isFree: false,
        estimatedCostCents: 10,
        checkQuota,
      });
      expect(out.admitted).toBe(false);
      if (!out.admitted) {
        expect(out.reason).toMatch(/pricing/i);
        expect(out.status).toBe(402);
      }
      // Fail-closed happens BEFORE any quota boundary is touched: exactly zero
      // reservations, so success can never double-reserve downstream either.
      expect(checkQuota).not.toHaveBeenCalled();
    });

    it('admits free runs with unknown pricing through the quota boundary once', async () => {
      const checkQuota = vi.fn(async () => {});
      const out = await preflightAgentAdmission({
        pricing: null,
        isFree: true,
        estimatedCostCents: 0,
        checkQuota,
      });
      expect(out).toEqual({ admitted: true });
      expect(checkQuota).toHaveBeenCalledTimes(1);
    });

    it('admits priced runs when quota allows, with a single quota check', async () => {
      const checkQuota = vi.fn(async () => {});
      const out = await preflightAgentAdmission({
        pricing: { providerId: 'p', modelId: 'm', inputPricePer1kTokens: 1, outputPricePer1kTokens: 2 },
        isFree: false,
        estimatedCostCents: 5,
        checkQuota,
      });
      expect(out).toEqual({ admitted: true });
      expect(checkQuota).toHaveBeenCalledTimes(1);
    });

    it('rejects when the existing quota boundary rejects', async () => {
      const checkQuota = vi.fn(async () => {
        throw new Error('quota exceeded');
      });
      const out = await preflightAgentAdmission({
        pricing: { providerId: 'p', modelId: 'm', inputPricePer1kTokens: 1, outputPricePer1kTokens: 2 },
        isFree: false,
        estimatedCostCents: 5,
        checkQuota,
      });
      expect(out.admitted).toBe(false);
      if (!out.admitted) expect(out.reason).toMatch(/quota/i);
    });
  });

  describe('sumLoopUsage (actual prompt/completion settlement)', () => {
    it('sums prompt and completion tokens separately across steps', () => {
      const out = sumLoopUsage([
        { message: { usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 3 } } },
        { message: { usage: { prompt_tokens: 6, completion_tokens: 8, total_tokens: 14, total_cost: 5 } } },
      ] as any);
      expect(out.promptTokens).toBe(16);
      expect(out.completionTokens).toBe(12);
      expect(out.totalTokens).toBe(28);
      expect(out.cost).toBe(8);
    });

    it('returns zeros for steps without usage', () => {
      expect(sumLoopUsage([{ message: {} }] as any)).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      });
    });
  });

  describe('dispatch via the shared loop', () => {
    it('builds a bounded dispatch input with capped tool defs', () => {
      const defs = Array.from({ length: 50 }, (_, i) => ({
        type: 'function',
        function: { name: `tool_${i}` },
      }));
      const out = buildDispatchLoopInput({
        task: 'do the thing',
        messages: undefined,
        systemPrompt: 'sys',
        agentToolDefs: defs as any,
      });
      expect(out.maxSteps).toBe(AGENT_DISPATCH_MAX_STEPS);
      expect(out.agentToolDefs.length).toBeLessThanOrEqual(AGENT_TOOL_DEF_CAP);
      expect(out.agentToolDefs.length).toBe(AGENT_TOOL_DEF_CAP);
      expect(out.messages[0]).toMatchObject({ role: 'system', content: 'sys' });
      expect(out.messages[1]).toMatchObject({ role: 'user', content: 'do the thing' });
    });

    it('preserves tool transcripts, errors and final text through runAgentChatLoop', async () => {
      const toolTurn = {
        modality: 'llm',
        requestId: 'req-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        latencyMs: 1,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'no_such_tool', arguments: '{}' } }],
        },
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        finishReason: 'tool_calls',
      };
      const finalTurn = {
        modality: 'llm',
        requestId: 'req-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        latencyMs: 1,
        message: { role: 'assistant', content: 'dispatch final answer' },
        usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
        finishReason: 'stop',
      };
      const route = vi.fn().mockResolvedValueOnce({ response: toolTurn }).mockResolvedValueOnce({ response: finalTurn });

      const conversation = createInitialState('conv-dispatch-shared-loop');
      conversation.messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do the thing' },
      ];
      const result = await runAgentChatLoop({
        conversation,
        maxSteps: AGENT_DISPATCH_MAX_STEPS,
        model: 'test-model',
        agentTools: [],
        agentToolDefs: undefined,
        body: { messages: [{ role: 'user', content: 'do the thing' }] },
        requestId: 'req-dispatch-1',
        tenant: TENANT,
        router: { route } as any,
        context: {
          instanceId: 'instance-1',
          definition: { id: 'def-1', name: 'def-1', tenantId: TENANT.id, allowedTools: [] },
          instance: { id: 'instance-1', agentDefinitionId: 'def-1', configOverride: {} },
          requestId: 'req-dispatch-1',
          tenantId: TENANT.id,
        } as any,
        runtime: {} as any,
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => 'sys',
        agentDefinition: { id: 'def-1', name: 'def-1', tenantId: TENANT.id, allowedTools: [] },
        loadedSkillIds: [],
      } as any);

      expect(route).toHaveBeenCalledTimes(2);
      expect(result.lastResponseText).toBe('dispatch final answer');
      expect(result.allSteps.length).toBe(2);
      // The tool turn ran through the shared executor path and recorded its
      // (error) result instead of dropping the call like the old inline loop
      // did when a model answered with tool_calls.
      expect(result.allSteps[0].tool_calls.length).toBe(1);
      expect(result.allSteps[0].tool_results.length).toBe(1);
      // The shared loop measures the real prompt/completion split across both
      // turns (step messages carry no usage — the engine accumulates it).
      expect(result.totalTokensUsed).toBe(21);
      expect(result.totalPromptTokens).toBe(13);
      expect(result.totalCompletionTokens).toBe(8);
      const settled = sumLoopUsage([
        { message: { usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } } },
        { message: { usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 } } },
      ] as any);
      expect(settled.totalTokens).toBe(21);
      expect(settled.promptTokens).toBe(13);
      expect(settled.completionTokens).toBe(8);
    });
  });
});
