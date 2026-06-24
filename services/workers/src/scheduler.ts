import { logger } from '@dmr-x/utils';

import { workersService, type WorkerJob } from './workers.service.js';

export interface ScheduledJob {
  id: string;
  jobType: string;
  payload: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  workerJob: WorkerJob | null;
  createdAt: string;
}

export class Scheduler {
  private pendingJobs: ScheduledJob[] = [];
  private processing = false;

  enqueue(jobType: string, payload: string): ScheduledJob {
    const job: ScheduledJob = {
      id: crypto.randomUUID(),
      jobType,
      payload,
      status: 'pending',
      workerJob: null,
      createdAt: new Date().toISOString(),
    };

    this.pendingJobs.push(job);
    this.processQueue();
    return job;
  }

  private processQueue(): void {
    if (this.processing) return;
    this.processing = true;

    while (this.pendingJobs.length > 0) {
      const job = this.pendingJobs.find(j => j.status === 'pending');
      if (!job) break;

      const workerJob = workersService.assignJob({
        jobType: job.jobType,
        payload: job.payload,
      });

      if (workerJob) {
        job.status = 'running';
        job.workerJob = workerJob;
        logger.info(`Job ${job.id} assigned to worker ${workerJob.workerId}`);
      } else {
        break;
      }
    }

    this.processing = false;
  }

  getPending(): ScheduledJob[] {
    return this.pendingJobs.filter(j => j.status === 'pending');
  }

  getStats(): { pending: number; running: number; completed: number; failed: number } {
    return {
      pending: this.pendingJobs.filter(j => j.status === 'pending').length,
      running: this.pendingJobs.filter(j => j.status === 'running').length,
      completed: this.pendingJobs.filter(j => j.status === 'completed').length,
      failed: this.pendingJobs.filter(j => j.status === 'failed').length,
    };
  }
}

export const scheduler = new Scheduler();
