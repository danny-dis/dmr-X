import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '@dmr-x/db';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkersService } from '../../services/workers/src/workers.service.js';

describe('WorkersService', () => {
  let workersService: WorkersService;
  let db: ReturnType<typeof getDb>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dmrx-workers-'));
    process.env.DMRX_DATA_DIR = tempDir;
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
    delete process.env.DMRX_DATA_DIR;
  });

  beforeEach(() => {
    workersService = new WorkersService();
    db = getDb();
    // Cleanup before tests
    db.prepare('DELETE FROM workers').run();
    db.prepare('DELETE FROM worker_jobs').run();
  });

  afterEach(() => {
    workersService.stop();
  });

  it('should register a worker', () => {
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    expect(worker).toBeDefined();
    expect(worker.id).toBeDefined();
    expect(worker.name).toBe('test-worker');
    expect(worker.type).toBe('test');
    expect(worker.status).toBe('active');
    expect(worker.load).toBe(0);
  });

  it('should register and list workers', () => {
    const w1 = workersService.register({ name: 'worker1', type: 'test' });
    // Second register with same hostname+pid should return existing worker (dedup)
    const w2 = workersService.register({ name: 'worker2', type: 'test' });
    expect(w2.id).toBe(w1.id); // dedup reuses the same DB record

    // Manually insert a worker with distinct hostname/pid to simulate another instance
    db.prepare(`INSERT INTO workers (id, name, type, status, hostname, pid, load, last_heartbeat_at)
                VALUES (?, ?, ?, 'active', ?, ?, 0, datetime('now'))`)
      .run('worker-2-id', 'worker2', 'test', 'different-host', '99999');

    const workers = workersService.list();
    expect(workers.length).toBe(2);
  });

  it('should drain and resume a worker', () => {
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    expect(worker.status).toBe('active');

    const drained = workersService.drain(worker.id);
    expect(drained?.status).toBe('draining');

    const resumed = workersService.resume(worker.id);
    expect(resumed?.status).toBe('active');
  });

  it('should assign and complete jobs', () => {
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    
    const job = workersService.assignJob({
      jobType: 'test-job',
      payload: JSON.stringify({ data: 'test' })
    });
    expect(job).toBeDefined();
    expect(job?.status).toBe('running');

    // Check that jobs processed was incremented
    const updatedWorker = workersService.getById(worker.id);
    expect(updatedWorker?.jobsProcessed).toBe(1);

    // Complete the job
    workersService.completeJob(job!.id);
    
    const jobs = workersService.listJobs(worker.id);
    expect(jobs[0].status).toBe('completed');
  });

  it('should calculate load based on running jobs', () => {
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    
    const job1 = workersService.assignJob({
      jobType: 'job1',
      payload: '{}'
    });
    const job2 = workersService.assignJob({
      jobType: 'job2',
      payload: '{}'
    });

    const updatedWorker = workersService.getById(worker.id);
    // 2 running jobs = 0.1 load (capped at 20)
    expect(updatedWorker?.load).toBe(0.1);

    // Complete both jobs
    workersService.completeJob(job1!.id);
    workersService.completeJob(job2!.id);

    const finalWorker = workersService.getById(worker.id);
    expect(finalWorker?.load).toBe(0);
  });

  it('should terminate a worker', () => {
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    const terminated = workersService.terminate(worker.id);
    expect(terminated).toBe(true);
  });

  it('should cleanup old jobs and workers', () => {
    // This test is a basic check since we can't easily simulate time
    const worker = workersService.register({ name: 'test-worker', type: 'test' });
    
    const job = workersService.assignJob({
      jobType: 'test-job',
      payload: '{}'
    });
    workersService.completeJob(job!.id);

    // Should not throw
    expect(() => workersService.cleanup(1)).not.toThrow();
  });
});
