import { describe, it, expect } from 'vitest';
import { RetryBudget } from '../../services/router/src/resilience/retry-budget.js';

describe('RetryBudget', () => {
  it('allows retries within budget', () => {
    const budget = new RetryBudget({ maxRetries: 3, windowMs: 60000 });
    expect(budget.canRetry('req1')).toBe(true);
    budget.recordRetry('req1');
    budget.recordRetry('req1');
    expect(budget.canRetry('req1')).toBe(true);
    budget.recordRetry('req1');
    expect(budget.canRetry('req1')).toBe(false);
  });

  it('resets budget after window', () => {
    const budget = new RetryBudget({ maxRetries: 1, windowMs: 100 });
    budget.recordRetry('req1');
    expect(budget.canRetry('req1')).toBe(false);
    return new Promise(resolve => {
      setTimeout(() => {
        expect(budget.canRetry('req1')).toBe(true);
        resolve(undefined);
      }, 150);
    });
  });
});