// Drives the multi-agent job loop against the real SQLite path with a fake
// executor, matching the repo's "test against real sql.js" convention. The
// executor is injected, so every branch below -- success, thrown error, budget
// exhaustion, cancellation, broken plan -- is exercised without any inference.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  jobStore,
  runJobPass,
  readBoard,
  type TaskExecutor,
  type Job,
  type JobTask,
} from '@dmr-x/agent-runtime';

// Import the db module dynamically and bind to its initDb/getDb/closeDb so they
// are guaranteed to be the SAME singleton the runtime modules use.
let initDb: (...args: unknown[]) => Promise<unknown>;
let getDb: () => any;
let closeDb: (...args: unknown[]) => Promise<unknown>;

let tmpDir: string;

const TENANT = 'tenant-orch-test';

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb as any;
  getDb = dbMod.getDb as any;
  closeDb = dbMod.closeDb as any;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-orch-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // no open handle on a cold run
  }
  await initDb();

  // tenants holds only (id, name, created_at, updated_at) — key hashes live in
  // api_keys.key_hash. Inserting a non-existent api_key_hash column threw in
  // beforeAll, which skipped all 10 tests in this file rather than failing one.
  getDb()
    .prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(TENANT, 'orch-test');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return jobStore.createJob({
    id: crypto.randomUUID(),
    tenantId: TENANT,
    source: 'api',
    brief: 'test brief',
    ...overrides,
  } as any);
}

function makeTask(jobId: string, seq: number, dependsOn: string[] = [], id = crypto.randomUUID()): JobTask {
  return jobStore.createTask({ id, jobId, seq, title: `task${seq}`, dependsOn } as any);
}

const succeeds: TaskExecutor = async ({ task }) => ({
  ok: true,
  agentName: 'agent-a',
  summary: `did ${task.title}`,
  artifacts: ['out.ts'],
  costUsd: 1,
  tokens: 10,
});

describe('runJobPass', () => {
  let job: Job;
  beforeEach(() => {
    job = makeJob();
  });

  it('runs only the tasks whose dependencies are satisfied, one pass at a time', async () => {
    const first = makeTask(job.id, 1);
    const second = makeTask(job.id, 2, [first.id]);

    const pass1 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass1.ranTaskIds).toEqual([first.id]);

    const pass2 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass2.ranTaskIds).toEqual([second.id]);

    const pass3 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass3.state).toBe('complete');
    expect(pass3.ranTaskIds).toEqual([]);
    expect(jobStore.getJob(TENANT, job.id)?.status).toBe('delivered');
  });

  it('records a board entry per completed task and accumulates spend', async () => {
    makeTask(job.id, 1);
    await runJobPass(TENANT, job.id, succeeds);

    expect(readBoard(TENANT, job.id)).toHaveLength(1);
    expect(jobStore.getJob(TENANT, job.id)?.spentUsd).toBe(1);
  });

  it('passes a dependency board entry to the dependent task as fenced data', async () => {
    const first = makeTask(job.id, 1);
    makeTask(job.id, 2, [first.id]);
    await runJobPass(TENANT, job.id, succeeds);

    let received = '';
    await runJobPass(TENANT, job.id, async ({ boardContext }) => {
      received = boardContext;
      return { ok: true, agentName: 'agent-b', summary: 'second' };
    });

    expect(received).toContain('did task1');
    expect(received).toContain('UNTRUSTED');
  });

  // An executor that rejects must not leave the task in 'running': every
  // dependent would then wait on a task that is not actually in flight.
  it('records a thrown executor as a failed task rather than stranding it', async () => {
    const only = makeTask(job.id, 1);

    const result = await runJobPass(TENANT, job.id, async () => {
      throw new Error('kaboom');
    });

    expect(jobStore.getTask(TENANT, only.id)?.status).toBe('failed');
    expect(result.state).toBe('failed');
    expect(readBoard(TENANT, job.id)).toEqual([]);
  });

  it('charges spend for a failed task', async () => {
    makeTask(job.id, 1);
    await runJobPass(TENANT, job.id, async () => ({
      ok: false,
      agentName: 'agent-a',
      summary: '',
      error: 'nope',
      costUsd: 2,
      tokens: 5,
    }));

    expect(jobStore.getJob(TENANT, job.id)?.spentUsd).toBe(2);
  });

  // Budget is re-checked before every task; checking once per pass would let a
  // multi-task pass overrun the cap.
  it('halts the pass when the budget is exhausted', async () => {
    const budgeted = makeJob({ budgetUsd: 1 } as Partial<Job>);
    makeTask(budgeted.id, 1);
    makeTask(budgeted.id, 2);

    const first = await runJobPass(TENANT, budgeted.id, succeeds);
    expect(first.ranTaskIds).toHaveLength(1);
    expect(first.state).toBe('blocked');
    expect(first.reason).toMatch(/budget/i);

    const second = await runJobPass(TENANT, budgeted.id, succeeds);
    expect(second.ranTaskIds).toEqual([]);
  });

  it('never runs work for a cancelled job', async () => {
    makeTask(job.id, 1);
    jobStore.cancelJob(TENANT, job.id);

    const result = await runJobPass(TENANT, job.id, succeeds);
    expect(result.ranTaskIds).toEqual([]);
  });

  // A broken plan is rejected wholesale: running part of it would leave
  // half-finished work behind for a job that can never complete.
  it('fails a cyclic plan without running any task', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    makeTask(job.id, 1, [b], a);
    makeTask(job.id, 2, [a], b);

    const result = await runJobPass(TENANT, job.id, succeeds);
    expect(result.state).toBe('failed');
    expect(result.ranTaskIds).toEqual([]);
    expect(jobStore.getJob(TENANT, job.id)?.status).toBe('failed');
  });

  it('fails a plan with a dangling dependency without running any task', async () => {
    makeTask(job.id, 1, ['does-not-exist']);

    const result = await runJobPass(TENANT, job.id, succeeds);
    expect(result.state).toBe('failed');
    expect(result.ranTaskIds).toEqual([]);
  });

  // Terminal states must not be silent: a completed job carries the Receptionist's
  // structural verification in its result; a failed one gets an escalation entry.
  it('records acceptance verification on completion and escalation on failure', async () => {
    const done = makeJob({ acceptanceCriteria: ['does X'] } as Partial<Job>);
    makeTask(done.id, 1);
    await runJobPass(TENANT, done.id, succeeds);

    const finished = await runJobPass(TENANT, done.id, succeeds);
    expect(finished.state).toBe('complete');
    const result: any = jobStore.getJob(TENANT, done.id)?.result;
    expect(result?.passed).toBe(true);
    expect(result?.criteria?.[0]?.status).toBe('met');

    const broken = makeJob();
    makeTask(broken.id, 1);
    await runJobPass(TENANT, broken.id, async () => ({
      ok: false,
      agentName: 'agent-a',
      summary: '',
      error: 'nope',
    }));
    await runJobPass(TENANT, broken.id, succeeds);

    expect(jobStore.getJob(TENANT, broken.id)?.status).toBe('failed');
    const log = jobStore.getJob(TENANT, broken.id)?.decisionLog as any[];
    expect(log.at(-1)?.action).toBe('escalate_to_human');
  });

  it('reports a missing job rather than throwing', async () => {
    const result = await runJobPass(TENANT, 'no-such-job', succeeds);
    expect(result.state).toBe('failed');
    expect(result.reason).toMatch(/not found/i);
  });
});
