import { describe, it, expect } from 'vitest';
import { ConcurrencyController } from '../../services/router/src/concurrency/concurrency-controller.js';

describe('ConcurrencyController', () => {
  it('tracks in-flight requests per provider', () => {
    const cc = new ConcurrencyController({ maxConcurrency: 10 });
    cc.acquire('google', 'gemini-1.5-flash');
    cc.acquire('google', 'gemini-1.5-flash');
    expect(cc.getInFlight('google', 'gemini-1.5-flash')).toBe(2);
    cc.release('google', 'gemini-1.5-flash');
    expect(cc.getInFlight('google', 'gemini-1.5-flash')).toBe(1);
  });

  it('blocks acquisition when at max concurrency', () => {
    const cc = new ConcurrencyController({ maxConcurrency: 2 });
    cc.acquire('google', 'gemini-1.5-flash');
    cc.acquire('google', 'gemini-1.5-flash');
    expect(cc.tryAcquire('google', 'gemini-1.5-flash')).toBe(false);
  });

  it('reduces concurrency after 429', () => {
    const cc = new ConcurrencyController({ maxConcurrency: 10 });
    cc.recordError('google', 'gemini-1.5-flash', { status: 429 });
    expect(cc.getEffectiveLimit('google', 'gemini-1.5-flash')).toBeLessThan(10);
  });

  it('increases concurrency after healthy window', () => {
    const cc = new ConcurrencyController({ maxConcurrency: 10 });
    cc.recordError('google', 'gemini-1.5-flash', { status: 429 });
    const reduced = cc.getEffectiveLimit('google', 'gemini-1.5-flash');
    cc.recordSuccess('google', 'gemini-1.5-flash');
    cc.recordSuccess('google', 'gemini-1.5-flash');
    cc.recordSuccess('google', 'gemini-1.5-flash');
    expect(cc.getEffectiveLimit('google', 'gemini-1.5-flash')).toBeGreaterThan(reduced);
  });
});