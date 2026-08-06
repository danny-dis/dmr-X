import type { CandidateSet, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { describe, it, expect } from 'vitest';

import { Router } from '../../services/router/src/router.service.js';
import { GuardrailEngine } from '../../services/router/src/guardrails/guardrail-engine.js';

function makeCandidate(overrides: Partial<CandidateSet[0]> = {}): CandidateSet[0] {
  return {
    providerId: 'test-provider',
    providerName: 'test',
    modelId: 'test-model',
    modality: 'llm',
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
    capabilities: [],
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    qualityScore: 0.8,
    isHealthy: true,
    ...overrides,
  };
}

interface ExecCall {
  providerId: string;
  modelId: string;
  requestModel?: string;
}

function makeRouter(candidates: CandidateSet) {
  const router = new Router({ enableDecomposition: false });
  // Disable guardrails so test content isn't flagged
  router.setGuardrailEngine(new GuardrailEngine({ enableInput: false, enableOutput: false }));
  router.setCandidates(candidates);
  const calls: ExecCall[] = [];
  router.setAdapterExecutor({
    execute: async (providerId: string, modelId: string, request: UnifiedRequest): Promise<UnifiedResponse> => {
      calls.push({ providerId, modelId, requestModel: request.model });
      return {
        modality: 'llm',
        requestId: 'test',
        providerId,
        modelId,
        message: { role: 'assistant', content: 'ok' },
        latencyMs: 1,
      };
    },
  });
  return { router, calls };
}

function makeRequest(model: string): UnifiedRequest {
  return {
    modality: 'llm',
    model,
    // Unique content per test keeps the sticky-session hash distinct.
    messages: [{ role: 'user', content: `prompt-${model}-${Math.random()}` }] as any,
    stream: false,
    metadata: {},
  };
}

const ROUTE_OPTS = { path: '/v1/chat/completions', qualityTarget: 'balanced' as const };

describe('router provider-prefix routing', () => {
  it('routes "providerName/modelId" to the pinned provider, not the highest-scoring one', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.4 }),
      makeCandidate({ providerId: 'goog-uuid', providerName: 'google', modelId: 'gemini-3.5-flash', qualityScore: 0.99 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('pollinations/openai-fast'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('poll-uuid');
    expect(plan.primary.modelId).toBe('openai-fast');
    expect(calls).toHaveLength(1);
    // The executor must receive the bare resolved model, not the prefixed string.
    expect(calls[0].providerId).toBe('poll-uuid');
    expect(calls[0].modelId).toBe('openai-fast');
  });

  it('keeps slashes inside the model id after stripping a known provider prefix', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen/qwen3-coder', qualityScore: 0.5 }),
      makeCandidate({ providerId: 'goog-uuid', providerName: 'google', modelId: 'gemini-3.5-flash', qualityScore: 0.99 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('openrouter-free/qwen/qwen3-coder'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('or-uuid');
    expect(plan.primary.modelId).toBe('qwen/qwen3-coder');
    expect(calls[0].modelId).toBe('qwen/qwen3-coder');
  });

  it('treats an unknown prefix as part of the model id (e.g. OpenRouter vendor slug)', async () => {
    const candidates: CandidateSet = [
      // "qwen" is NOT a provider name here; the full "qwen/qwen3-coder" is the model id.
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter', modelId: 'qwen/qwen3-coder', qualityScore: 0.5 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('qwen/qwen3-coder'), ROUTE_OPTS);

    expect(plan.primary.providerId).toBe('or-uuid');
    expect(plan.primary.modelId).toBe('qwen/qwen3-coder');
    expect(calls[0].modelId).toBe('qwen/qwen3-coder');
  });

  it('passes the resolved real model (not the meta-model alias) to the executor', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.6 }),
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen3-coder', qualityScore: 0.9 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('auto-smart'), ROUTE_OPTS);

    // The specific free model is chosen by the scoring pipeline (epsilon-greedy
    // + Thompson sampling), so assert membership, not an exact pick.
    const realModels = ['openai-fast', 'qwen3-coder'];
    expect(realModels).toContain(plan.primary.modelId);
    expect(calls).toHaveLength(1);
    // The literal alias must NEVER reach the executor as a model id — this is
    // the core of Bug 2: meta-model resolution worked, but the executor used to
    // discard the resolved model and send the alias verbatim.
    expect(calls[0].modelId).not.toBe('auto-smart');
    expect(realModels).toContain(calls[0].modelId);
  });

  it('scopes a meta-model alias to the pinned provider when both are given', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'poll-uuid', providerName: 'pollinations', modelId: 'openai-fast', qualityScore: 0.6 }),
      makeCandidate({ providerId: 'or-uuid', providerName: 'openrouter-free', modelId: 'qwen3-coder', qualityScore: 0.9 }),
    ];
    const { router, calls } = makeRouter(candidates);

    const { plan } = await router.route(makeRequest('pollinations/auto-smart'), ROUTE_OPTS);

    // Even though openrouter-free scores higher, the pin constrains to pollinations.
    expect(plan.primary.providerId).toBe('poll-uuid');
    expect(plan.primary.modelId).toBe('openai-fast');
    expect(calls[0].providerId).toBe('poll-uuid');
    expect(calls[0].modelId).toBe('openai-fast');
  });
});

describe('sticky sessions vs. hard providerPreferences constraints', () => {
  // A sticky pin is chosen (and health-checked) under whatever preferences —
  // or lack of them — were in effect on an EARLIER turn of the conversation.
  // Reusing it on a later turn without re-checking a hard exclusion
  // constraint (zdr/only/ignore) could silently hand that turn to a provider
  // it was just told to exclude. See router.service.ts's
  // `hasHardProviderConstraint` guard around handleStickySession().
  // Sticky pins live in a shared, persistent cache keyed by
  // hashConversation(messages, model) — a real cross-process cache, not a
  // per-test fixture — so each test below must use its own unique prompt
  // text to avoid inheriting a pin set by a different test.
  function makeFixedRequest(
    prompt: string,
    providerPreferences?: { zdr?: boolean; ignore?: string[]; only?: string[]; order?: string[] },
  ): UnifiedRequest {
    return {
      modality: 'llm',
      model: 'general-chat',
      // Fixed content (not randomized) so both turns of one test hash to the same sticky key.
      messages: [{ role: 'user', content: prompt }] as any,
      stream: false,
      metadata: providerPreferences ? { providerPreferences } : {},
    };
  }

  // NOTE on determinism: the Router always constructs a live ThompsonSampler
  // (services/router/src/router.service.ts's constructor — unconditional,
  // no config knob disables it) and finalSelector consults it whenever a
  // qualityTarget is set, independent of `epsilon`. So which candidate wins
  // an *unconstrained* turn is not fully deterministic here, mirroring the
  // "assert membership, not an exact pick" caveat already documented on
  // the 'auto-smart' meta-model test above. These tests are written to hold
  // regardless of that: each hard-constrained assertion below names the one
  // candidate that satisfies the constraint (true no matter which candidate
  // "won" turn 1 or whether that pick coincidentally already satisfied it),
  // and the soft-preference test compares turn 2 against turn 1's actual
  // pick rather than a hardcoded id.

  it('does not reuse a sticky cloud pin once the conversation carries zdr', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'cloud-uuid', providerName: 'cloud-provider', modelId: 'cloud-model', qualityScore: 0.99, deployment: 'cloud' }),
      makeCandidate({ providerId: 'local-uuid', providerName: 'local-provider', modelId: 'local-model', qualityScore: 0.1, deployment: 'self_hosted' }),
    ];
    const { router, calls } = makeRouter(candidates);
    // Suffixed with a fresh run id: the sticky cache is a real, disk-backed
    // cache (createNamespacedCache('sticky') over the project SQLite file)
    // that outlives a single `vitest run` invocation, so a hardcoded prompt
    // would collide with a pin left over from the previous run of this suite.
    const prompt = `sticky-vs-zdr-fixed-prompt-${Date.now()}-${Math.random()}`;

    // Turn 1: unconstrained — sets a sticky pin to whichever candidate wins.
    await router.route(makeFixedRequest(prompt), ROUTE_OPTS);

    // Turn 2: same conversation, now with a hard privacy constraint. Must
    // land on the only zdr-eligible candidate, never the cloud one — even if
    // turn 1 happened to pin the cloud provider.
    const second = await router.route(makeFixedRequest(prompt, { zdr: true }), ROUTE_OPTS);
    expect(second.plan.primary.providerId).toBe('local-uuid');
    expect(calls[calls.length - 1].providerId).toBe('local-uuid');
  });

  it('does not reuse a sticky pin once the conversation ignores that provider', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'a-uuid', providerName: 'provider-a', modelId: 'model-a', qualityScore: 0.99 }),
      makeCandidate({ providerId: 'b-uuid', providerName: 'provider-b', modelId: 'model-b', qualityScore: 0.5 }),
    ];
    const { router, calls } = makeRouter(candidates);
    const prompt = `sticky-vs-ignore-fixed-prompt-${Date.now()}-${Math.random()}`;

    await router.route(makeFixedRequest(prompt), ROUTE_OPTS);

    const second = await router.route(makeFixedRequest(prompt, { ignore: ['provider-a'] }), ROUTE_OPTS);
    expect(second.plan.primary.providerId).toBe('b-uuid');
    expect(calls[calls.length - 1].providerId).toBe('b-uuid');
  });

  it('still uses the sticky pin for a soft preference (order) that does not exclude anything', async () => {
    const candidates: CandidateSet = [
      makeCandidate({ providerId: 'a-uuid', providerName: 'provider-a', modelId: 'model-a', qualityScore: 0.99 }),
      makeCandidate({ providerId: 'b-uuid', providerName: 'provider-b', modelId: 'model-b', qualityScore: 0.5 }),
    ];
    const { router, calls } = makeRouter(candidates);
    const prompt = `sticky-vs-soft-order-fixed-prompt-${Date.now()}-${Math.random()}`;

    const first = await router.route(makeFixedRequest(prompt), ROUTE_OPTS);
    const firstPick = first.plan.primary.providerId;

    // `order` alone (no zdr/only/ignore) is a soft preference — stickiness
    // still applies, which is the whole point of a sticky session. Compare
    // against turn 1's actual pick rather than a hardcoded id, since which
    // candidate wins an unconstrained turn is not itself deterministic here.
    const second = await router.route(makeFixedRequest(prompt, { order: ['provider-b'] }), ROUTE_OPTS);
    expect(second.plan.primary.providerId).toBe(firstPick);
    expect(calls[calls.length - 1].providerId).toBe(firstPick);
  });
});
