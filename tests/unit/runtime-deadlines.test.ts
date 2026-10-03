import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentLifecycleManager } from '../../services/agent-runtime/src/lifecycle.js';

describe('AgentLifecycleManager absolute deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires at createdAt + TTL even when activity occurs near the deadline', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('absolute-ttl', { maxTtlMs: 1_000 });
    expect(manager.transition('absolute-ttl', 'active')).toBe(true);

    await vi.advanceTimersByTimeAsync(900);
    manager.recordActivity('absolute-ttl');
    await vi.advanceTimersByTimeAsync(100);

    expect(manager.get('absolute-ttl')?.state).toBe('terminating');
    expect(manager.isExpired('absolute-ttl')).toBe(true);
  });

  it('schedules the idle deadline and chooses it before the absolute TTL', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('idle-first', { maxTtlMs: 1_000, idleTimeoutMs: 100 });
    manager.transition('idle-first', 'active');
    await vi.advanceTimersByTimeAsync(100);

    manager.transition('idle-first', 'idle');
    await vi.advanceTimersByTimeAsync(99);
    expect(manager.get('idle-first')?.state).toBe('idle');

    await vi.advanceTimersByTimeAsync(1);
    expect(manager.get('idle-first')?.state).toBe('terminating');
  });

  it('uses the TTL when it is earlier than the idle deadline', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('ttl-first', { maxTtlMs: 1_000, idleTimeoutMs: 500 });
    manager.transition('ttl-first', 'active');
    await vi.advanceTimersByTimeAsync(900);

    manager.transition('ttl-first', 'idle');
    await vi.advanceTimersByTimeAsync(100);

    expect(manager.get('ttl-first')?.state).toBe('terminating');
  });

  it('treats exact deadline boundaries as expired', () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('boundary', { maxTtlMs: 1_000 });

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));

    expect(manager.isExpired('boundary')).toBe(true);
  });

  it('leaves budget exhaustion in terminating until termination is explicitly completed', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('budget', { maxBudgetCents: 10, maxTtlMs: 1_000 });
    manager.transition('budget', 'active');

    manager.recordActivity('budget', 10);
    expect(manager.get('budget')?.state).toBe('terminating');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.get('budget')?.state).toBe('terminating');

    const explicit = new AgentLifecycleManager();
    explicit.spawn('explicit');
    explicit.transition('explicit', 'active');
    expect(explicit.terminate('explicit')).toBe(true);
    expect(explicit.get('explicit')?.state).toBe('terminated');
  });

  it('does not recreate timers or mutate activity after a terminal state', () => {
    const manager = new AgentLifecycleManager();
    const lifecycle = manager.spawn('terminal', { maxTtlMs: 100 });
    expect(manager.transition('terminal', 'failed')).toBe(true);
    const terminalActivityAt = lifecycle.lastActivityAt;
    expect(vi.getTimerCount()).toBe(0);

    manager.recordActivity('terminal', 5);

    expect(lifecycle.state).toBe('failed');
    expect(lifecycle.lastActivityAt).toBe(terminalActivityAt);
    expect(lifecycle.budgetConsumedCents).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces a duplicate spawn without letting the old deadline terminate the replacement', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('duplicate', { maxTtlMs: 100 });
    await vi.advanceTimersByTimeAsync(50);

    const replacement = manager.spawn('duplicate', { maxTtlMs: 200 });
    await vi.advanceTimersByTimeAsync(50);
    expect(manager.get('duplicate')).toBe(replacement);
    expect(replacement.state).toBe('spawned');

    await vi.advanceTimersByTimeAsync(150);
    expect(replacement.state).toBe('terminating');
    expect(vi.getTimerCount()).toBe(0);
  });
});
