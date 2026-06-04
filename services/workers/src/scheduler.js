import { workersService } from './workers.service.js';
import { logger } from '@dmr-x/utils';
export class Scheduler {
    pendingJobs = [];
    processing = false;
    enqueue(jobType, payload) {
        const job = {
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
    processQueue() {
        if (this.processing)
            return;
        this.processing = true;
        while (this.pendingJobs.length > 0) {
            const job = this.pendingJobs.find(j => j.status === 'pending');
            if (!job)
                break;
            const workerJob = workersService.assignJob({
                jobType: job.jobType,
                payload: job.payload,
            });
            if (workerJob) {
                job.status = 'running';
                job.workerJob = workerJob;
                logger.info(`Job ${job.id} assigned to worker ${workerJob.workerId}`);
            }
            else {
                break;
            }
        }
        this.processing = false;
    }
    getPending() {
        return this.pendingJobs.filter(j => j.status === 'pending');
    }
    getStats() {
        return {
            pending: this.pendingJobs.filter(j => j.status === 'pending').length,
            running: this.pendingJobs.filter(j => j.status === 'running').length,
            completed: this.pendingJobs.filter(j => j.status === 'completed').length,
            failed: this.pendingJobs.filter(j => j.status === 'failed').length,
        };
    }
}
export const scheduler = new Scheduler();
//# sourceMappingURL=scheduler.js.map