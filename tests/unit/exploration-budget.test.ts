import { describe, it, expect } from 'vitest';
import { ExplorationBudget } from '../../services/router/src/learning/exploration-budget.js';

describe('ExplorationBudget', () => {
  it('allows exploration within budget', () => {
    const budget = new ExplorationBudget({ maxExplorationRate: 0.1 });
    expect(budget.shouldExplore('p1', 'm1')).toBe(true);
  });

  it('stops exploration after budget exhausted', () => {
    const budget = new ExplorationBudget({ maxExplorationRate: 0.1, windowMs: 60000 });
    for (let i = 0; i < 100; i++) budget.recordExploration('p1', 'm1');
    expect(budget.getExplorationRate('p1', 'm1')).toBeGreaterThan(0.5);
  });
});