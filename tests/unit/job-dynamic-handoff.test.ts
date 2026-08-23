// Dynamic task handoff: the create_job_task contract, tested against the real
// job store. The tool handler itself lives inside tools.routes (gateway glue
// with HTTP deps); what matters and is locked here is the store-level contract
// it relies on:
//   1) a task created mid-run with valid deps is picked up by runJobPass;
//   2) a task created with a DANGLING dep deadlocks the job (which is exactly
//      why the handler validates deps against known ids before inserting);
//   3) a completed job's terminal state is not disturbed by late tasks.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { jobStore, runJobPass, schedulerState, type TaskExecutor } from '@dmr-x/agent-runtime';

let initDb: any;
let closeDb: any;
let getDb: any;
let tmpDir: string;

const TENANT = 'tenant-handoff-test';

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb;
  closeDb = dbMod.closeDb;
  getDb = dbMod.getDb;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-handoff-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // no open handle on a cold run
  }
  await initDb();
  getDb()
    .prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(TENANT, 'handoff-test');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeJob(): any {
  return jobStore.createJob({
    id: crypto.randomUUID(),
    tenantId: TENANT,
    source: 'api',
    brief: 'handoff test',
  });
}

function makeTask(jobId: string, seq = 1, dependsOn: string[] = []): any {
  return jobStore.createTask({
    id: crypto.randomUUID(),
    jobId,
    seq,
    title: `task${seq}`,
    dependsOn,
  });
}

const succeeds: TaskExecutor = async ({ task }) => ({
  ok: true,
  agentName: 'agent-a',
  summary: `did ${task.title}`,
});

describe('dynamic task handoff on the job board', () => {
  it('a task added DURING a run (while other work is open) is executed by a later pass', async () => {
    const job = makeJob();
    const t1 = makeTask(job.id);
    makeTask(job.id, 2, [t1.id]); // keeps the job open after pass 1

    // Pass 1 runs t1 only; "the agent" adds follow-up work mid-run, exactly
    // when create_job_task fires — the job is still running, not delivered.
    const pass1 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass1.ranTaskIds).toEqual([t1.id]);

    const spawned = makeTask(job.id, 3);

    // Pass 2 picks up BOTH the original continuation and the spawned task.
    const pass2 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass2.ranTaskIds).toHaveLength(2);
    expect(pass2.ranTaskIds).toContain(spawned.id);

    // Job completes cleanly afterwards.
    const pass3 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass3.state).toBe('complete');
    expect(jobStore.getJob(TENANT, job.id)?.status).toBe('delivered');
  });

  it('a dynamically added task with an unknown dep blocks the job (why the handler validates)', async () => {
    const job = makeJob();
    makeTask(job.id);
    await runJobPass(TENANT, job.id, succeeds);

    // The dangerous insert create_job_task refuses to do:
    jobStore.createTask({
      id: crypto.randomUUID(),
      jobId: job.id,
      seq: 2,
      title: 'doomed',
      dependsOn: ['no-such-task'],
    });

    const state = schedulerState(jobStore.listTasks(TENANT, job.id));
    expect(state.state).toBe('blocked');
    expect(state.reason).toMatch(/missing dependencies/i);
  });

  it('a dependent dynamic task waits for its dependency, then runs', async () => {
    const job = makeJob();
    const t1 = makeTask(job.id);
    makeTask(job.id, 2, [t1.id]); // original plan's tail

    await runJobPass(TENANT, job.id, succeeds);
    // Agent adds work that DEPENDS on a task added in the same handoff.
    const blocker = makeTask(job.id, 3);
    const dependent = makeTask(job.id, 4, [blocker.id]);

    // Pass 2 runs everything unblocked: the plan tail AND the blocker.
    const pass2 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass2.ranTaskIds).toContain(blocker.id);
    expect(pass2.ranTaskIds).not.toContain(dependent.id); // still waiting

    const pass3 = await runJobPass(TENANT, job.id, succeeds);
    expect(pass3.ranTaskIds).toEqual([dependent.id]);
  });
});
