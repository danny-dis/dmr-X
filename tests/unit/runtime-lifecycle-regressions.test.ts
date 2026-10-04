import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentLifecycleManager } from '../../services/agent-runtime/src/lifecycle.js';

// Focused terminal/concurrent regressions for the runtime lane:
// - explicit terminate() completes a budget-exhausted (terminating) session
// - concurrent sessions keep independent absolute deadlines
// - recordActivity/duplicate-spawn cannot resurrect terminal state
describe('AgentLifecycleManager terminal/concurrent regressions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes explicit termination from budget-induced terminating', () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('budget-term', { maxBudgetCents: 10, maxTtlMs: 10_000 });
    manager.transition('budget-term', 'active');
    manager.recordActivity('budget-term', 10);
    expect(manager.get('budget-term')?.state).toBe('terminating');

    expect(manager.terminate('budget-term')).toBe(true);
    expect(manager.get('budget-term')?.state).toBe('terminated');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps concurrent sessions on independent absolute deadlines', async () => {
    const manager = new AgentLifecycleManager();
    manager.spawn('short', { maxTtlMs: 100 });
    manager.spawn('long', { maxTtlMs: 500 });
    manager.transition('short', 'active');
    manager.transition('long', 'active');

    await vi.advanceTimersByTimeAsync(100);
    expect(manager.get('short')?.state).toBe('terminating');
    expect(manager.get('long')?.state).toBe('active');

    await vi.advanceTimersByTimeAsync(400);
    expect(manager.get('long')?.state).toBe('terminating');
  });

  it('ignores activity and respawn-timer reuse after terminated', async () => {
    const manager = new AgentLifecycleManager();
    const first = manager.spawn('once', { maxTtlMs: 1_000 });
    manager.transition('once', 'active');
    expect(manager.terminate('once')).toBe(true);
    const activityAt = first.lastActivityAt;

    manager.recordActivity('once', 5);
    expect(first.state).toBe('terminated');
    expect(first.lastActivityAt).toBe(activityAt);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(manager.get('once')?.state).toBe('terminated');
  });
});
