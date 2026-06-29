import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '@dmr-x/db';
import { WorkersService } from '../../services/workers/src/workers.service.js';

describe('WorkersService', () => {
  let workersService: WorkersService;
  let db: ReturnType<typeof getDb>;

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

  it('should list workers', () => {
    workersService.register({ name: 'worker1', type: 'test' });
    workersService.register({ name: 'worker2', type: 'test' });
    
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
