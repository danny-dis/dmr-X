import { describe, it, expect } from 'vitest';
import {
  stepCountIs,
  hasToolCall,
  isStopConditionMet,
  maxTokensUsed,
  maxCost,
  finishReasonIs,
} from '../../packages/utils/src/stop-conditions.js';

describe('stop-conditions', () => {
  describe('stepCountIs', () => {
    it('should return false when steps < count', () => {
      const condition = stepCountIs(5);
      expect(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }] })).toBe(false);
    });

    it('should return true when steps >= count', () => {
      const condition = stepCountIs(3);
      expect(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }] })).toBe(true);
    });

    it('should return true when steps exceed count', () => {
      const condition = stepCountIs(2);
      expect(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }] })).toBe(true);
    });

    it('should return false for zero steps', () => {
      const condition = stepCountIs(1);
      expect(condition({ steps: [] })).toBe(false);
    });
  });

  describe('hasToolCall', () => {
    it('should return true when tool was called', () => {
      const condition = hasToolCall('search');
      expect(condition({
        steps: [
          { toolCalls: [{ name: 'search' }] },
        ],
      })).toBe(true);
    });

    it('should return false when tool was not called', () => {
      const condition = hasToolCall('search');
      expect(condition({
        steps: [
          { toolCalls: [{ name: 'lookup' }] },
        ],
      })).toBe(false);
    });

    it('should return false for empty steps', () => {
      const condition = hasToolCall('search');
      expect(condition({ steps: [] })).toBe(false);
    });

    it('should find tool call in later steps', () => {
      const condition = hasToolCall('deploy');
      expect(condition({
        steps: [
          { toolCalls: [{ name: 'search' }] },
          { toolCalls: [{ name: 'analyze' }] },
          { toolCalls: [{ name: 'deploy' }] },
        ],
      })).toBe(true);
    });
  });

  describe('maxTokensUsed', () => {
    it('should return false when under limit', () => {
      const condition = maxTokensUsed(1000);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { totalTokens: 500 } },
        ],
      })).toBe(false);
    });

    it('should return true when at limit', () => {
      const condition = maxTokensUsed(1000);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { totalTokens: 1000 } },
        ],
      })).toBe(true);
    });

    it('should accumulate tokens across steps', () => {
      const condition = maxTokensUsed(1000);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { totalTokens: 400 } },
          { toolCalls: [], usage: { totalTokens: 400 } },
          { toolCalls: [], usage: { totalTokens: 300 } },
        ],
      })).toBe(true);
    });

    it('should handle missing usage gracefully', () => {
      const condition = maxTokensUsed(1000);
      expect(condition({
        steps: [
          { toolCalls: [] },
          { toolCalls: [], usage: { totalTokens: 500 } },
        ],
      })).toBe(false);
    });
  });

  describe('maxCost', () => {
    it('should return false when under cost limit', () => {
      const condition = maxCost(1.00);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { cost: 0.50 } },
        ],
      })).toBe(false);
    });

    it('should return true when at cost limit', () => {
      const condition = maxCost(1.00);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { cost: 1.00 } },
        ],
      })).toBe(true);
    });

    it('should accumulate cost across steps', () => {
      const condition = maxCost(1.00);
      expect(condition({
        steps: [
          { toolCalls: [], usage: { cost: 0.30 } },
          { toolCalls: [], usage: { cost: 0.30 } },
          { toolCalls: [], usage: { cost: 0.50 } },
        ],
      })).toBe(true);
    });

    it('should handle missing cost gracefully', () => {
      const condition = maxCost(1.00);
      expect(condition({
        steps: [
          { toolCalls: [] },
          { toolCalls: [], usage: { cost: 0.50 } },
        ],
      })).toBe(false);
    });
  });

  describe('finishReasonIs', () => {
    it('should return true when finish reason matches', () => {
      const condition = finishReasonIs('length');
      expect(condition({
        steps: [
          { toolCalls: [], finishReason: 'length' },
        ],
      })).toBe(true);
    });

    it('should return false when finish reason does not match', () => {
      const condition = finishReasonIs('length');
      expect(condition({
        steps: [
          { toolCalls: [], finishReason: 'stop' },
        ],
      })).toBe(false);
    });

    it('should return false when no steps have finish reason', () => {
      const condition = finishReasonIs('length');
      expect(condition({
        steps: [
          { toolCalls: [] },
        ],
      })).toBe(false);
    });
  });

  describe('isStopConditionMet', () => {
    it('should return true if ANY condition is met (OR logic)', async () => {
      const result = await isStopConditionMet({
        stopConditions: [stepCountIs(10), hasToolCall('stop')],
        steps: [
          { toolCalls: [{ name: 'stop' }] },
        ],
      });
      expect(result).toBe(true);
    });

    it('should return false if NO conditions are met', async () => {
      const result = await isStopConditionMet({
        stopConditions: [stepCountIs(10), hasToolCall('stop')],
        steps: [
          { toolCalls: [{ name: 'search' }] },
        ],
      });
      expect(result).toBe(false);
    });

    it('should return false for empty conditions array', async () => {
      const result = await isStopConditionMet({
        stopConditions: [],
        steps: [{ toolCalls: [] }],
      });
      expect(result).toBe(false);
    });

    it('should support async conditions', async () => {
      const asyncCondition = async () => true;
      const result = await isStopConditionMet({
        stopConditions: [asyncCondition],
        steps: [],
      });
      expect(result).toBe(true);
    });

    it('should work with multiple conditions all false', async () => {
      const result = await isStopConditionMet({
        stopConditions: [stepCountIs(100), maxTokensUsed(999999), maxCost(9999)],
        steps: [
          { toolCalls: [], usage: { totalTokens: 10, cost: 0.01 } },
        ],
      });
      expect(result).toBe(false);
    });
  });
});
