import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { agentRegistryService } from '../../services/agent-registry/src/agent-registry.service.js';
import { AgentScheduler } from '../../services/agent-runtime/src/agent-scheduler.js';

let tmpDir: string;

function gatewayOk(output = 'scheduled-ok') {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ content: output }),
  }) as any);
}

async function seedDefinition(tenantId: string, name: string) {
  const def = await agentRegistryService.createDefinition(tenantId, { name });
  if (!def) throw new Error('createDefinition returned null');
  return def;
}

/** Register a job and force it due by rewriting its next_run_at (DB + memory). */
function forceDue(scheduler: AgentScheduler, jobId: string, pastIso: string) {
  const job = (scheduler as any).jobs.get(jobId);
  if (!job) throw new Error(`job ${jobId} not in scheduler memory`);
  getDb().prepare('UPDATE agent_scheduled_jobs SET next_run_at = ? WHERE id = ?').run(pastIso, jobId);
  job.nextRunAt = new Date(pastIso);
  return job;
}

function jobRow(jobId: string): any {
  return getDb().prepare('SELECT * FROM agent_scheduled_jobs WHERE id = ?').get(jobId) as any;
}

function executionsForInstance(instanceId: string): any[] {
  return getDb()
    .prepare('SELECT * FROM agent_executions WHERE agent_instance_id = ? ORDER BY created_at')
    .all(instanceId) as any[];
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-sched-occ-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // first run
  }
  await initDb();
  vi.unstubAllGlobals();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  try {
    await closeDb();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('scheduled occurrence identity and crash-safe claim', () => {
  it('claims AND advances next_run_at atomically, and tags the gateway call with the occurrence key', async () => {
    const fetchMock = gatewayOk();
    vi.stubGlobal('fetch', fetchMock);

    const def = await seedDefinition('tenant-1', 'sched-agent');
    const scheduler = new AgentScheduler();
    try {
      scheduler.registerJob(def.id, 'tenant-1', '* * * * *', { prompt: 'tick' });
      const jobId = scheduler.getJobs()[0].id;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const job = forceDue(scheduler, jobId, pastIso);

      await (scheduler as any).executeJob(job);

      const expectedKey = `${jobId}:${pastIso}`;
      // One execution recorded for exactly this occurrence.
      const rows = executionsForInstance(job.agentInstanceId);
      expect(rows).toHaveLength(1);
      expect(rows[0].occurrence_key).toBe(expectedKey);
      // The schedule already advanced past the claimed fire — a crash after
      // the gateway call cannot refire the same occurrence.
      expect(jobRow(jobId).next_run_at).not.toBe(pastIso);
      expect(jobRow(jobId).last_occurrence_key).toBe(expectedKey);
      // The occurrence key travelled into the side-effecting call.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/v1/agents/');
      expect(init.headers['x-dmrx-occurrence-key']).toBe(expectedKey);
      const sentBody = JSON.parse(init.body);
      expect(sentBody.metadata.occurrenceKey).toBe(expectedKey);
    } finally {
      scheduler.stop();
    }
  });

  it('duplicate concurrent dispatch of one due fire produces a single execution', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ content: 'x' }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const def = await seedDefinition('tenant-1', 'sched-agent');
    const scheduler = new AgentScheduler();
    try {
      scheduler.registerJob(def.id, 'tenant-1', '* * * * *', { prompt: 'tick' });
      const jobId = scheduler.getJobs()[0].id;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const job = forceDue(scheduler, jobId, pastIso);

      const first = (scheduler as any).executeJob(job);
      // Let the first claim land before the duplicate arrives.
      await new Promise((r) => setTimeout(r, 25));
      await (scheduler as any).executeJob(job);
      releaseGate();
      await first;

      const rows = executionsForInstance(job.agentInstanceId);
      expect(rows).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
    }
  });

  it('restart after a claimed fire does not refire the same occurrence', async () => {
    const fetchMock = gatewayOk();
    vi.stubGlobal('fetch', fetchMock);

    const def = await seedDefinition('tenant-1', 'sched-agent');
    const scheduler = new AgentScheduler();
    let jobId: string;
    let occurrenceKey: string;
    try {
      scheduler.registerJob(def.id, 'tenant-1', '* * * * *', { prompt: 'tick' });
      jobId = scheduler.getJobs()[0].id;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const job = forceDue(scheduler, jobId, pastIso);
      occurrenceKey = `${jobId}:${pastIso}`;
      await (scheduler as any).executeJob(job);
    } finally {
      scheduler.stop();
    }

    // Simulate a gateway restart: brand-new scheduler, persisted state only.
    const restarted = new AgentScheduler();
    try {
      restarted.start();
      const reloaded = restarted.getJobs();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].lastOccurrenceKey).toBe(occurrenceKey);
      fetchMock.mockClear();
      await (restarted as any).checkAndRun();
      expect(fetchMock).not.toHaveBeenCalled();
      const rows = getDb()
        .prepare('SELECT * FROM agent_executions WHERE occurrence_key = ?')
        .all(occurrenceKey) as any[];
      expect(rows).toHaveLength(1);
    } finally {
      restarted.stop();
    }
  });

  it('a failed gateway call still records the occurrence so it is never silently retried', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('gateway down');
    }));

    const def = await seedDefinition('tenant-1', 'sched-agent');
    const scheduler = new AgentScheduler();
    try {
      scheduler.registerJob(def.id, 'tenant-1', '* * * * *', { prompt: 'tick' });
      const jobId = scheduler.getJobs()[0].id;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const job = forceDue(scheduler, jobId, pastIso);
      await (scheduler as any).executeJob(job);

      const rows = executionsForInstance(job.agentInstanceId);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('error');
      expect(rows[0].occurrence_key).toBe(`${jobId}:${pastIso}`);
      // Advancement happened despite the failure: at-most-once per occurrence.
      expect(jobRow(jobId).next_run_at).not.toBe(pastIso);
    } finally {
      scheduler.stop();
    }
  });

  it('skips the gateway call when this occurrence was already recorded (duplicate delivery)', async () => {
    const fetchMock = gatewayOk();
    vi.stubGlobal('fetch', fetchMock);

    const def = await seedDefinition('tenant-1', 'sched-agent');
    const instance = await agentRegistryService.createInstance('tenant-1', {
      agentDefinitionId: def.id,
      configOverride: {},
      runtimeMode: 'persistent',
      accessScope: 'private',
    });
    if (!instance) throw new Error('createInstance returned null');

    const scheduler = new AgentScheduler();
    try {
      scheduler.registerJob(def.id, 'tenant-1', '* * * * *', {
        prompt: 'tick',
        agentInstanceId: instance.id,
      });
      const jobId = scheduler.getJobs()[0].id;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const occurrenceKey = `${jobId}:${pastIso}`;
      await agentRegistryService.recordExecution({
        agentInstanceId: instance.id,
        tenantId: 'tenant-1',
        input: 'tick',
        output: 'already-done',
        status: 'success',
        occurrenceKey,
      });
      const job = forceDue(scheduler, jobId, pastIso);
      await (scheduler as any).executeJob(job);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(executionsForInstance(instance.id)).toHaveLength(1);
    } finally {
      scheduler.stop();
    }
  });
});
