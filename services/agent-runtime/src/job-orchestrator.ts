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

  for (const task of before.ready) {
    // Re-read the job every iteration: spend accumulates as tasks run, so a
    // budget checked once at the start would let the whole pass overrun.
    const current = jobStore.getJob(tenantId, jobId);
    if (!current) return { state: 'failed', ranTaskIds, reason: 'job disappeared mid-pass' };

    const exhausted = budgetExhausted(current);
    if (exhausted) {
      jobStore.updateJobStatus(tenantId, jobId, 'blocked');
      return { state: 'blocked', ranTaskIds, reason: exhausted };
    }

    const result = await runTask(tenantId, jobId, current, task, executor);
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
    // No board entry for a failed task — downstream agents must not read a
    // handoff describing work that did not happen.
    jobStore.updateTask(tenantId, task.id, {
      status: 'failed',
      output: { error: result.error ?? 'task failed' },
    });
  }

  return result;
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
