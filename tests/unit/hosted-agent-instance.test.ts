import { describe, expect, it } from 'vitest';

import {
  AgentAccessScopeSchema,
  AgentInstanceCreateSchema,
  AgentInstanceRuntimeUpdateSchema,
  AgentRuntimeModeSchema,
  AgentLifecycleStateSchema,
} from '@dmr-x/agent-registry';
import {
  canTransitionInstanceLifecycle,
  DEFAULT_EPHEMERAL_LIFECYCLE_POLICY,
  DEFAULT_PERSISTENT_LIFECYCLE_POLICY,
} from '@dmr-x/agent-registry';

describe('Hosted agent instances', () => {
  const definitionId = '11111111-1111-4111-8111-111111111111';

  it('defaults new deployments to a durable shared identity', () => {
    const value = AgentInstanceCreateSchema.parse({ agentDefinitionId: definitionId });

    expect(value.runtimeMode).toBe('persistent');
    expect(value.accessScope).toBe('shared');
    expect(value.lifecyclePolicy).toEqual({});
  });

  it('accepts private and ephemeral runtime policies', () => {
    const value = AgentInstanceCreateSchema.parse({
      agentDefinitionId: definitionId,
      runtimeMode: 'ephemeral',
      accessScope: 'private',
      lifecyclePolicy: {
        maxTtlMs: 60_000,
        idleTimeoutMs: 15_000,
        maxBudgetCents: 25,
      },
    });

    expect(value.runtimeMode).toBe('ephemeral');
    expect(value.accessScope).toBe('private');
    expect(value.lifecyclePolicy.maxTtlMs).toBe(60_000);
  });

  it('validates the runtime update surface separately from instance creation', () => {
    expect(
      AgentInstanceRuntimeUpdateSchema.parse({
        accessScope: 'private',
        runtimeMode: 'persistent',
      }),
    ).toEqual({
      accessScope: 'private',
      runtimeMode: 'persistent',
    });

    expect(AgentRuntimeModeSchema.safeParse('resident').success).toBe(false);
    expect(AgentAccessScopeSchema.safeParse('team').success).toBe(false);
    expect(AgentLifecycleStateSchema.safeParse('ready').success).toBe(true);
  });

  it('keeps persistent identities unbounded by default', () => {
    expect(DEFAULT_PERSISTENT_LIFECYCLE_POLICY).toEqual({
      maxTtlMs: null,
      idleTimeoutMs: null,
      maxBudgetCents: null,
    });
    expect(DEFAULT_EPHEMERAL_LIFECYCLE_POLICY.maxTtlMs).toBe(30 * 60 * 1000);
  });

  it('allows the intended parked/wake transitions and rejects resurrection from retired', () => {
    expect(canTransitionInstanceLifecycle('ready', 'running')).toBe(true);
    expect(canTransitionInstanceLifecycle('running', 'ready')).toBe(true);
    expect(canTransitionInstanceLifecycle('ready', 'paused')).toBe(true);
    expect(canTransitionInstanceLifecycle('paused', 'ready')).toBe(true);
    expect(canTransitionInstanceLifecycle('retired', 'ready')).toBe(false);
  });
});
