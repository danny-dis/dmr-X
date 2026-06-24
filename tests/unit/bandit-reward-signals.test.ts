import { describe, it, expect } from 'vitest';

import { calculateReward } from '../../services/router/src/bandit/thompson-sampler.js';

describe('calculateReward — 8C.1 / 8C.2 reward signals', () => {
  it('returns 0 when the request was not successful (regardless of signals)', () => {
    const reward = calculateReward(1, 100, 0, false, {
      firstTokenLatencyMs: 0, // fastest possible
      toolCallsAttempted: 5,
      toolCallsSucceeded: 5, // perfect tool rate
    });
    expect(reward).toBe(0);
  });

  it('rewards a fast TTFT more than a slow TTFT (8C.1)', () => {
    const fast = calculateReward(0.7, 2000, 0.001, true, { firstTokenLatencyMs: 100 });
    const slow = calculateReward(0.7, 2000, 0.001, true, { firstTokenLatencyMs: 4500 });
    const missing = calculateReward(0.7, 2000, 0.001, true); // no TTFT
    expect(fast).toBeGreaterThan(slow);
    // Without TTFT the signal is neutral (0.5), so it should be between slow and fast.
    expect(slow).toBeLessThan(missing);
    expect(missing).toBeLessThan(fast);
  });

  it('rewards higher tool-call success rates (8C.2)', () => {
    const perfect = calculateReward(0.7, 1500, 0.001, true, {
      toolCallsAttempted: 5,
      toolCallsSucceeded: 5,
    });
    const partial = calculateReward(0.7, 1500, 0.001, true, {
      toolCallsAttempted: 5,
      toolCallsSucceeded: 3,
    });
    const none = calculateReward(0.7, 1500, 0.001, true, {
      toolCallsAttempted: 5,
      toolCallsSucceeded: 0,
    });
    const noTools = calculateReward(0.7, 1500, 0.001, true); // no tool signal

    expect(perfect).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    // 'noTools' should be neutral (0.5), so it should sit between 'none' and 'perfect'
    expect(none).toBeLessThan(noTools);
    expect(noTools).toBeLessThan(perfect);
  });

  it('clamps TTFT to non-negative', () => {
    const negative = calculateReward(0.5, 1000, 0.001, true, { firstTokenLatencyMs: -100 });
    const zero = calculateReward(0.5, 1000, 0.001, true, { firstTokenLatencyMs: 0 });
    expect(negative).toBe(zero);
  });

  it('clamps the tool-call ratio to [0, 1]', () => {
    const over = calculateReward(0.5, 1000, 0.001, true, {
      toolCallsAttempted: 2,
      toolCallsSucceeded: 99, // invalid
    });
    const valid = calculateReward(0.5, 1000, 0.001, true, {
      toolCallsAttempted: 2,
      toolCallsSucceeded: 2,
    });
    expect(over).toBe(valid);
  });

  it('reward is always in [0, 1]', () => {
    const cases = [
      calculateReward(1, 0, 0, true, { firstTokenLatencyMs: 0, toolCallsAttempted: 1, toolCallsSucceeded: 1 }),
      calculateReward(0, 10_000, 1, true, { firstTokenLatencyMs: 5_000, toolCallsAttempted: 1, toolCallsSucceeded: 0 }),
      calculateReward(0.5, 5_000, 0.005, true),
    ];
    for (const r of cases) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
