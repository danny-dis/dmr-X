import { describe, it, expect } from 'vitest';

import {
  DEFAULT_REQUIREMENT_VECTOR,
  isValidRequirementVector,
  describeRequirementVector,
} from '@dmr-x/core';
import {
  ModelCapabilityProfile,
  supportsDimension,
  satisfiesRequirement,
} from '@dmr-x/core';
import { decisionTrace, DecisionTraceEntry } from '@dmr-x/router';
import {
  ReliabilityDistribution,
  ReliabilityRegistry,
} from '@dmr-x/router';
import { detectPii, applyPrivacyRules } from '@dmr-x/router';
import {
  InMemoryBudgetStore,
  reserveAndDispatch,
} from '@dmr-x/billing';
import { selectByEconomics, EconomicsResult } from '@dmr-x/router';
import {
  AgentLifecycleManager,
  canTransition,
} from '@dmr-x/agent-runtime';

describe('Requirement Vector', () => {
  it('validates correctly', () => {
    const v = {
      axes: ['llm', 'vision'],
      budgetPolicy: 'free_only' as const,
      maxCostPer1k: 5,
    };
    expect(isValidRequirementVector(v)).toBe(true);
    expect(isValidRequirementVector({ axes: [], budgetPolicy: 'free_only' as const })).toBe(false);
    expect(isValidRequirementVector({ axes: ['llm'], budgetPolicy: 'free_only' as const, maxCostPer1k: -1 })).toBe(false);
  });

  it('describes correctly', () => {
    const v = {
      axes: ['llm'],
      budgetPolicy: 'free_only' as const,
      latencyBudget: 'interactive' as const,
    };
    expect(describeRequirementVector(v)).toContain('axes=[llm]');
    expect(describeRequirementVector(v)).toContain('budget=free_only');
  });
});

describe('Capability Ontology', () => {
  const profile: ModelCapabilityProfile = {
    modelId: 'test',
    providerId: 'p',
    dimensions: {
      reasoning: 4 as const,
      coding: 3 as const,
      tool_use: 2 as const,
    },
    contextWindow: 128000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
  };

  it('checks dimensions', () => {
    expect(supportsDimension(profile, 'reasoning', 3)).toBe(true);
    expect(supportsDimension(profile, 'coding', 4)).toBe(false);
    expect(supportsDimension(profile, 'video')).toBe(false);
  });

  it('checks requirements', () => {
    expect(satisfiesRequirement(profile, { reasoning: 3, coding: 3 })).toBe(true);
    expect(satisfiesRequirement(profile, { reasoning: 4, video: 1 })).toBe(false);
  });
});

describe('Decision Trace', () => {
  it('records and retrieves traces', () => {
    decisionTrace.clear();
    const entry: DecisionTraceEntry = {
      timestamp: Date.now(),
      requestId: 'req-1',
      tenantId: 't1',
      requirementSummary: 'free_only llm',
      candidatesConsidered: ['p:m1', 'p:m2'],
      selectedCandidate: 'p:m1',
      rejections: [{ candidate: 'p:m2', reason: 'exceeds budget' }],
      objective: 'free_only',
      routingDecisionReason: 'first free match',
      executionTimeMs: 5,
    };
    decisionTrace.record(entry);
    expect(decisionTrace.count()).toBe(1);
    expect(decisionTrace.getDecisionReason('req-1')).toBe('first free match');
    expect(decisionTrace.getRequestDecisions('req-1')).toEqual(entry);
  });

  it('filters by tenant and limit', () => {
    decisionTrace.clear();
    for (let i = 0; i < 5; i++) {
      decisionTrace.record({
        timestamp: Date.now() + i,
        requestId: `req-${i}`,
        tenantId: `t${i % 2}`,
        requirementSummary: '',
        candidatesConsidered: [],
        rejections: [],
        objective: '',
        routingDecisionReason: '',
        executionTimeMs: 0,
      });
    }
    expect(decisionTrace.getTraces({ tenantId: 't0' }).length).toBe(3);
    expect(decisionTrace.getTraces({ limit: 2 }).length).toBe(2);
  });
});

describe('Reliability Distributions', () => {
  it('calculates success rate with Wilson score', () => {
    const dist = new ReliabilityDistribution();
    for (let i = 0; i < 95; i++) {
      dist.observe({ providerId: 'p', modelId: 'm', success: true, timestamp: Date.now() });
    }
    for (let i = 0; i < 5; i++) {
      dist.observe({ providerId: 'p', modelId: 'm', success: false, timestamp: Date.now() });
    }
    expect(dist.successRate).toBeCloseTo(0.95, 2);
    expect(dist.successRateLowerBound).toBeGreaterThan(0);
    expect(dist.successRateLowerBound).toBeLessThan(1);
    expect(dist.hasSufficientData).toBe(true);
  });

  it('ranks candidates by reliability', () => {
    const registry = new ReliabilityRegistry();
    for (let i = 0; i < 100; i++) {
      registry.record({ providerId: 'p1', modelId: 'm', success: true, timestamp: Date.now() });
      registry.record({ providerId: 'p2', modelId: 'm', success: false, timestamp: Date.now() });
    }
    const ranked = registry.rankByReliability([
      { providerId: 'p1', modelId: 'm' },
      { providerId: 'p2', modelId: 'm' },
    ]);
    expect(ranked[0].providerId).toBe('p1');
    expect(ranked[0].lowerBound).toBeGreaterThan(ranked[1].lowerBound);
  });

  it('detects stale distributions', () => {
    const dist = new ReliabilityDistribution();
    dist.observe({ providerId: 'p', modelId: 'm', success: true, timestamp: Date.now() - 60 * 60 * 1000 });
    expect(dist.isStale).toBe(true);
  });
});

describe('PII Routing', () => {
  it('detects PII', () => {
    expect(detectPii('no pii here')).toMatchObject({ hasPii: false });
    expect(detectPii('test@example.com')).toMatchObject({ hasPii: true, categories: ['email'] });
    expect(detectPii('call me at 555-555-5555')).toMatchObject({ hasPii: true, categories: ['phone'] });
  });

  it('applies fail-closed privacy rules', () => {
    const candidates = [
      { providerId: 'p1', modelId: 'm' },
      { providerId: 'p2', modelId: 'm' },
    ];
    const pii = detectPii('user@example.com');
    const rules = [{
      categories: ['email'],
      threshold: 'low' as const,
      allowedProviders: ['p1'],
      action: 'restrict_to_allowlist' as const,
    }];

    expect(applyPrivacyRules(candidates, pii, rules, false)).toHaveLength(1);
    expect(applyPrivacyRules(candidates, pii, [{ ...rules[0], action: 'block' }], true)).toHaveLength(0);
    expect(applyPrivacyRules(candidates, detectPii('no pii'), rules)).toHaveLength(2);
  });
});

describe('Budget Reservation', () => {
  it('reserves, commits, and reconciles', async () => {
    const store = new InMemoryBudgetStore({ 't1': 100 });
    const res = await store.create('t1', 30, 60_000);
    expect(res.success).toBe(true);
    expect(store.getBalance('t1')).toBe(70);

    const committed = await store.commit(res!.reservation!.id, 20);
    expect(committed!.adjusted).toBe(10);
    expect(store.getBalance('t1')).toBe(80);
  });

  it('releases on failure', async () => {
    const store = new InMemoryBudgetStore({ 't1': 100 });
    const res = await store.create('t1', 30, 60_000);
    await store.release(res!.reservation!.id);
    expect(store.getBalance('t1')).toBe(100);
  });

  it('reserveAndDispatch reconciles correctly', async () => {
    const store = new InMemoryBudgetStore({ 't1': 100 });
    const result = await reserveAndDispatch(
      store, 't1', 30, 60_000,
      async () => 'dispatch-result',
      () => 22,
    );
    expect(result.result).toBe('dispatch-result');
    expect(result.overageCents).toBe(0);
    expect(store.getBalance('t1')).toBe(78);
  });
});

describe('Economic Objectives', () => {
  const candidates = [
    { providerId: 'p1', modelId: 'free', costPer1kInputTokens: 0, costPer1kOutputTokens: 0, isFree: true, qualityScore: 0.7 },
    { providerId: 'p2', modelId: 'paid', costPer1kInputTokens: 2, costPer1kOutputTokens: 3, isFree: false, qualityScore: 0.9 },
    { providerId: 'p3', modelId: 'cheap', costPer1kInputTokens: 0.5, costPer1kOutputTokens: 0.5, isFree: false, qualityScore: 0.5 },
  ];

  it('free_only selects only free', () => {
    const result = selectByEconomics(candidates, 'free_only');
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].isFree).toBe(true);
    expect(result.rejected).toHaveLength(2);
  });

  it('cheapest_acceptable sorts by cost', () => {
    const result = selectByEconomics(candidates, 'cheapest_acceptable', 1);
    expect(result.selected).toHaveLength(2); // p1 (free) + p3 (0.5) qualify; p2 (2.5) rejected
    expect(result.selected[0].providerId).toBe('p1'); // free wins
    expect(result.rejected).toHaveLength(1);
  });

  it('quality_per_dollar maximizes ratio', () => {
    const result = selectByEconomics(candidates, 'quality_per_dollar', 10);
    expect(result.selected[0].providerId).toBe('p1'); // free with 0.7 quality wins
  });

  it('unconstrained returns all', () => {
    const result = selectByEconomics(candidates, 'unconstrained');
    expect(result.selected).toHaveLength(3);
  });
});

describe('Agent Lifecycle', () => {
  it('spawns and transitions through valid states', () => {
    const mgr = new AgentLifecycleManager();
    mgr.spawn('s1');
    expect(mgr.get('s1')!.state).toBe('spawned');
    expect(mgr.transition('s1', 'active')).toBe(true);
    expect(mgr.get('s1')!.state).toBe('active');
    expect(mgr.transition('s1', 'idle')).toBe(true);
    expect(mgr.transition('s1', 'active')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const mgr = new AgentLifecycleManager();
    mgr.spawn('s1');
    expect(mgr.transition('s1', 'idle')).toBe(false);
    expect(canTransition('spawned', 'idle')).toBe(false);
  });

  it('terminates cleanly', () => {
    const mgr = new AgentLifecycleManager();
    mgr.spawn('s1');
    mgr.transition('s1', 'active');
    expect(mgr.terminate('s1')).toBe(true);
    expect(mgr.get('s1')!.state).toBe('terminated');
    expect(mgr.getActiveCount()).toBe(0);
  });

  it('auto-terminates on budget exhaustion', () => {
    const mgr = new AgentLifecycleManager();
    mgr.spawn('s1', { maxBudgetCents: 50 });
    mgr.transition('s1', 'active');
    mgr.recordActivity('s1', 60);
    expect(mgr.get('s1')!.state).toBe('terminating');
  });

  it('creates checkpoint on idle', () => {
    const mgr = new AgentLifecycleManager();
    mgr.spawn('s1', { checkpointOnIdle: true });
    mgr.transition('s1', 'active');
    mgr.transition('s1', 'idle');
    expect(mgr.get('s1')!.checkpoint).toBeDefined();
  });
});
