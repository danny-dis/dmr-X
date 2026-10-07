/**
 * Agent inference single-debit regression tests.
 *
 * Validates that agent runs admitted via reserveAgentRun (whole-run hold)
 * correctly mark their outbound unified requests with the trusted
 * external-accounting marker so the router's inference lease does not debit
 * the tenant a second time — the hold already owns the tenant debit via
 * settleAgentRun. Provider capacity is still reserved through begin.
 *
 * This prevents the "double debit" bug where:
 *  1. reserveAgentRun → settleAgentRun debits the tenant for the whole run
 *  2. beginInferenceAttempt with externalAccounting: false debits again per attempt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

import { markAdmittedAgentRequest, preflightModelRun } from '../../apps/gateway/src/lib/agent-admission.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';
import { createInitialState } from '../../packages/utils/src/index.js';
import {
  wrapAccountedExecutor,
  isTrustedExternalAccounting,
  markTrustedExternalAccounting,
  InferenceSettlementError,
} from '../../services/router/src/inference-accounting.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, unknown> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'prov-a/model-a',
    messages: [{ role: 'user', content: 'hi' }],
    metadata: { requestId: 'req-1', tenant: { id: 'tenant-1' } },
    ...overrides,
  } as unknown as UnifiedRequest;
}

function makeResponse(overrides: Record<string, unknown> = {}): UnifiedResponse {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'prov-a',
    modelId: 'model-a',
    latencyMs: 5,
    message: { role: 'assistant', content: 'ok' },
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    ...overrides,
  } as unknown as UnifiedResponse;
}

function makeRawExecutor(fn: (req: UnifiedRequest) => Promise<UnifiedResponse>) {
  return {
    execute: vi.fn(async (_providerId: string, _modelId: string, request: UnifiedRequest) => fn(request)),
  };
}

function agentQuotaWithReserve(holdId = 'hold-1') {
  return {
    checkQuota: vi.fn(async () => undefined),
    reserveAgentRun: vi.fn(async () => ({ ok: true, holdId })),
    releaseAgentHold: vi.fn(async () => undefined),
    settleAgentHold: vi.fn(async () => undefined),
  };
}

function agentQuotaLegacy() {
  return {
    checkQuota: vi.fn(async () => undefined),
    // No reserveAgentRun — legacy read-only admission
    recordUsage: vi.fn(async () => undefined),
    recordProviderBudgetUsage: vi.fn(async () => undefined),
  };
}

function agentPricing() {
  return { providerId: 'prov-a', modelId: 'model-a', inputPricePer1kTokens: 1, outputPricePer1kTokens: 2 };
}

describe('agent inference single debit — whole-run hold prevents double tenant debit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('preflightModelRun stamps the request when a hold is produced', () => {
    it('marks the unified request as trusted external accounting when reserveAgentRun returns a holdId', async () => {
      const request = makeRequest();
      const quota = agentQuotaWithReserve('hold-123');

      const result = await preflightModelRun({
        model: 'prov-a/model-a',
        estimatedTokens: 1000,
        tenantId: 'tenant-1',
        requestId: 'req-1',
        getPricing: async () => agentPricing(),
        quotaService: quota as any,
        request,
      });

      expect(result.admitted).toBe(true);
      expect(result.holdId).toBe('hold-123');
      // The request should now carry the trusted external-accounting marker
      expect(isTrustedExternalAccounting(request)).toBe(true);
    });

    it('does NOT mark the request when quota service has no reserveAgentRun (legacy checkQuota-only)', async () => {
      const request = makeRequest();
      const quota = agentQuotaLegacy();

      const result = await preflightModelRun({
        model: 'prov-a/model-a',
        estimatedTokens: 1000,
        tenantId: 'tenant-1',
        requestId: 'req-1',
        getPricing: async () => agentPricing(),
        quotaService: quota as any,
        request,
      });

      expect(result.admitted).toBe(true);
      expect(result.holdId).toBeUndefined();
      // No hold → no marker → ordinary billing
      expect(isTrustedExternalAccounting(request)).toBe(false);
    });

    it('does NOT mark the request when reserveAgentRun is denied (ok: false)', async () => {
      const request = makeRequest();
      const quota = {
        checkQuota: vi.fn(async () => undefined),
        reserveAgentRun: vi.fn(async () => ({ ok: false, reason: 'budget exhausted', status: 429 })),
        releaseAgentHold: vi.fn(async () => undefined),
        settleAgentHold: vi.fn(async () => undefined),
      };

      const result = await preflightModelRun({
        model: 'prov-a/model-a',
        estimatedTokens: 1000,
        tenantId: 'tenant-1',
        requestId: 'req-1',
        getPricing: async () => agentPricing(),
        quotaService: quota as any,
        request,
      });

      expect(result.admitted).toBe(false);
      // No holdId returned → no marker
      expect(isTrustedExternalAccounting(request)).toBe(false);
    });
  });

  describe('markAdmittedAgentRequest no-op without holdId', () => {
    it('returns false and does not mark when holdId is undefined', () => {
      const request = makeRequest();
      expect(markAdmittedAgentRequest(request, undefined)).toBe(false);
      expect(isTrustedExternalAccounting(request)).toBe(false);
    });

    it('returns false and does not mark when holdId is empty string', () => {
      const request = makeRequest();
      expect(markAdmittedAgentRequest(request, '')).toBe(false);
      expect(isTrustedExternalAccounting(request)).toBe(false);
    });

    it('marks and returns true when holdId is present', () => {
      const request = makeRequest();
      expect(markAdmittedAgentRequest(request, 'hold-9')).toBe(true);
      expect(isTrustedExternalAccounting(request)).toBe(true);
    });

    it('returns false for null request', () => {
      expect(markAdmittedAgentRequest(null, 'hold-1')).toBe(false);
    });

    it('returns false for undefined request', () => {
      expect(markAdmittedAgentRequest(undefined, 'hold-1')).toBe(false);
    });
  });

  describe('trusted marker survives request spreads (router rebuild)', () => {
    it('survives { ...request, model } spread used by the gateway outbound', () => {
      const request = makeRequest();
      markTrustedExternalAccounting(request);
      expect(isTrustedExternalAccounting(request)).toBe(true);

      // Gateway rebuild: { ...unifiedRequest, model: 'other' }
      const rebuilt = { ...request, model: 'prov-b/model-b' };
      expect(isTrustedExternalAccounting(rebuilt)).toBe(true);
    });

    it('survives { ...request, signal } spread used by routeWithTimeout', () => {
      const request = makeRequest();
      markTrustedExternalAccounting(request);
      expect(isTrustedExternalAccounting(request)).toBe(true);

      // routeWithTimeout does: { ...unifiedRequest, signal: ac.signal }
      const ac = new AbortController();
      const rebuilt = { ...request, signal: ac.signal };
      expect(isTrustedExternalAccounting(rebuilt)).toBe(true);
    });

    it('does NOT trust a freshly rebuilt metadata bag that merely copied the symbol', () => {
      const request = makeRequest();
      markTrustedExternalAccounting(request);
      expect(isTrustedExternalAccounting(request)).toBe(true);

      // Extract the symbol from the original metadata
      const symbols = Object.getOwnPropertySymbols(request.metadata);
      expect(symbols.length).toBeGreaterThan(0);

      // A forged request with a fresh metadata bag containing the same symbol
      const forged = makeRequest();
      (forged.metadata as Record<symbol, unknown>)[symbols[0]] = true;

      // Should NOT be trusted — the WeakSet check fails
      expect(isTrustedExternalAccounting(forged)).toBe(false);
    });
  });

  describe('end-to-end: accounted executor respects the marker', () => {
    it('trusted request skips tenant debit but still reserves provider capacity (begin called with externalAccounting: true)', async () => {
      const { boundary, leases } = makeBoundary();
      const request = makeRequest();
      markAdmittedAgentRequest(request, 'hold-1');

      const raw = makeRawExecutor(async () => makeResponse());
      const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

      await executor.execute('prov-a', 'model-a', request);

      // begin was called
      expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
      // externalAccounting flag is true → quota core skips tenant debit
      expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(true);
      // Upstream still executed (capacity reservation works)
      expect(raw.execute).toHaveBeenCalledTimes(1);
      // settle called with actual usage
      expect(leases[0].settle).toHaveBeenCalledTimes(1);
      // Legacy recordUsage NOT called (would be double debit)
      expect(boundary.recordUsage).not.toHaveBeenCalled();
      expect(boundary.recordProviderBudgetUsage).not.toHaveBeenCalled();
    });

    it('unmarked request (no hold) with accounting boundary debits tenant via begin (externalAccounting: false)', async () => {
      const { boundary, leases } = makeBoundary();
      const request = makeRequest(); // No marker

      const raw = makeRawExecutor(async () => makeResponse());
      const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

      await executor.execute('prov-a', 'model-a', request);

      // begin was called with externalAccounting: false → quota core debits tenant
      expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
      expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(false);
      // Upstream still executed
      expect(raw.execute).toHaveBeenCalledTimes(1);
      // settle called
      expect(leases[0].settle).toHaveBeenCalledTimes(1);
    });

    it('client-supplied externalAccounting metadata is ignored (never trusted)', async () => {
      const { boundary } = makeBoundary();
      // Client tries to forge the marker via JSON metadata
      const request = makeRequest({
        metadata: { requestId: 'req-1', tenant: { id: 'tenant-1' }, externalAccounting: true },
      });

      const raw = makeRawExecutor(async () => makeResponse());
      const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

      await executor.execute('prov-a', 'model-a', request);

      // Should NOT be trusted
      expect(isTrustedExternalAccounting(request)).toBe(false);
      // externalAccounting should be false
      expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(false);
    });
  });

  describe('runAgentChatLoop marks every turn when holdId is provided', () => {
    it('marks the unified request on each turn when holdId is passed', async () => {
      const conversation = createInitialState('conv-1');
      conversation.messages = [
        { role: 'system', content: 'You are a test agent' },
        { role: 'user', content: 'hello' },
      ];

      // Mock router that tracks marked requests
      const markedRequests: UnifiedRequest[] = [];
      const router = {
        getCandidates: () => [],
        route: vi.fn(async (req: UnifiedRequest) => {
          markedRequests.push(req);
          return { response: makeResponse() };
        }),
        getCandidate: () => null,
        getEffectiveCostFilter: () => 'all',
      } as any;

      const runtime = {
        classifyProviderError: () => ({ retryable: false, reason: 'test' }),
        resolveFallbackModel: () => null,
        buildSystemPrompt: async () => 'system prompt',
      } as any;

      const holdId = 'hold-abc';

      await runAgentChatLoop({
        conversation,
        maxSteps: 2,
        model: 'prov-a/model-a',
        agentTools: [],
        agentToolDefs: [],
        body: { maxTokens: 100, temperature: 0 },
        requestId: 'req-1',
        tenant: { id: 'tenant-1', name: 'tenant-1' },
        router,
        context: { definition: { planMode: false, historyCompaction: false } },
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => 'system prompt',
        agentDefinition: { id: 'def-1', name: 'Test Agent', tenantId: 'tenant-1', allowedTools: [] },
        godmodeWrap: false,
        freeOnly: false,
        loadedSkillIds: [],
        runtime,
        conversationId: 'conv-1',
        holdId,
      });

      // Every routed request should be marked
      for (const req of markedRequests) {
        expect(isTrustedExternalAccounting(req)).toBe(true);
      }
    });

    it('does NOT mark requests when holdId is not provided', async () => {
      const conversation = createInitialState('conv-2');
      conversation.messages = [
        { role: 'system', content: 'You are a test agent' },
        { role: 'user', content: 'hello' },
      ];

      const markedRequests: UnifiedRequest[] = [];
      const router = {
        getCandidates: () => [],
        route: vi.fn(async (req: UnifiedRequest) => {
          markedRequests.push(req);
          return { response: makeResponse() };
        }),
        getCandidate: () => null,
        getEffectiveCostFilter: () => 'all',
      } as any;

      const runtime = {
        classifyProviderError: () => ({ retryable: false, reason: 'test' }),
        resolveFallbackModel: () => null,
        buildSystemPrompt: async () => 'system prompt',
      } as any;

      // No holdId passed
      await runAgentChatLoop({
        conversation,
        maxSteps: 2,
        model: 'prov-a/model-a',
        agentTools: [],
        agentToolDefs: [],
        body: { maxTokens: 100, temperature: 0 },
        requestId: 'req-2',
        tenant: { id: 'tenant-1', name: 'tenant-1' },
        router,
        context: { definition: { planMode: false, historyCompaction: false } },
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => 'system prompt',
        agentDefinition: { id: 'def-1', name: 'Test Agent', tenantId: 'tenant-1', allowedTools: [] },
        godmodeWrap: false,
        freeOnly: false,
        loadedSkillIds: [],
        runtime,
        conversationId: 'conv-2',
      });

      // No requests should be marked
      for (const req of markedRequests) {
        expect(isTrustedExternalAccounting(req)).toBe(false);
      }
    });

    it('marks plan phase and summary/recovery requests when holdId is provided', async () => {
      const conversation = createInitialState('conv-3');
      conversation.messages = [
        { role: 'system', content: 'You are a test agent' },
        { role: 'user', content: 'hello' },
      ];

      const markedRequests: UnifiedRequest[] = [];
      const router = {
        getCandidates: () => [],
        route: vi.fn(async (req: UnifiedRequest) => {
          markedRequests.push(req);
          return { response: makeResponse() };
        }),
        getCandidate: () => null,
        getEffectiveCostFilter: () => 'all',
      } as any;

      const runtime = {
        classifyProviderError: () => ({ retryable: false, reason: 'test' }),
        resolveFallbackModel: () => null,
        buildSystemPrompt: async () => 'system prompt',
      } as any;

      const holdId = 'hold-xyz';

      await runAgentChatLoop({
        conversation,
        maxSteps: 2,
        model: 'prov-a/model-a',
        agentTools: [],
        agentToolDefs: [],
        body: { maxTokens: 100, temperature: 0 },
        requestId: 'req-3',
        tenant: { id: 'tenant-1', name: 'tenant-1' },
        router,
        context: { definition: { planMode: true, historyCompaction: false } }, // Enable plan phase
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: async () => 'system prompt',
        agentDefinition: { id: 'def-1', name: 'Test Agent', tenantId: 'tenant-1', allowedTools: [] },
        godmodeWrap: false,
        freeOnly: false,
        loadedSkillIds: [],
        runtime,
        conversationId: 'conv-3',
        holdId,
      });

      // All routed requests (plan + main loop) should be marked
      for (const req of markedRequests) {
        expect(isTrustedExternalAccounting(req)).toBe(true);
      }
    });
  });

});

async function runAuxiliaryScenario(options: {
  phase?: 'plan' | 'compact';
  auxiliaryText?: string;
  auxiliaryError?: Error;
  freeOnly?: boolean;
} = {}) {
  const phase = options.phase ?? 'plan';
  const conversation = createInitialState('aux-conv');
  conversation.messages = [
    { role: 'system', content: 'Test system' },
    ...Array.from({ length: phase === 'compact' ? 30 : 1 }, (_, i) => ({
      role: 'user' as const, content: `message ${i}`,
    })),
  ];
  let mainCalls = 0;
  const router = {
    getCandidates: () => [],
    getCandidate: () => null,
    getEffectiveCostFilter: () => 'all',
    route: vi.fn(async (_req: UnifiedRequest, routeOptions: { path: string }) => {
      const auxiliary = routeOptions.path === `/v1/agents/${phase}`;
      if (auxiliary && options.auxiliaryError) throw options.auxiliaryError;
      const toolTurn = !auxiliary && phase === 'compact' && mainCalls++ === 0;
      return { response: makeResponse({
        message: toolTurn ? {
          role: 'assistant', content: '',
          tool_calls: [{ id: 'aux-tool', type: 'function', function: { name: 'unknown_aux_tool', arguments: '{}' } }],
        } : { role: 'assistant', content: auxiliary ? (options.auxiliaryText ?? 'auxiliary text') : 'done' },
        finishReason: toolTurn ? 'tool_calls' : 'stop',
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cost: 0.001 },
      }) };
    }),
  };
  const args = {
    conversation, maxSteps: 2, model: 'prov-a/model-a', agentTools: [], agentToolDefs: [],
    body: { maxTokens: 100 }, requestId: 'aux-request', tenant: { id: 'tenant-1', name: 'tenant-1' },
    router, context: { definition: { planMode: phase === 'plan', historyCompaction: phase === 'compact' } },
    stream: false, onStreamEvent: () => {}, buildSystemPrompt: async () => 'system',
    agentDefinition: { id: 'def-1', name: 'test', tenantId: 'tenant-1', allowedTools: [] },
    godmodeWrap: false, freeOnly: options.freeOnly ?? false, loadedSkillIds: [],
    runtime: { classifyProviderError: () => ({ retryable: false }), resolveFallbackModel: () => null },
    holdId: 'aux-hold',
  } as any;
  return { result: await runAgentChatLoop(args), router };
}

async function runTerminalScenario(phase: 'summary' | 'recovery', second: UnifiedResponse | Error) {
  const conversation = createInitialState('terminal-conv');
  conversation.messages = [{ role: 'user', content: 'hello' }];
  const first = makeResponse({ message: phase === 'summary' ? {
    role: 'assistant', content: '',
    tool_calls: [{ id: 'pending', type: 'function', function: { name: 'unknown', arguments: '{}' } }],
  } : { role: 'assistant', content: '<thought>hidden</thought>' } });
  const route = vi.fn().mockResolvedValueOnce({ response: first });
  if (second instanceof Error) route.mockRejectedValueOnce(second);
  else route.mockResolvedValueOnce({ response: second });
  return runAgentChatLoop({
    conversation, maxSteps: 1, model: 'prov-a/model-a', agentTools: [], agentToolDefs: [], body: {},
    requestId: 'terminal', tenant: { id: 'tenant-1', name: 'tenant-1' },
    router: { route, getCandidates: () => [], getEffectiveCostFilter: () => 'all' },
    context: { definition: {} }, stream: false, onStreamEvent: () => {},
    buildSystemPrompt: async () => 'system',
    agentDefinition: { id: 'def-1', name: 'test', tenantId: 'tenant-1', allowedTools: [] },
    loadedSkillIds: [], runtime: { classifyProviderError: () => ({ retryable: false }) }, holdId: 'terminal-hold',
  } as any);
}

describe('agent terminal accounting', () => {
  it('does not retry a settlement failure even when the runtime labels it retryable', async () => {
    const error = new InferenceSettlementError(new Error('ledger unavailable'));
    const route = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ response: makeResponse() });
    await expect(runAgentChatLoop({
      conversation: createInitialState('retry-conv'), maxSteps: 1, model: 'prov-a/model-a',
      agentTools: [], agentToolDefs: [], body: {}, requestId: 'retry', tenant: { id: 't', name: 't' },
      router: { route, getCandidates: () => [], getEffectiveCostFilter: () => 'all' },
      context: { definition: {} }, stream: false, onStreamEvent: () => {},
      buildSystemPrompt: async () => 'system',
      agentDefinition: { id: 'd', name: 'test', tenantId: 't', allowedTools: [] }, loadedSkillIds: [],
      runtime: {
        classifyProviderError: () => ({ retryable: true, reason: 'transient' }),
        resolveFallbackModel: () => 'prov-b/model-b',
      }, holdId: 'retry-hold',
    } as any)).rejects.toBe(error);
    expect(route).toHaveBeenCalledTimes(1);
  });

  it.each(['summary', 'recovery'] as const)('propagates %s settlement failure', async (phase) => {
    const error = new InferenceSettlementError(new Error('ledger unavailable'));
    await expect(runTerminalScenario(phase, error)).rejects.toBe(error);
  });

  it('counts final-summary usage even if the provider returns no text', async () => {
    const result = await runTerminalScenario('summary', makeResponse({ message: { role: 'assistant', content: '' } }));
    expect(result.totalTokensUsed).toBe(14);
  });
});

describe('agent auxiliary inference accounting', () => {
  it('preserves trusted accounting through free-only main-turn request reconstruction', async () => {
    const { router } = await runAuxiliaryScenario({ freeOnly: true });
    expect(router.route.mock.calls.length).toBeGreaterThan(1);
    for (const [request] of router.route.mock.calls) expect(isTrustedExternalAccounting(request)).toBe(true);
  });

  it.each(['plan', 'compact'] as const)('propagates %s settlement failure without another dispatch', async (phase) => {
    const error = new InferenceSettlementError(new Error('ledger unavailable'));
    await expect(runAuxiliaryScenario({ phase, auxiliaryError: error })).rejects.toBe(error);
  });

  it.each(['plan', 'compact'] as const)('keeps ordinary %s transport failures non-fatal', async (phase) => {
    const { result } = await runAuxiliaryScenario({ phase, auxiliaryError: new Error('transport unavailable') });
    expect(result.lastResponseText).toBe('done');
  });

  it.each(['plan', 'compact'] as const)('inherits free-only policy for %s calls', async (phase) => {
    const { router } = await runAuxiliaryScenario({ phase, freeOnly: true });
    const auxiliary = router.route.mock.calls.find(([, opts]) => opts.path === `/v1/agents/${phase}`);
    expect(auxiliary).toBeDefined();
    expect(auxiliary![0].metadata?.freeTierStrategy).toBe('free_only');
    expect(isTrustedExternalAccounting(auxiliary![0])).toBe(true);
  });

  it('counts compaction usage even when the summary contains no text', async () => {
    const { result, router } = await runAuxiliaryScenario({ phase: 'compact', auxiliaryText: '' });
    expect(router.route.mock.calls.some(([, opts]) => opts.path === '/v1/agents/compact')).toBe(true);
    expect(result.totalTokensUsed).toBe(21);
    expect(result.totalPromptTokens).toBe(9);
    expect(result.totalCompletionTokens).toBe(12);
    expect(result.totalCost).toBeCloseTo(0.003);
  });

  it('counts planning usage even when the plan contains no text', async () => {
    const { result } = await runAuxiliaryScenario({ auxiliaryText: '' });
    expect(result.totalTokensUsed).toBe(14);
    expect(result.totalPromptTokens).toBe(6);
    expect(result.totalCompletionTokens).toBe(8);
    expect(result.totalCost).toBeCloseTo(0.002);
  });
});

// Reuse boundary fixture from inference-reservation-integration.test.ts
function makeBoundary(options: { deny?: boolean; settleFails?: boolean; releaseFails?: boolean } = {}) {
  const events: string[] = [];
  const leases: Array<{ settle: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }> = [];
  const boundary = {
    beginInferenceAttempt: vi.fn(
      async (
        _tenantId: unknown,
        _providerId: unknown,
        _modelId: unknown,
        _req: unknown,
        _opts: unknown,
      ) => {
        events.push('begin');
        if (options.deny) throw new Error('tenant budget exhausted');
        const lease = {
          settle: vi.fn(async (_response: unknown) => {
            events.push('settle');
            if (options.settleFails) throw new Error('ledger write failed');
          }),
          release: vi.fn(async () => {
            events.push('release');
            if (options.releaseFails) throw new Error('release failed');
          }),
        };
        leases.push(lease);
        return lease;
      },
    ),
    checkQuota: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    recordProviderBudgetUsage: vi.fn(async () => undefined),
  };
  return { boundary, events, leases };
}

function makeLegacyQuota() {
  return {
    checkQuota: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    recordProviderBudgetUsage: vi.fn(async () => undefined),
  };
}