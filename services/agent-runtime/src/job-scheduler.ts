import type { JobTask, JobTaskStatus } from './job.store.js';

// ---------------------------------------------------------------------------
// Job scheduler
//
// PURE scheduling logic for multi-agent jobs. Given a flat array of a job's
// `job_tasks` (each with an optional `dependsOn` list of other task ids),
// this module decides what may run next and whether the job is making
// progress or deadlocked. It is deliberately free of any side effects:
// no database access, no agent invocation, no I/O, no clocks — just pure
// functions over arrays, so it is trivially unit-testable and safe to call
// from anywhere (an orchestrator, a REPL, a test, a worker).
//
// Correctness contract shared by every function here:
//   - Input is never mutated. Copies are sorted, never the input array, and
//     task objects are read-only.
//   - Every graph traversal tracks visited nodes (three-color DFS for cycle
//     detection, Kahn's in-degree loop for topological order), so cyclic
//     input always terminates — never an infinite loop.
//   - Deterministic: tasks are iterated and returned in `seq` ascending
//     order, ties broken by input order (same convention as JobStore's
//     `listTasks`, which orders by `seq` only).
//   - A dangling `dependsOn` id (one not present in the given array) is
//     NEVER treated as satisfied: it blocks readiness, is reported by
//     `findMissingDependencies`, and counts as a deadlock cause in
//     `schedulerState`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Ascending `seq` comparison. Stable for equal seqs (keeps input order). */
function bySeqAsc(a: JobTask, b: JobTask): number {
  return a.seq - b.seq;
}

/** Ids that mean "the orchestrator is handling this task right now". */
const IN_FLIGHT_STATUSES: ReadonlySet<JobTaskStatus> = new Set<JobTaskStatus>([
  'assigned',
  'running',
  'blocked',
]);

/** Statuses that are terminal: the task will never run again. */
const TERMINAL_STATUSES: ReadonlySet<JobTaskStatus> = new Set<JobTaskStatus>([
  'completed',
  'failed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Detect dependency cycles among the given tasks.
 *
 * Each returned cycle is an array of task ids in cycle order, deterministically
 * rotated so its smallest id (string comparison) comes first; duplicates of the
 * same cycle (possible when a cycle is reachable via several edges) are
 * collapsed. A task that lists itself in `dependsOn` is reported as a
 * self-cycle `[id]`. Returns `[]` when the graph is acyclic.
 *
 * Dangling `dependsOn` ids (not present in the array) are skipped — they
 * cannot participate in a cycle and are `findMissingDependencies`'s job.
 *
 * Termination: three-color DFS (white/gray/black). Every node is visited at
 * most once and every edge examined at most once, so cyclic input cannot
 * loop forever — a back edge to a gray (in-progress) node only records the
 * cycle and continues.
 */
export function findCycles(tasks: JobTask[]): string[][] {
  const idSet = new Set(tasks.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const task = byId.get(id);
    for (const dep of task?.dependsOn ?? []) {
      if (!idSet.has(dep)) continue; // dangling ref — not part of any cycle
      const depColor = color.get(dep) ?? WHITE;
      if (depColor === WHITE) {
        visit(dep);
      } else if (depColor === GRAY) {
        // Back edge dep -> id: the cycle is the stack from dep through id.
        const cycle = stack.slice(stack.indexOf(dep));
        const key = canonicalCycleKey(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      }
      // BLACK: subtree fully explored, no cycle through this edge.
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const task of [...tasks].sort(bySeqAsc)) {
    if ((color.get(task.id) ?? WHITE) === WHITE) visit(task.id);
  }

  return cycles;
}

/** Deterministic identity for a cycle: rotate to smallest id first, join. */
function canonicalCycleKey(cycle: string[]): string {
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIndex]) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)].join('\u0000');
}

// ---------------------------------------------------------------------------
// Missing dependencies
// ---------------------------------------------------------------------------

/**
 * Find `dependsOn` entries that reference a task id NOT present in the given
 * array. Returns one entry per offending task, its `missing` ids in the order
 * they appear in `dependsOn`; tasks are listed in `seq` ascending order.
 * Returns `[]` when every reference resolves.
 *
 * A dangling dependency is never silently ignored: treating it as satisfied
 * would let a task run before the work it depends on.
 */
export function findMissingDependencies(tasks: JobTask[]): Array<{ taskId: string; missing: string[] }> {
  const idSet = new Set(tasks.map((task) => task.id));
  const result: Array<{ taskId: string; missing: string[] }> = [];
  for (const task of [...tasks].sort(bySeqAsc)) {
    const missing = (task.dependsOn ?? []).filter((dep) => !idSet.has(dep));
    if (missing.length > 0) result.push({ taskId: task.id, missing });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Topological order
// ---------------------------------------------------------------------------

/**
 * Return the tasks in dependency order (dependencies before dependents).
 * Ties — several tasks becoming ready at the same step — are broken by `seq`
 * ascending, so the result is deterministic. Dangling `dependsOn` ids impose
 * no ordering constraint (the referenced task is not in the array) but are
 * NOT treated as satisfied — they surface via `findMissingDependencies`.
 *
 * Returns `null` when the graph has a cycle (including a self-cycle).
 *
 * Termination: Kahn's algorithm with an in-degree count; each iteration
 * removes exactly one ready task, so it runs in at most N iterations and the
 * cycle case is detected by leftover tasks, never by looping forever.
 */
export function topologicalOrder(tasks: JobTask[]): JobTask[] | null {
  if (tasks.length === 0) return [];

  const idSet = new Set(tasks.map((task) => task.id));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, JobTask[]>();

  for (const task of tasks) {
    const deps = (task.dependsOn ?? []).filter((dep) => idSet.has(dep));
    inDegree.set(task.id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(task);
      dependents.set(dep, list);
    }
  }

  const ready: JobTask[] = tasks
    .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
    .sort(bySeqAsc);
  const order: JobTask[] = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break; // unreachable: loop guards on length > 0
    order.push(next);
    for (const dependent of dependents.get(next.id) ?? []) {
      const deg = (inDegree.get(dependent.id) ?? 0) - 1;
      inDegree.set(dependent.id, deg);
      if (deg === 0) insertSortedBySeq(ready, dependent);
    }
  }

  return order.length === tasks.length ? order : null;
}

/** Insert `item` into an ascending-by-seq list, stable for equal seqs. */
function insertSortedBySeq(list: JobTask[], item: JobTask): void {
  const index = list.findIndex((existing) => existing.seq > item.seq);
  if (index === -1) list.push(item);
  else list.splice(index, 0, item);
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Return the tasks that may start RIGHT NOW: `status === 'pending'` AND every
 * id in `dependsOn` refers to a task whose status is `'completed'`. A task
 * with a missing/dangling dependency is NEVER ready — the dependency is not
 * 'completed', so it blocks. A pending task with an empty or absent
 * `dependsOn` is ready. Result is ordered by `seq` ascending.
 */
export function readyTasks(tasks: JobTask[]): JobTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ready: JobTask[] = [];
  for (const task of [...tasks].sort(bySeqAsc)) {
    if (task.status !== 'pending') continue;
    let allDepsDone = true;
    for (const dep of task.dependsOn ?? []) {
      const depTask = byId.get(dep);
      if (!depTask || depTask.status !== 'completed') {
        allDepsDone = false;
        break;
      }
    }
    if (allDepsDone) ready.push(task);
  }
  return ready;
}

// ---------------------------------------------------------------------------
// Job-level state
// ---------------------------------------------------------------------------

/** Result of `schedulerState`: the job's scheduling state and its buckets. */
export interface SchedulerState {
  state: 'empty' | 'running' | 'complete' | 'blocked' | 'failed';
  /** Tasks that may start now (`readyTasks`), `seq` ascending. */
  ready: JobTask[];
  /** Tasks currently in flight ('assigned' | 'running' | 'blocked'), `seq` ascending. */
  running: JobTask[];
  /** Set on 'blocked' — a short explanation of the deadlock cause. */
  reason?: string;
}

/**
 * Classify a job's scheduling state:
 *
 *   'empty'    — no tasks at all.
 *   'complete' — every task is in a terminal state and none failed
 *                (i.e. all 'completed' or 'cancelled').
 *   'failed'   — at least one task failed. Checked before 'running'.
 *   'running'  — at least one task is in flight ('assigned' | 'running' |
 *                'blocked'), or at least one task is ready to start.
 *   'blocked'  — DEADLOCK: pending tasks remain, but none are ready and none
 *                are in flight. `reason` names the cause: a dependency cycle,
 *                a dangling dependency, or a dependency that can never become
 *                'completed' (cancelled/blocked).
 *
 * A task status of 'blocked' is treated as in-flight (it is waiting on an
 * external resume, not a scheduler deadlock), so a job with such a task is
 * 'running', never falsely 'blocked'.
 */
export function schedulerState(tasks: JobTask[]): SchedulerState {
  if (tasks.length === 0) return { state: 'empty', ready: [], running: [] };

  const failed = tasks.some((task) => task.status === 'failed');
  const allTerminal = tasks.every((task) => TERMINAL_STATUSES.has(task.status));

  const ready = readyTasks(tasks);
  const running = [...tasks].filter((task) => IN_FLIGHT_STATUSES.has(task.status)).sort(bySeqAsc);

  if (failed) return { state: 'failed', ready, running };
  if (allTerminal) return { state: 'complete', ready: [], running: [] };
  if (running.length > 0 || ready.length > 0) return { state: 'running', ready, running };

  // Deadlock: pending tasks remain but nothing is ready and nothing is in
  // flight. Name the cause in priority order: cycle, then dangling dep, then
  // a dependency that can never complete.
  const cycles = findCycles(tasks);
  if (cycles.length > 0) {
    return {
      state: 'blocked',
      ready: [],
      running: [],
      reason: `dependency cycle: ${cycles[0].join(' -> ')}`,
    };
  }
  const missing = findMissingDependencies(tasks);
  if (missing.length > 0) {
    return {
      state: 'blocked',
      ready: [],
      running: [],
      reason: `missing dependencies: ${missing[0].taskId} -> ${missing[0].missing.join(', ')}`,
    };
  }
  return {
    state: 'blocked',
    ready: [],
    running: [],
    reason: 'a dependency is not completed (cancelled or blocked)',
  };
}
