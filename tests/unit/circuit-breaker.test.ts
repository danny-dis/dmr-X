import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CircuitBreaker, CircuitBreakerManager } from '../../services/mcp-client/src/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Anchor the fake clock to a deterministic instant so timestamps are stable
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getStatus().state).toBe('closed');
    });

    it('check() returns null (allowed) initially', () => {
      const cb = new CircuitBreaker();
      expect(cb.check('srv')).toBeNull();
    });

    it('uses default config when no config is passed', () => {
      const cb = new CircuitBreaker();
      const status = cb.getStatus();
      expect(status.failureCount).toBe(0);
      expect(status.lastFailureTime).toBeNull();
      expect(status.nextAttemptTime).toBeNull();
    });

    it('accepts a custom failure threshold and recovery timeout', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 5_000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getStatus().state).toBe('open');
      // 5s recovery timeout
      vi.advanceTimersByTime(4_999);
      expect(cb.check('srv')).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(cb.check('srv')).toBeNull(); // half-open
    });
  });

  describe('opening after consecutive failures', () => {
    it('opens after exactly N failures (threshold = 3)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1_000 });
      expect(cb.check('srv')).toBeNull();
      cb.recordFailure();
      expect(cb.getStatus().state).toBe('closed');
      cb.recordFailure();
      expect(cb.getStatus().state).toBe('closed');
      cb.recordFailure();
      expect(cb.getStatus().state).toBe('open');
    });

    it('records lastFailureTime on each failure', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure();
      const t1 = cb.getStatus().lastFailureTime;
      expect(t1).not.toBeNull();
      vi.advanceTimersByTime(500);
      cb.recordFailure();
      const t2 = cb.getStatus().lastFailureTime;
      expect(t2).toBeGreaterThan(t1!);
    });
  });

  describe('open state', () => {
    let cb: CircuitBreaker;
    beforeEach(() => {
      cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1_000 });
      cb.recordFailure(); // opens immediately
    });

    it('check() returns an error message with retry-after seconds', () => {
      const msg = cb.check('srv');
      expect(msg).not.toBeNull();
      expect(msg).toContain('OPEN');
      expect(msg).toContain('srv');
      expect(msg).toMatch(/retry after \d+s/);
    });

    it('does not transition until recovery timeout elapses', () => {
      vi.advanceTimersByTime(999);
      expect(cb.getStatus().state).toBe('open');
      expect(cb.check('srv')).not.toBeNull();
    });

    it('transitions to half-open on the next check after recovery timeout', () => {
      vi.advanceTimersByTime(1_000);
      // The first check after recovery transitions to half-open and allows the call
      expect(cb.check('srv')).toBeNull();
      expect(cb.getStatus().state).toBe('half-open');
    });
  });

  describe('half-open state', () => {
    it('a success in half-open transitions to closed', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1_000 });
      cb.recordFailure();
      vi.advanceTimersByTime(1_000);
      cb.check('srv'); // → half-open
      expect(cb.getStatus().state).toBe('half-open');
      cb.recordSuccess();
      expect(cb.getStatus().state).toBe('closed');
      expect(cb.getStatus().failureCount).toBe(0);
      expect(cb.getStatus().nextAttemptTime).toBeNull();
    });

    it('a failure in half-open reopens the circuit with a fresh timeout', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1_000 });
      cb.recordFailure();
      vi.advanceTimersByTime(1_000);
      cb.check('srv'); // → half-open
      cb.recordFailure();
      const status = cb.getStatus();
      expect(status.state).toBe('open');
      // New nextAttemptTime is in the future
      expect(status.nextAttemptTime).toBeGreaterThan(Date.now());
    });
  });

  describe('recordSuccess()', () => {
    it('resets the failure count in closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.getStatus().failureCount).toBe(0);
    });

    it('updates lastSuccessTime', () => {
      const cb = new CircuitBreaker();
      cb.recordSuccess();
      expect(cb.getStatus().lastSuccessTime).toBe(Date.now());
    });
  });

  describe('reset()', () => {
    it('forces the circuit back to closed', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 60_000 });
      cb.recordFailure();
      expect(cb.getStatus().state).toBe('open');
      cb.reset();
      const status = cb.getStatus();
      expect(status.state).toBe('closed');
      expect(status.failureCount).toBe(0);
      expect(status.lastFailureTime).toBeNull();
      expect(status.nextAttemptTime).toBeNull();
    });
  });
});

describe('CircuitBreakerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same instance for the same id', () => {
    const mgr = new CircuitBreakerManager();
    const a1 = mgr.getOrCreate('srv-a');
    const a2 = mgr.getOrCreate('srv-a');
    expect(a1).toBe(a2);
  });

  it('returns different instances for different ids', () => {
    const mgr = new CircuitBreakerManager();
    const a = mgr.getOrCreate('srv-a');
    const b = mgr.getOrCreate('srv-b');
    expect(a).not.toBe(b);
  });

  it('passes config to newly created breakers', () => {
    const mgr = new CircuitBreakerManager();
    const cb = mgr.getOrCreate('srv-a', { failureThreshold: 1, recoveryTimeoutMs: 500 });
    cb.recordFailure();
    expect(cb.getStatus().state).toBe('open');
  });

  it('reset(id) only resets the specified breaker', () => {
    const mgr = new CircuitBreakerManager();
    const a = mgr.getOrCreate('srv-a', { failureThreshold: 1 });
    const b = mgr.getOrCreate('srv-b', { failureThreshold: 1 });
    a.recordFailure();
    b.recordFailure();
    expect(a.getStatus().state).toBe('open');
    expect(b.getStatus().state).toBe('open');

    mgr.reset('srv-a');
    expect(a.getStatus().state).toBe('closed');
    expect(b.getStatus().state).toBe('open');
  });

  it('resetAll() resets every breaker', () => {
    const mgr = new CircuitBreakerManager();
    const a = mgr.getOrCreate('srv-a', { failureThreshold: 1 });
    const b = mgr.getOrCreate('srv-b', { failureThreshold: 1 });
    a.recordFailure();
    b.recordFailure();
    mgr.resetAll();
    expect(a.getStatus().state).toBe('closed');
    expect(b.getStatus().state).toBe('closed');
  });

  it('reset() on an unknown id is a no-op', () => {
    const mgr = new CircuitBreakerManager();
    expect(() => mgr.reset('does-not-exist')).not.toThrow();
  });

  it('getStatus() returns a map of id → status', () => {
    const mgr = new CircuitBreakerManager();
    const a = mgr.getOrCreate('srv-a');
    a.recordFailure();
    const b = mgr.getOrCreate('srv-b');
    const status = mgr.getStatus();
    expect(Object.keys(status).sort()).toEqual(['srv-a', 'srv-b']);
    expect(status['srv-a'].state).toBe('closed');
    expect(status['srv-a'].failureCount).toBe(1);
    expect(status['srv-b'].state).toBe('closed');
    expect(status['srv-b'].failureCount).toBe(0);
  });

  it('getStatus() returns an empty object when no breakers exist', () => {
    const mgr = new CircuitBreakerManager();
    expect(mgr.getStatus()).toEqual({});
  });
});
