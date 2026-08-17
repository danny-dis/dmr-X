import { logger } from '@dmr-x/utils';

import { jobStore, type Job, type JobStatus, type JobTask } from './job.store.js';
import { readBoardFor, renderBoardForPrompt, writeBoardEntry } from './job-board.js';
import { findCycles, findMissingDependencies, schedulerState } from './job-scheduler.js';

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

  // Check budget once before starting parallel work. Ready tasks are
  // independent (all their deps are 'completed'), so they can run concurrently.
  // The next pass re-checks budget, so overshoot is bounded by one pass.
  const current = jobStore.getJob(tenantId, jobId);
  if (!current) return { state: 'failed', ranTaskIds, reason: 'job disappeared mid-pass' };

  const exhausted = budgetExhausted(current);
  if (exhausted) {
    jobStore.updateJobStatus(tenantId, jobId, 'blocked');
    return { state: 'blocked', ranTaskIds, reason: exhausted };
  }

  // Run all ready tasks in parallel. Promise.all preserves order, so results[i]
  // corresponds to before.ready[i].
  const results = await Promise.all(
    before.ready.map((task) => runTask(tenantId, jobId, current, task, executor)),
  );

  for (let i = 0; i < before.ready.length; i++) {
    const task = before.ready[i];
    const result = results[i];
    ranTaskIds.push(task.id);

    // A failed task still consumed tokens, so spend is recorded either way.
    jobStore.addSpend(tenantId, jobId, result.costUsd ?? 0, result.tokens ?? 0);
  }

  const after = schedulerState(jobStore.listTasks(tenantId, jobId));
  const status = SCHEDULER_TO_JOB_STATUS[after.state];
  if (status) jobStore.updateJobStatus(tenantId, jobId, status);
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
    } else {
      // No board entry for a failed task — downstream agents must not read a
      // handoff describing work that did not happen.
      jobStore.updateTask(tenantId, task.id, {
        status: 'failed',
        attempt,
        output: { error: result.error ?? 'task failed' },
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
  return null;
}
