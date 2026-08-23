// Coordinator pre-staffing invariants, tested against the real job store:
// 1) updateTask pins assignment columns WITHOUT leaving 'pending' (assignTask
//    would flip status to 'assigned', which readyTasks never returns -> the
//    whole plan deadlocks);
// 2) an assigned task still runs and completes through runJobPass.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { jobStore, runJobPass, type TaskExecutor } from '@dmr-x/agent-runtime';

let initDb: any;
let closeDb: any;
let getDb: any;
let tmpDir: string;

const TENANT = 'tenant-coordinator-test';

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb;
  closeDb = dbMod.closeDb;
  getDb = dbMod.getDb;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-coord-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // no open handle on a cold run
  }
  await initDb();
  getDb()
    .prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(TENANT, 'coordinator-test');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('receptionist pre-staffing contract', () => {
  it('pins assignments via updateTask while keeping the task pending and runnable', async () => {
    const job = jobStore.createJob({
      id: crypto.randomUUID(),
      tenantId: TENANT,
      source: 'api',
      brief: 'test brief',
    } as any);
    const task = jobStore.createTask({
      id: crypto.randomUUID(),
      jobId: job.id,
      seq: 1,
      title: 'build the pdf extractor module',
      dependsOn: [],
    } as any);

    // What staffJobWithReceptionist does (mirrored here because the helper
    // lives inside registerJobRoutes): pin columns, keep status pending.
    jobStore.updateTask(TENANT, task.id, {
      assignedAgentDefId: 'def-123',
      assignedInstanceId: 'inst-456',
    });

    const pinned = jobStore.getTask(TENANT, task.id)!;
    expect(pinned.status).toBe('pending');
    expect(pinned.assignedAgentDefId).toBe('def-123');
    expect(pinned.assignedInstanceId).toBe('inst-456');

    // The scheduler still considers it ready (this is the deadlock guard).
    const executor: TaskExecutor = async ({ task: t }) => ({
      ok: true,
      agentName: t.assignedInstanceId ?? 'fallback',
      summary: `did ${t.title}`,
    });
    const result = await runJobPass(TENANT, job.id, executor);
    expect(result.state).toBe('complete');
    expect(result.ranTaskIds).toEqual([task.id]);
  });

  it('a task flipped to assigned by assignTask is NOT ready (documents why updateTask is required)', async () => {
    const job = jobStore.createJob({
      id: crypto.randomUUID(),
      tenantId: TENANT,
      source: 'api',
      brief: 'second brief',
    } as any);
    const task = jobStore.createTask({
      id: crypto.randomUUID(),
      jobId: job.id,
      seq: 1,
      title: 'task two',
      dependsOn: [],
    } as any);

    jobStore.assignTask(TENANT, task.id, { assignedAgentDefId: 'def-1' });

    const executor: TaskExecutor = async () => ({
      ok: true,
      agentName: 'x',
      summary: 'should not run',
    });
    const result = await runJobPass(TENANT, job.id, executor);
    // The pass must NOT have executed the assigned task.
    expect(result.ranTaskIds).toEqual([]);
  });
});
