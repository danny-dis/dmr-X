import { describe, it, expect } from 'vitest';

import {
  findCycles,
  findMissingDependencies,
  topologicalOrder,
  readyTasks,
  schedulerState,
} from '../../services/agent-runtime/src/job-scheduler.js';
import type { JobTask } from '../../services/agent-runtime/src/job.store.js';

// Minimal JobTask factory -- the scheduler only reads id, seq, dependsOn and
// status, so the remaining columns are filled with placeholders.
function task(
  id: string,
  seq: number,
  dependsOn: string[] = [],
  status: JobTask['status'] = 'pending',
): JobTask {
  return {
    id,
    jobId: 'job-1',
    parentTaskId: null,
    seq,
    title: id,
    status,
    dependsOn,
    attempt: 0,
  } as unknown as JobTask;
}

const ids = (tasks: JobTask[]): string[] => tasks.map((t) => t.id);

describe('job-scheduler', () => {
  describe('findCycles', () => {
    it('returns no cycles for an acyclic chain', () => {
      expect(findCycles([task('c', 3, ['b']), task('b', 2, ['a']), task('a', 1)])).toEqual([]);
    });

    it('detects a task that depends on itself', () => {
      expect(findCycles([task('a', 1, ['a'])]).length).toBeGreaterThan(0);
    });

    it('detects a two-task cycle', () => {
      expect(findCycles([task('a', 1, ['b']), task('b', 2, ['a'])]).length).toBeGreaterThan(0);
    });
  });

  describe('findMissingDependencies', () => {
    it('reports a dependency that references a task not in the job', () => {
      const missing = findMissingDependencies([task('a', 1, ['ghost'])]);
      expect(missing).toHaveLength(1);
      expect(missing[0]?.missing).toContain('ghost');
    });

    it('reports nothing when every reference resolves', () => {
      expect(findMissingDependencies([task('a', 1), task('b', 2, ['a'])])).toEqual([]);
    });
  });

  describe('topologicalOrder', () => {
    it('orders dependencies before dependents', () => {
      const order = topologicalOrder([task('c', 3, ['b']), task('b', 2, ['a']), task('a', 1)]);
      expect(ids(order ?? [])).toEqual(['a', 'b', 'c']);
    });

    it('returns null when the graph is cyclic', () => {
      expect(topologicalOrder([task('a', 1, ['b']), task('b', 2, ['a'])])).toBeNull();
    });
  });

  describe('readyTasks', () => {
    it('starts only the task whose dependencies are satisfied', () => {
      expect(ids(readyTasks([task('c', 3, ['b']), task('b', 2, ['a']), task('a', 1)]))).toEqual(['a']);
    });

    it('unlocks a dependent once its dependency completes', () => {
      const tasks = [task('a', 1, [], 'completed'), task('b', 2, ['a'])];
      expect(ids(readyTasks(tasks))).toEqual(['b']);
    });

    // A dangling dependency must never be treated as satisfied: doing so would
    // run a task before the work it depends on.
    it('never readies a task whose dependency does not exist', () => {
      expect(readyTasks([task('a', 1, ['ghost'])])).toEqual([]);
    });

    // A failed dependency is not a completed one -- the dependent must stay put
    // rather than running against missing output.
    it('never readies a task whose dependency failed', () => {
      expect(readyTasks([task('a', 1, [], 'failed'), task('b', 2, ['a'])])).toEqual([]);
    });

    it('readies nothing in a cyclic graph', () => {
      expect(readyTasks([task('a', 1, ['b']), task('b', 2, ['a'])])).toEqual([]);
    });
  });

  describe('schedulerState', () => {
    it('reports empty for no tasks', () => {
      expect(schedulerState([]).state).toBe('empty');
    });

    it('reports complete when every task finished', () => {
      expect(schedulerState([task('a', 1, [], 'completed')]).state).toBe('complete');
    });

    it('reports failed even when other work could still run', () => {
      expect(schedulerState([task('a', 1, [], 'failed'), task('b', 2)]).state).toBe('failed');
    });

    // The deadlock case: pending work remains but nothing can start and nothing
    // is running. Without this the loop would spin forever on a cyclic plan.
    it('reports blocked with a reason for a cyclic plan', () => {
      const state = schedulerState([task('a', 1, ['b']), task('b', 2, ['a'])]);
      expect(state.state).toBe('blocked');
      expect(state.reason).toBeTruthy();
    });
  });

  describe('robustness', () => {
    it('terminates on a large cyclic graph', () => {
      const big = Array.from({ length: 200 }, (_, i) => task(`n${i}`, i, [`n${(i + 1) % 200}`]));
      const started = Date.now();
      findCycles(big);
      topologicalOrder(big);
      readyTasks(big);
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('does not mutate its input', () => {
      const tasks = [task('c', 3, ['b']), task('b', 2, ['a']), task('a', 1)];
      const before = JSON.stringify(tasks);
      topologicalOrder(tasks);
      readyTasks(tasks);
      schedulerState(tasks);
      expect(JSON.stringify(tasks)).toBe(before);
    });
  });
});
