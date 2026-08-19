import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Regression guard for the session-sweep cleanup-clobber bug.
 *
 * `touchSession(id, cleanup)` registers the cleanup closure once, at session
 * creation. Every LATER request calls the bare `touchSession(id)` to refresh
 * the idle timer. The original implementation did:
 *
 *   sessionActivityMap.set(id, { lastActivity: new Date(), cleanup });
 *
 * so a bare touch wrote `cleanup: undefined` and ERASED the closure. The sweep
 * then deleted the activity-map entry but never ran cleanup — leaving the
 * McpServer alive in the transport's `sessions` map with `server.close()`
 * never called. Observed live: `/health` still reported 9 sessions after 220s
 * idle against a 60s timeout.
 *
 * These tests reimplement the exact touch/remove/sweep semantics from
 * services/mcp-server/src/index.ts. They are intentionally a behavioural
 * model rather than an import: those helpers are module-private and the
 * module has heavy side effects on import (telemetry, DB init, adapters).
 * The invariant under test is the one that regressed: a bare touch MUST
 * preserve a previously-registered cleanup.
 */

interface SessionEntry {
  lastActivity: Date;
  cleanup?: () => void;
}

function makeSessionTracker(timeoutMs: number) {
  const map = new Map<string, SessionEntry>();

  // The FIXED implementation (see index.ts touchSession).
  function touchSession(id: string, cleanup?: () => void): void {
    const existing = map.get(id);
    map.set(id, { lastActivity: new Date(), cleanup: cleanup ?? existing?.cleanup });
  }

  function removeSession(id: string): void {
    const entry = map.get(id);
    if (entry?.cleanup) entry.cleanup();
    map.delete(id);
  }

  function sweep(): string[] {
    const swept: string[] = [];
    const now = Date.now();
    for (const [id, entry] of map) {
      if (now - entry.lastActivity.getTime() > timeoutMs) {
        swept.push(id);
        removeSession(id);
      }
    }
    return swept;
  }

  return { map, touchSession, removeSession, sweep };
}

describe('MCP session sweep — cleanup preservation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a bare touch does NOT erase a registered cleanup', () => {
    const t = makeSessionTracker(60_000);
    const cleanup = vi.fn();

    t.touchSession('s1', cleanup);
    t.touchSession('s1'); // keep-alive from a later request — the bug
    t.touchSession('s1');

    expect(t.map.get('s1')?.cleanup).toBe(cleanup);
  });

  it('sweep RUNS the cleanup for an idle session touched repeatedly', () => {
    const t = makeSessionTracker(60_000);
    const cleanup = vi.fn();

    t.touchSession('s1', cleanup);
    vi.advanceTimersByTime(10_000);
    t.touchSession('s1'); // bare keep-alive
    vi.advanceTimersByTime(61_000); // now idle past the timeout

    const swept = t.sweep();

    expect(swept).toEqual(['s1']);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(t.map.has('s1')).toBe(false);
  });

  it('a bare touch still refreshes the idle timer', () => {
    const t = makeSessionTracker(60_000);
    const cleanup = vi.fn();

    t.touchSession('s1', cleanup);
    vi.advanceTimersByTime(50_000);
    t.touchSession('s1'); // refresh before the deadline
    vi.advanceTimersByTime(30_000); // 30s since refresh — still under 60s

    expect(t.sweep()).toEqual([]);
    expect(cleanup).not.toHaveBeenCalled();
    expect(t.map.has('s1')).toBe(true);
  });

  it('an explicitly passed cleanup replaces the previous one', () => {
    const t = makeSessionTracker(60_000);
    const first = vi.fn();
    const second = vi.fn();

    t.touchSession('s1', first);
    t.touchSession('s1', second);
    vi.advanceTimersByTime(61_000);
    t.sweep();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('sweeps only the sessions that are actually idle', () => {
    const t = makeSessionTracker(60_000);
    const oldCleanup = vi.fn();
    const freshCleanup = vi.fn();

    t.touchSession('old', oldCleanup);
    vi.advanceTimersByTime(61_000);
    t.touchSession('fresh', freshCleanup);

    expect(t.sweep()).toEqual(['old']);
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(freshCleanup).not.toHaveBeenCalled();
    expect(t.map.has('fresh')).toBe(true);
  });

  it('a session with no cleanup is still removed without throwing', () => {
    const t = makeSessionTracker(60_000);
    t.touchSession('bare');
    vi.advanceTimersByTime(61_000);

    expect(() => t.sweep()).not.toThrow();
    expect(t.map.has('bare')).toBe(false);
  });
});
