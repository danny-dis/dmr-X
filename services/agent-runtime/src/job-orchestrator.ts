import { logger } from '@dmr-x/utils';

import { jobStore, type Job, type JobStatus, type JobTask } from './job.store.js';
import { readBoardFor, renderBoardForPrompt, writeBoardEntry } from './job-board.js';
import { findCycles, findMissingDependencies, schedulerState } from './job-scheduler.js';

// ---------------------------------------------------------------------------
// Job event system (for streaming progress via SSE)
//
// A minimal in-process pub/sub: listeners register per-job, events are emitted
// as the orchestrator progresses. The gateway subscribes and forwards events
// to SSE clients; nothing here depends on apps/* or any transport.
// ---------------------------------------------------------------------------

export type JobEvent =
  | { type: 'task:started'; jobId: string; taskId: string; taskTitle: string; attempt: number }
  | { type: 'task:completed'; jobId: string; taskId: string; taskTitle: string; agentName: string; summary: string }
  | { type: 'task:failed'; jobId: string; taskId: string; taskTitle: string; error: string; willRetry: boolean }
  | { type: 'task:retry_scheduled'; jobId: string; taskId: string; taskTitle: string; attempt: number; retryAfter: string }
  | { type: 'pass:completed'; jobId: string; ranTaskIds: string[]; state: string }
  | { type: 'job:completed'; jobId: string }
  | { type: 'job:blocked'; jobId: string; reason: string }
  | { type: 'job:failed'; jobId: string; reason: string };

type JobEventListener = (event: JobEvent) => void;

const jobListeners = new Map<string, Set<JobEventListener>>();

/** Subscribe to events for a specific job. Returns an unsubscribe function. */
export function subscribeToJobEvents(jobId: string, listener: JobEventListener): () => void {
  let set = jobListeners.get(jobId);
  if (!set) {
    set = new Set();
    jobListeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) jobListeners.delete(jobId);
  };
}

function emitJobEvent(event: JobEvent): void {
  const set = jobListeners.get(event.jobId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      logger.warn({ err, jobId: event.jobId }, 'job-event listener threw');
    }
  }
}

// ---------------------------------------------------------------------------
// Job orchestrator
//
// Drives one pass of a multi-agent job: validate the plan, work out which
// tasks may start, run them, record what they produced, and persist the
// resulting job state.
//
// The code that actually calls an LLM agent lives in apps/gateway, and
// services/* may never import from apps/*. So the caller injects a
// TaskExecutor and that is the only route by which work runs here. It also
// means the whole loop — including budget exhaustion and executor failure —
// can be driven with a fake executor in tests, with no inference involved.
// ---------------------------------------------------------------------------

/** What an executor reports back after running one task. */
export interface TaskExecutionResult {
  ok: boolean;
  agentName: string;
  summary: string;
  artifacts?: string[];
  openQuestions?: string[];
  forNext?: string[];
  costUsd?: number;
  tokens?: number;
  error?: string;
}

/**
 * Runs a single task. Supplied by the caller (the gateway), which owns the
 * agent invocation. `boardContext` is the already-rendered handoff block for
 * the tasks this one depends on, ready to inject into a prompt.
 */
export type TaskExecutor = (ctx: {
  job: Job;
  task: JobTask;
  boardContext: string;
}) => Promise<TaskExecutionResult>;

export interface JobRunResult {
  state: 'complete' | 'running' | 'blocked' | 'failed' | 'empty';
  ranTaskIds: string[];
  reason?: string;
}

/** Job statuses from which no further work may be started. */
const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'delivered',
  'failed',
  'cancelled',
]);

const SCHEDULER_TO_JOB_STATUS: Record<string, JobStatus> = {
  complete: 'delivered',
  failed: 'failed',
  blocked: 'blocked',
  running: 'running',
};

/**
 * Execute one pass over a job: every task whose dependencies are satisfied is
 * run once, sequentially. Call repeatedly to drive a job to completion — each
 * pass re-reads state, so it is safe to resume after a crash or a restart.
 *
 * Returns the job's state after the pass and the ids of the tasks it ran.
 */
export async function runJobPass(
  tenantId: string,
  jobId: string,
  executor: TaskExecutor,
): Promise<JobRunResult> {
  const ranTaskIds: string[] = [];

  const job = jobStore.getJob(tenantId, jobId);
  if (!job) return { state: 'failed', ranTaskIds, reason: 'job not found' };

  // A cancelled or already-finished job must never start more work.
  if (TERMINAL_JOB_STATUSES.has(job.status)) {
    return {
      state: job.status === 'delivered' ? 'complete' : 'failed',
      ranTaskIds,
      reason: `job is ${job.status}`,
    };
  }

  // Reclaim orphans before doing anything else. runJobPass always resolves a
  // task it starts, so a task still 'running' when a pass begins belongs to a
  // pass that died — a crash, a restart, or a client aborting the request that
  // was driving it. Left alone it blocks every dependent forever, because
  // 'running' is neither ready nor complete. Reset to 'pending' so the work is
  // retried rather than silently lost.
  reclaimOrphanedTasks(tenantId, jobId);

  const tasks = jobStore.listTasks(tenantId, jobId);

  // Validate the whole plan before running any of it. A cycle or a dependency
  // pointing at a task that does not exist means the plan can never complete,
  // and running part of it first would leave half-finished work behind.
  const planProblem = describePlanProblem(tasks);
  if (planProblem) {
    jobStore.updateJobStatus(tenantId, jobId, 'failed');
    return { state: 'failed', ranTaskIds, reason: planProblem };
  }

  const before = schedulerState(tasks);
  if (before.state !== 'running') {
    const status = SCHEDULER_TO_JOB_STATUS[before.state];
    if (status) jobStore.updateJobStatus(tenantId, jobId, status);
    return { state: before.state, ranTaskIds, reason: before.reason };
  }

  // Fast-fail if the job is already over budget before we start any work.
  // The per-task loop below re-checks after each task records its spend, so a
  // multi-task pass cannot overrun the cap.
  const current = jobStore.getJob(tenantId, jobId);
  if (!current) return { state: 'failed', ranTaskIds, reason: 'job disappeared mid-pass' };

  if (budgetExhausted(current)) {
    jobStore.updateJobStatus(tenantId, jobId, 'blocked');
    return { state: 'blocked', ranTaskIds, reason: budgetExhausted(current)! };
  }

  // Run ready tasks sequentially, re-checking budget before each one. A
  // multi-task pass would otherwise overrun the cap: the first task spends,
  // the pre-pass check is now stale, and the second task runs for free.
  // Spend is recorded immediately after each task so the next iteration's
  // budget check sees it.
  const results: TaskExecutionResult[] = [];
  let budgetBlocked = false;
  for (const task of before.ready) {
    const fresh = jobStore.getJob(tenantId, jobId);
    if (!fresh) {
      results.push({ ok: false, agentName: task.assignedInstanceId ?? 'unknown', summary: '', error: 'job disappeared mid-pass' });
      continue;
    }
    if (budgetExhausted(fresh)) {
      jobStore.updateJobStatus(tenantId, jobId, 'blocked');
      budgetBlocked = true;
      break;
    }
    emitJobEvent({ type: 'task:started', jobId, taskId: task.id, taskTitle: task.title, attempt: task.attempt });
    const result = await runTask(tenantId, jobId, fresh, task, executor);
    results.push(result);
    ranTaskIds.push(task.id);
    // A failed task still consumed tokens, so spend is recorded either way.
    jobStore.addSpend(tenantId, jobId, result.costUsd ?? 0, result.tokens ?? 0);
  }

  if (budgetBlocked) {
    return { state: 'blocked', ranTaskIds, reason: budgetExhausted(jobStore.getJob(tenantId, jobId)!) ?? 'budget exhausted' };
  }

  const after = schedulerState(jobStore.listTasks(tenantId, jobId));
  const status = SCHEDULER_TO_JOB_STATUS[after.state];
  if (status) jobStore.updateJobStatus(tenantId, jobId, status);

  emitJobEvent({ type: 'pass:completed', jobId, ranTaskIds, state: after.state });

  if (after.state === 'complete') {
    emitJobEvent({ type: 'job:completed', jobId });
  } else if (after.state === 'blocked') {
    emitJobEvent({ type: 'job:blocked', jobId, reason: after.reason ?? '' });
  } else if (after.state === 'failed') {
    emitJobEvent({ type: 'job:failed', jobId, reason: after.reason ?? '' });
  }

  return { state: after.state, ranTaskIds, reason: after.reason };
}

/**
 * Run one task and record its outcome. Never throws: an executor that rejects
 * is recorded as a failed task, because leaving a task in 'running' would make
 * the job look permanently in-flight and block every dependent forever.
 *
 * If the task fails with a retryable error and hasn't exhausted its retry
 * budget, it is reset to 'pending' (with attempt incremented and retryAfter
 * set to a future timestamp with exponential backoff) so the next pass picks
 * it up again.
 */
async function runTask(
  tenantId: string,
  jobId: string,
  job: Job,
  task: JobTask,
  executor: TaskExecutor,
): Promise<TaskExecutionResult> {
  jobStore.updateTask(tenantId, task.id, { status: 'running' });

  let result: TaskExecutionResult;
  try {
    const boardContext = renderBoardForPrompt(readBoardFor(tenantId, jobId, task.id));
    result = await executor({ job, task, boardContext });
  } catch (error) {
    result = {
      ok: false,
      agentName: task.assignedInstanceId ?? 'unknown',
      summary: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.ok) {
    writeBoardEntry(tenantId, task.id, {
      agentName: result.agentName,
      summary: result.summary,
      artifacts: result.artifacts ?? [],
      openQuestions: result.openQuestions ?? [],
      forNext: result.forNext ?? [],
    });
    jobStore.updateTask(tenantId, task.id, { status: 'completed' });
    emitJobEvent({
      type: 'task:completed',
      jobId,
      taskId: task.id,
      taskTitle: task.title,
      agentName: result.agentName,
      summary: result.summary,
    });
  } else {
    const attempt = (task.attempt ?? 0) + 1;
    const maxRetries = task.maxRetries ?? 3;

    if (attempt <= maxRetries && isRetryableError(result.error)) {
      // Exponential backoff: 2^attempt seconds, capped at 30 seconds.
      const backoffMs = Math.min(Math.pow(2, attempt) * 1000, 30_000);
      const retryAfter = new Date(Date.now() + backoffMs).toISOString();

      logger.warn(
        { taskId: task.id, jobId, attempt, maxRetries, retryAfter, error: result.error },
        'job-orchestrator: task failed with retryable error, scheduling retry',
      );

      // Reset to pending so the next pass picks it up. The scheduler's
      // readyTasks honors retryAfter and won't return it until backoff elapses.
      jobStore.updateTask(tenantId, task.id, {
        status: 'pending',
        attempt,
        retryAfter,
        output: { error: result.error ?? 'task failed', retried: true },
      });

      emitJobEvent({
        type: 'task:retry_scheduled',
        jobId,
        taskId: task.id,
        taskTitle: task.title,
        attempt,
        retryAfter,
      });
      emitJobEvent({
        type: 'task:failed',
        jobId,
        taskId: task.id,
        taskTitle: task.title,
        error: result.error ?? 'task failed',
        willRetry: true,
      });
    } else {
      // No board entry for a failed task — downstream agents must not read a
      // handoff describing work that did not happen.
      jobStore.updateTask(tenantId, task.id, {
        status: 'failed',
        attempt,
        output: { error: result.error ?? 'task failed' },
      });
      emitJobEvent({
        type: 'task:failed',
        jobId,
        taskId: task.id,
        taskTitle: task.title,
        error: result.error ?? 'task failed',
        willRetry: false,
      });
    }
  }

  return result;
}

/**
 * Heuristic: is a task execution error transient and worth retrying?
 * Mirrors AgentRuntimeService.classifyProviderError for common retryable
 * upstream failures (timeout, 5xx, overload, rate limit, unavailable).
 */
function isRetryableError(error?: string): boolean {
  if (!error) return false;
  return /timed out|timeout|503|502|500|rate limit|overloaded|unavailable|temporarily|connection refused|econnreset/i.test(error);
}

/**
 * Return tasks stranded in 'running' by a pass that never finished, so they
 * can be attempted again. `attempt` is incremented to record the retry.
 */
function reclaimOrphanedTasks(tenantId: string, jobId: string): void {
  for (const task of jobStore.listTasks(tenantId, jobId)) {
    if (task.status !== 'running') continue;
    logger.warn(
      { jobId, taskId: task.id, attempt: task.attempt },
      'job-orchestrator: reclaiming task orphaned by an interrupted pass',
    );
    jobStore.updateTask(tenantId, task.id, {
      status: 'pending',
      attempt: (task.attempt ?? 0) + 1,
    });
  }
}

/** Describe why a plan can never complete, or null when it is sound. */
function describePlanProblem(tasks: JobTask[]): string | null {
  const missing = findMissingDependencies(tasks);
  if (missing.length > 0) {
    const detail = missing
      .map((entry) => `${entry.taskId} -> ${entry.missing.join(', ')}`)
      .join('; ');
    return `plan references tasks that do not exist: ${detail}`;
  }

  const cycles = findCycles(tasks);
  if (cycles.length > 0) {
    return `plan contains a dependency cycle: ${cycles.map((c) => c.join(' -> ')).join('; ')}`;
  }

  return null;
}

/** Report which budget a job has exhausted, or null when it may keep running. */
function budgetExhausted(job: Job): string | null {
  if (job.budgetUsd != null && job.spentUsd >= job.budgetUsd) {
    return `budget exhausted: spent ${job.spentUsd} of ${job.budgetUsd} usd`;
  }
  if (job.budgetTokens != null && job.spentTokens >= job.budgetTokens) {
    return `budget exhausted: spent ${job.spentTokens} of ${job.budgetTokens} tokens`;
  }
  if (job.budgetDurationMs != null && job.createdAt) {
    const elapsedMs = Date.now() - new Date(job.createdAt).getTime();
    if (elapsedMs >= job.budgetDurationMs) {
      return `budget exhausted: ran for ${Math.round(elapsedMs / 1000)}s of ${job.budgetDurationMs / 1000}s`;
    }
  }
  return null;
}
