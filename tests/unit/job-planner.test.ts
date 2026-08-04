import { describe, it, expect } from 'vitest';

import {
  parsePlanResponse,
  validatePlan,
  type PlannedTask,
} from '../../services/agent-runtime/src/job-planner.js';

const PLAN = JSON.stringify({
  tasks: [
    { ref: 't1', title: 'Design', description: 'd', dependsOn: [] },
    { ref: 't2', title: 'Build', description: 'd', dependsOn: ['t1'] },
  ],
});

const task = (ref: string, dependsOn: string[] = []): PlannedTask => ({
  ref,
  title: ref,
  description: 'd',
  dependsOn,
});

describe('job-planner', () => {
  // Models ignore "return JSON only" constantly, so the parser has to cope with
  // whatever wrapping comes back rather than assuming a clean payload.
  describe('parsePlanResponse: real-world model output', () => {
    it('accepts clean JSON', () => {
      expect(parsePlanResponse(PLAN).ok).toBe(true);
    });

    it('accepts a ```json fenced block', () => {
      expect(parsePlanResponse('```json\n' + PLAN + '\n```').ok).toBe(true);
    });

    it('accepts an untagged fenced block', () => {
      expect(parsePlanResponse('```\n' + PLAN + '\n```').ok).toBe(true);
    });

    it('accepts JSON surrounded by prose', () => {
      expect(parsePlanResponse(`Sure! Here's the plan:\n${PLAN}\nLet me know!`).ok).toBe(true);
    });

    it('accepts prose wrapping a fenced block', () => {
      expect(parsePlanResponse('Here you go:\n```json\n' + PLAN + '\n```\nHope that helps').ok).toBe(true);
    });

    it('does not mistake braces inside a string for the end of the object', () => {
      const withBraces = '{"tasks":[{"ref":"a","title":"use {curly} braces","dependsOn":[]}]}';
      expect(parsePlanResponse(withBraces).ok).toBe(true);
    });
  });

  // The parser is fed untrusted model output, so it must fail as a value and
  // never as an exception.
  describe('parsePlanResponse: malformed input never throws', () => {
    const cases: Array<[string, string]> = [
      ['empty string', ''],
      ['whitespace', '   '],
      ['prose only', 'not json at all'],
      ['truncated json', '{"tasks":['],
      ['null literal', 'null'],
      ['top-level array', '[1,2,3]'],
      ['bare number', '42'],
    ];

    it.each(cases)('returns an error for %s', (_label, input) => {
      expect(() => parsePlanResponse(input)).not.toThrow();
      expect(parsePlanResponse(input).ok).toBe(false);
    });

    it('terminates quickly on a large payload', () => {
      const started = Date.now();
      parsePlanResponse('x'.repeat(500_000) + '\n' + PLAN);
      expect(Date.now() - started).toBeLessThan(4000);
    });
  });

  describe('parsePlanResponse: shape validation', () => {
    it('rejects an empty task list', () => {
      expect(parsePlanResponse('{"tasks":[]}').ok).toBe(false);
    });

    it('rejects a response with no tasks key', () => {
      expect(parsePlanResponse('{"foo":1}').ok).toBe(false);
    });

    it('rejects duplicate refs', () => {
      const dup = '{"tasks":[{"ref":"a","title":"x"},{"ref":"a","title":"y"}]}';
      expect(parsePlanResponse(dup).ok).toBe(false);
    });

    it('rejects a blank ref', () => {
      expect(parsePlanResponse('{"tasks":[{"ref":"","title":"x"}]}').ok).toBe(false);
    });

    it('rejects a task with no title', () => {
      expect(parsePlanResponse('{"tasks":[{"ref":"a"}]}').ok).toBe(false);
    });

    it('defaults an absent dependsOn to an empty array', () => {
      const result = parsePlanResponse('{"tasks":[{"ref":"a","title":"x"}]}');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.tasks[0]?.dependsOn).toEqual([]);
    });
  });

  // A plan that reaches the database must already be sound: the scheduler
  // would refuse to run a cyclic or dangling graph, leaving the job deadlocked.
  describe('validatePlan', () => {
    it('reports nothing for a sound plan', () => {
      expect(validatePlan([task('a'), task('b', ['a'])])).toEqual([]);
    });

    it('reports a dependency on a ref that does not exist', () => {
      expect(validatePlan([task('a', ['ghost'])].slice()).length).toBeGreaterThan(0);
    });

    it('reports a task that depends on itself', () => {
      expect(validatePlan([task('a', ['a'])]).length).toBeGreaterThan(0);
    });

    it('reports a two-task cycle', () => {
      expect(validatePlan([task('a', ['b']), task('b', ['a'])]).length).toBeGreaterThan(0);
    });
  });
});
