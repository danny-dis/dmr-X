import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';

// Only module boundaries are mocked: every store query uses actual SQLite.
const db = new Database(':memory:');
mock.module('@dmr-x/db', () => ({ getDb: () => db }));
mock.module('@dmr-x/utils', () => ({ logger: { warn() {}, info() {}, error() {}, debug() {} } }));
let verifications = 0;
let verificationHook: (() => void) | undefined;
mock.module(new URL('../../services/agent-runtime/src/receptionist.ts', import.meta.url).href, () => ({
  verifyAcceptanceCriteria: () => { verifications++; verificationHook?.(); return { passed: true }; },
}));
const { jobStore } = await import('../../services/agent-runtime/src/job.store.ts');
const { runJobPass, subscribeToJobEvents } = await import('../../services/agent-runtime/src/job-orchestrator.ts');
const { readBoard } = await import('../../services/agent-runtime/src/job-board.ts');
import type { JobEvent, TaskExecutionResult } from '../../services/agent-runtime/src/job-orchestrator.ts';

db.exec(`
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, submitted_by TEXT, source TEXT, brief TEXT,
    acceptance_criteria TEXT, status TEXT, budget_usd REAL, budget_tokens INTEGER,
    budget_duration_ms INTEGER, deadline_at TEXT, max_depth INTEGER, spent_usd REAL,
    spent_tokens INTEGER, plan TEXT, result TEXT, decision_log TEXT, pin_agents INTEGER,
    created_at TEXT, updated_at TEXT
  );
  CREATE TABLE job_tasks (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, parent_task_id TEXT, seq INTEGER, title TEXT,
    description TEXT, deliverable TEXT, acceptance TEXT, assigned_agent_def_id TEXT,
    assigned_agent_version TEXT, assigned_instance_id TEXT, session_id TEXT, assigned_model TEXT,
    status TEXT, depends_on TEXT, attempt INTEGER, max_retries INTEGER, retry_after TEXT,
    output TEXT, created_at TEXT, updated_at TEXT
  );
`);
const tenant = 'cancel-owner';
beforeEach(() => { db.exec('DELETE FROM job_tasks; DELETE FROM jobs;'); verifications = 0; verificationHook = undefined; });
afterAll(() => db.close());

function makeJob(extra: Record<string, unknown> = {}) {
  return jobStore.createJob({ id: crypto.randomUUID(), tenantId: tenant, source: 'api', brief: 'cancel test', status: 'running', ...extra });
}
function task(jobId: string, seq: number, dependsOn: string[] = []) {
  return jobStore.createTask({ id: crypto.randomUUID(), jobId, seq, title: `task ${seq}`, dependsOn });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const success: TaskExecutionResult = { ok: true, agentName: 'fake-executor', summary: 'actual late output', costUsd: 0.25, tokens: 23 };

test('cancel while executor is running suppresses late success and successor execution', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  const sibling = task(job.id, 2);
  const dependent = task(job.id, 3, [first.id]);
  const started = deferred<void>();
  const execution = deferred<TaskExecutionResult>();
  const calls: string[] = [];
  const events: JobEvent[] = [];
  const unsubscribe = subscribeToJobEvents(job.id, event => events.push(event));
  try {
    const pass = runJobPass(tenant, job.id, async ({ task }) => {
      calls.push(task.id);
      started.resolve();
      return execution.promise;
    });
    await started.promise;
    expect(jobStore.getTask(tenant, first.id)?.status).toBe('running');
    expect(jobStore.cancelJob(tenant, job.id)?.status).toBe('cancelled');
    execution.resolve(success);
    const result = await pass;
    expect(jobStore.getJob(tenant, job.id)?.status).toBe('cancelled');
    expect(result).toEqual({ state: 'failed', ranTaskIds: [first.id], reason: 'job is cancelled' });
    expect(calls).toEqual([first.id]);
    expect(jobStore.getTask(tenant, first.id)?.status).toBe('cancelled');
    expect(jobStore.getTask(tenant, first.id)?.output).toBeUndefined();
    expect(jobStore.getTask(tenant, sibling.id)?.status).toBe('pending');
    expect(jobStore.getTask(tenant, dependent.id)?.status).toBe('pending');
    expect(readBoard(tenant, job.id)).toEqual([]);
    expect(events.map(e => e.type)).toEqual(['task:started']);
    expect(verifications).toBe(0);
    expect(jobStore.getJob(tenant, job.id)?.result).toBeUndefined();
    expect(jobStore.getJob(tenant, job.id)?.spentUsd).toBe(0.25);
    expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(23);
    expect((await runJobPass(tenant, job.id, async () => { throw new Error('must not run'); })).ranTaskIds).toEqual([]);
  } finally { unsubscribe(); }
});

test('updateJobStatus cannot resurrect persisted cancellation from a stale running snapshot', () => {
  const job = makeJob();
  expect(job.status).toBe('running');
  jobStore.cancelJob(tenant, job.id);
  db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run('cancellation-marker', job.id);
  for (const status of ['intake', 'planning', 'running', 'blocked', 'verifying', 'delivered', 'failed'] as const) {
    const readback = jobStore.updateJobStatus(tenant, job.id, status);
    expect(readback?.status).toBe('cancelled');
    expect(readback?.updatedAt).toBe('cancellation-marker');
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id)).toEqual({ status: 'cancelled' });
  }
});

test('updateJob status patches atomically reject stale delivery metadata after cancellation', () => {
  const job = makeJob({ decisionLog: [{ action: 'cancel-intent' }] });
  jobStore.cancelJob(tenant, job.id);
  db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run('cancellation-marker', job.id);
  for (const status of ['running', 'blocked', 'failed', 'delivered'] as const) {
    const readback = jobStore.updateJob(tenant, job.id, { status, result: { passed: true }, decisionLog: [{ action: 'late-success' }] });
    expect(readback?.status).toBe('cancelled');
    expect(readback?.result).toBeUndefined();
    expect(readback?.decisionLog).toEqual([{ action: 'cancel-intent' }]);
    expect(readback?.updatedAt).toBe('cancellation-marker');
  }
});

for (const outcome of ['success', 'thrown-failure', 'retryable-failure', 'failure-over-budget'] as const) {
  test(`single in-flight task stays cancelled after ${outcome}`, async () => {
    const job = makeJob({ budgetTokens: 10 });
    const first = task(job.id, 1);
    const started = deferred<void>();
    const execution = deferred<TaskExecutionResult>();
    const events: JobEvent[] = [];
    const unsubscribe = subscribeToJobEvents(job.id, event => events.push(event));
    try {
      const pass = runJobPass(tenant, job.id, async () => { started.resolve(); return execution.promise; });
      await started.promise;
      jobStore.cancelJob(tenant, job.id);
      if (outcome === 'thrown-failure') execution.reject(new Error('provider exploded'));
      else execution.resolve(outcome === 'success' ? success : { ...success, ok: false, error: outcome === 'retryable-failure' ? '503 temporarily unavailable' : 'invalid response' });
      expect(await pass).toEqual({ state: 'failed', ranTaskIds: [first.id], reason: 'job is cancelled' });
      const final = jobStore.getJob(tenant, job.id)!;
      expect(final.status).toBe('cancelled');
      expect(final.result).toBeUndefined();
      expect(final.decisionLog).toBeUndefined();
      expect(final.spentUsd).toBe(outcome === 'thrown-failure' ? 0 : 0.25);
      expect(final.spentTokens).toBe(outcome === 'thrown-failure' ? 0 : 23);
      const finalTask = jobStore.getTask(tenant, first.id)!;
      expect(finalTask.status).toBe('cancelled');
      expect(finalTask.attempt).toBe(0);
      expect(finalTask.retryAfter).toBeNull();
      expect(finalTask.output).toBeUndefined();
      expect(readBoard(tenant, job.id)).toEqual([]);
      expect(events.map(e => e.type)).toEqual(['task:started']);
      expect(verifications).toBe(0);
    } finally { unsubscribe(); }
  });
}

test('tenant isolation covers cancellation, status patches, spend and execution', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  expect(jobStore.cancelJob('other-tenant', job.id)).toBeNull();
  expect(jobStore.updateJobStatus('other-tenant', job.id, 'failed')).toBeNull();
  expect(jobStore.updateJob('other-tenant', job.id, { status: 'delivered', result: 'foreign' })).toBeNull();
  jobStore.addSpend('other-tenant', job.id, 99, 99);
  expect(await runJobPass('other-tenant', job.id, async () => { throw new Error('must not execute'); })).toEqual({ state: 'failed', ranTaskIds: [], reason: 'job not found' });
  expect(jobStore.getJob(tenant, job.id)?.status).toBe('running');
  expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(0);
  expect(jobStore.getTask(tenant, first.id)?.status).toBe('pending');
});

test('normal completion retains dependencies, board output, spend and completion events', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  const dependent = task(job.id, 2, [first.id]);
  const events: JobEvent[] = [];
  const unsubscribe = subscribeToJobEvents(job.id, event => events.push(event));
  try {
    expect(await runJobPass(tenant, job.id, async () => success)).toEqual({ state: 'running', ranTaskIds: [first.id], reason: undefined });
    const result = await runJobPass(tenant, job.id, async ({ task, boardContext }) => {
      expect(task.id).toBe(dependent.id);
      expect(boardContext).toContain(success.summary);
      return success;
    });
    expect(result.state).toBe('complete');
    expect(jobStore.getJob(tenant, job.id)?.status).toBe('delivered');
    expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(46);
    expect(jobStore.getJob(tenant, job.id)?.result).toEqual({ passed: true });
    expect(readBoard(tenant, job.id)).toHaveLength(2);
    expect(events.filter(e => e.type === 'job:completed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'pass:completed')).toHaveLength(2);
    expect(verifications).toBe(1);
  } finally { unsubscribe(); }
});

test('normal retryable failure schedules retry and subsequent completion', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  const result = await runJobPass(tenant, job.id, async () => ({ ...success, ok: false, error: '503 temporarily unavailable' }));
  expect(result.state).not.toBe('failed');
  const retried = jobStore.getTask(tenant, first.id)!;
  expect(retried.status).toBe('pending');
  expect(retried.attempt).toBe(1);
  expect(retried.retryAfter).not.toBeNull();
  expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(23);
  expect(readBoard(tenant, job.id)).toEqual([]);
  jobStore.updateTask(tenant, first.id, { retryAfter: null });
  expect((await runJobPass(tenant, job.id, async () => success)).state).toBe('complete');
  expect(jobStore.getJob(tenant, job.id)?.status).toBe('delivered');
});

test('normal thrown failure records failure and escalation without fabricating usage', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  expect((await runJobPass(tenant, job.id, async () => { throw new Error('provider exploded'); })).state).toBe('failed');
  expect(jobStore.getTask(tenant, first.id)?.status).toBe('failed');
  expect(jobStore.getJob(tenant, job.id)?.status).toBe('failed');
  expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(0);
  expect(jobStore.getJob(tenant, job.id)?.decisionLog).toEqual([expect.objectContaining({ action: 'escalate_to_human' })]);
  expect(readBoard(tenant, job.id)).toEqual([]);
});

test('normal budget exhaustion stops a ready successor', async () => {
  const job = makeJob({ budgetTokens: 10 });
  const first = task(job.id, 1);
  const sibling = task(job.id, 2);
  const calls: string[] = [];
  const result = await runJobPass(tenant, job.id, async ({ task }) => { calls.push(task.id); return success; });
  expect(result.state).toBe('blocked');
  expect(calls).toEqual([first.id]);
  expect(jobStore.getJob(tenant, job.id)?.status).toBe('blocked');
  expect(jobStore.getTask(tenant, sibling.id)?.status).toBe('pending');
  expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(23);
});

test('task:started cancellation prevents executor, board output and ready successor', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  const sibling = task(job.id, 2);
  const events: JobEvent[] = [];
  let calls = 0;
  const unsubscribe = subscribeToJobEvents(job.id, event => {
    events.push(event);
    if (event.type === 'task:started') jobStore.cancelJob(tenant, job.id);
  });
  try {
    expect(await runJobPass(tenant, job.id, async () => { calls++; return success; })).toEqual({ state: 'failed', ranTaskIds: [first.id], reason: 'job is cancelled' });
    expect(calls).toBe(0);
    expect(jobStore.getJob(tenant, job.id)?.status).toBe('cancelled');
    expect(jobStore.getJob(tenant, job.id)?.spentUsd).toBe(0);
    expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(0);
    expect(jobStore.getTask(tenant, first.id)?.status).toBe('cancelled');
    expect(jobStore.getTask(tenant, sibling.id)?.status).toBe('pending');
    expect(readBoard(tenant, job.id)).toEqual([]);
    expect(events.map(e => e.type)).toEqual(['task:started']);
    expect(verifications).toBe(0);
  } finally { unsubscribe(); }
});

for (const hasSibling of [false, true]) {
  test(`task:completed cancellation suppresses later work and pass/job completion (sibling=${hasSibling})`, async () => {
    const job = makeJob();
    const first = task(job.id, 1);
    const sibling = hasSibling ? task(job.id, 2) : undefined;
    const calls: string[] = [];
    const events: JobEvent[] = [];
    const unsubscribe = subscribeToJobEvents(job.id, event => {
      events.push(event);
      if (event.type === 'task:completed') jobStore.cancelJob(tenant, job.id);
    });
    try {
      expect(await runJobPass(tenant, job.id, async ({ task }) => { calls.push(task.id); return success; })).toEqual({ state: 'failed', ranTaskIds: [first.id], reason: 'job is cancelled' });
      expect(calls).toEqual([first.id]);
      expect(jobStore.getJob(tenant, job.id)?.status).toBe('cancelled');
      expect(jobStore.getJob(tenant, job.id)?.result).toBeUndefined();
      expect(jobStore.getJob(tenant, job.id)?.spentUsd).toBe(0.25);
      expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(23);
      // This output preceded cancellation; cancellation must not fabricate or erase it.
      expect(jobStore.getTask(tenant, first.id)?.status).toBe('completed');
      expect(readBoard(tenant, job.id)).toHaveLength(1);
      if (sibling) expect(jobStore.getTask(tenant, sibling.id)?.status).toBe('pending');
      expect(events.map(e => e.type)).toEqual(['task:started', 'task:completed']);
      expect(verifications).toBe(0);
    } finally { unsubscribe(); }
  });
}

test('pass:completed cancellation prevents job:completed without erasing prior output or usage', async () => {
  const job = makeJob();
  const first = task(job.id, 1);
  const events: JobEvent[] = [];
  const unsubscribe = subscribeToJobEvents(job.id, event => {
    events.push(event);
    if (event.type === 'pass:completed') jobStore.cancelJob(tenant, job.id);
  });
  try {
    expect(await runJobPass(tenant, job.id, async () => success)).toEqual({ state: 'failed', ranTaskIds: [first.id], reason: 'job is cancelled' });
    expect(jobStore.getJob(tenant, job.id)?.status).toBe('cancelled');
    expect(jobStore.getJob(tenant, job.id)?.spentUsd).toBe(0.25);
    expect(jobStore.getJob(tenant, job.id)?.spentTokens).toBe(23);
    expect(jobStore.getTask(tenant, first.id)?.status).toBe('completed');
    expect(readBoard(tenant, job.id)).toHaveLength(1);
    expect(events.map(e => e.type)).toEqual(['task:started', 'task:completed', 'pass:completed']);
    expect((await runJobPass(tenant, job.id, async () => { throw new Error('must not execute'); })).ranTaskIds).toEqual([]);
  } finally { unsubscribe(); }
});

test('cancellation during outcome finalization does not publish completion or overwrite cancellation metadata', async () => {
  const job = makeJob();
  task(job.id, 1);
  verificationHook = () => { jobStore.cancelJob(tenant, job.id); };
  const events: JobEvent[] = [];
  const unsubscribe = subscribeToJobEvents(job.id, event => events.push(event));
  try {
    const result = await runJobPass(tenant, job.id, async () => success);
    expect(jobStore.getJob(tenant, job.id)?.status).toBe('cancelled');
    expect(jobStore.getJob(tenant, job.id)?.result).toBeUndefined();
    expect(result.state).toBe('failed');
    expect(result.reason).toBe('job is cancelled');
    expect(events.map(e => e.type)).toEqual(['task:started', 'task:completed']);
  } finally { unsubscribe(); }
});
