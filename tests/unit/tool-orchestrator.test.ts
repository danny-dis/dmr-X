import { describe, it, expect, vi } from 'vitest';

import {
  toolResultsToMap,
  summarizeToolExecutions,
  hasToolExecutionErrors,
  getToolExecutionErrors,
} from '../../packages/utils/src/tool-orchestrator.js';

// Mock heavy dependencies
vi.mock('../../packages/utils/src/stream-transformers.js', () => ({
  extractToolCallsFromResponse: vi.fn(() => []),
  responseHasToolCalls: vi.fn(() => false),
}));

vi.mock('../../packages/utils/src/stream-type-guards.js', () => ({
  isFunctionCallItem: vi.fn(() => false),
}));

vi.mock('../../packages/utils/src/tool-executor.js', () => ({
  executeTool: vi.fn(),
  findToolByName: vi.fn(),
}));

vi.mock('../../packages/utils/src/tool-types.js', () => ({
  hasExecuteFunction: vi.fn(() => false),
}));

vi.mock('../../packages/utils/src/turn-context.js', () => ({
  buildTurnContext: vi.fn(() => ({})),
}));

vi.mock('../../packages/utils/src/next-turn-params.js', () => ({
  executeNextTurnParamsFunctions: vi.fn(async () => ({})),
  applyNextTurnParamsToRequest: vi.fn((req) => req),
}));

describe('tool-orchestrator', () => {
  describe('toolResultsToMap', () => {
    it('should convert results array to map keyed by toolCallId', () => {
      const results = [
        { toolCallId: 'call_1', toolName: 'search', result: { data: 'test' } },
        { toolCallId: 'call_2', toolName: 'lookup', result: { id: 123 } },
      ];

      const map = toolResultsToMap(results as any);
      expect(map.size).toBe(2);
      expect(map.get('call_1')).toEqual({ result: { data: 'test' }, preliminaryResults: undefined });
      expect(map.get('call_2')).toEqual({ result: { id: 123 }, preliminaryResults: undefined });
    });

    it('should include preliminary results', () => {
      const results = [
        {
          toolCallId: 'call_1',
          toolName: 'gen',
          result: 'final',
          preliminaryResults: ['interim1', 'interim2'],
        },
      ];

      const map = toolResultsToMap(results as any);
      expect(map.get('call_1')?.preliminaryResults).toEqual(['interim1', 'interim2']);
    });

    it('should handle empty results', () => {
      const map = toolResultsToMap([]);
      expect(map.size).toBe(0);
    });
  });

  describe('summarizeToolExecutions', () => {
    it('should format successful executions', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'search', result: 'ok' },
      ];
      const summary = summarizeToolExecutions(results as any);
      expect(summary).toContain('[OK]');
      expect(summary).toContain('search');
      expect(summary).toContain('SUCCESS');
    });

    it('should format error executions', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'deploy', result: null, error: new Error('failed') },
      ];
      const summary = summarizeToolExecutions(results as any);
      expect(summary).toContain('[ERROR]');
      expect(summary).toContain('deploy');
      expect(summary).toContain('failed');
    });

    it('should include preliminary result count', () => {
      const results = [
        {
          toolCallId: 'c1',
          toolName: 'stream',
          result: 'final',
          preliminaryResults: ['a', 'b', 'c'],
        },
      ];
      const summary = summarizeToolExecutions(results as any);
      expect(summary).toContain('3 preliminary results');
    });

    it('should handle mixed results', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'search', result: 'ok' },
        { toolCallId: 'c2', toolName: 'fail', result: null, error: new Error('oops') },
      ];
      const summary = summarizeToolExecutions(results as any);
      expect(summary).toContain('[OK] search');
      expect(summary).toContain('[ERROR] fail');
    });
  });

  describe('hasToolExecutionErrors', () => {
    it('should return true when errors exist', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
        { toolCallId: 'c2', toolName: 'bad', result: null, error: new Error('fail') },
      ];
      expect(hasToolExecutionErrors(results as any)).toBe(true);
    });

    it('should return false when no errors', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
      ];
      expect(hasToolExecutionErrors(results as any)).toBe(false);
    });

    it('should return false for empty results', () => {
      expect(hasToolExecutionErrors([])).toBe(false);
    });
  });

  describe('getToolExecutionErrors', () => {
    it('should return only error objects', () => {
      const err1 = new Error('fail1');
      const err2 = new Error('fail2');
      const results = [
        { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
        { toolCallId: 'c2', toolName: 'bad1', result: null, error: err1 },
        { toolCallId: 'c3', toolName: 'bad2', result: null, error: err2 },
      ];
      const errors = getToolExecutionErrors(results as any);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBe(err1);
      expect(errors[1]).toBe(err2);
    });

    it('should return empty array when no errors', () => {
      const results = [
        { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
      ];
      expect(getToolExecutionErrors(results as any)).toEqual([]);
    });
  });
});
