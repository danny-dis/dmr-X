import type { ProviderModel } from '@dmr-x/core';
import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import { workersService, type WorkerJob } from '@dmr-x/workers';

import type { SubTaskResult } from './composite-executor.js';
import type { SubTask } from './task-decomposer.js';
import type { AdapterExecutor } from '../fallback/fallback-executor.js';


/**
 * WorkerPoolFanout — the "Workers" layer of the Intelligence Hierarchy.
 *
 * Wraps the in-process execution of parallel sub-tasks so each one is also
 * recorded as a `WorkerJob` via `WorkersService`. The gateway is single-process
 * so the actual inference still happens locally, but every sub-task is now
 * observable in the `workers` / `worker_jobs` SQLite tables and via the
 * `/v1/admin/workers` API.
 *
 * In a multi-process / federated deployment, this is the exact hook point
 * where a remote worker would pick up the job — the contract (`assignJob →
 * execute → completeJob`) is already in place.
 *
 * @see docs/ARCHITECTURE.md § "Intelligence Hierarchy"
 */
export class WorkerPoolFanout {
  private workerId: string | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly adapterExecutor: AdapterExecutor,
    options: { enabled?: boolean; workerName?: string } = {},
  ) {
    this.enabled = options.enabled ?? process.env.DMRX_WORKER_POOL_FANOUT === 'true';
  }

  /**
   * Lazily register this process as a worker the first time we fan out.
   * Idempotent: safe to call repeatedly.
   */
  private ensureWorker(workerName: string): string {
    if (this.workerId) return this.workerId;
    const w = workersService.register({
      name: workerName,
      type: 'router-fanout',
    });
    this.workerId = w.id;
    logger.info({ workerId: w.id, name: workerName }, 'WorkerPoolFanout registered worker');
    return w.id;
  }

  /**
   * Run a batch of sub-tasks in parallel, tracking each one as a WorkerJob.
   */
  async runParallel(
    subTasks: SubTask[],
    assignments: Map<string, ProviderModel>,
    buildRequest: (subTask: SubTask) => UnifiedRequest,
    workerName = 'router-fanout',
  ): Promise<Map<string, SubTaskResult>> {
    const results = new Map<string, SubTaskResult>();

    if (!this.enabled) {
      // Fall back to plain in-process Promise.allSettled when disabled.
      await Promise.allSettled(
        subTasks.map(async (subTask) => {
          const r = await this.executeOne(subTask, assignments, buildRequest, /* track */ false);
          results.set(subTask.id, r);
        }),
      );
      return results;
    }

    const workerId = this.ensureWorker(workerName);

    // Emit a "fan-out" observability event with the batch shape.
    logger.info(
      {
        event: 'worker_pool_fanout',
        workerId,
        subTaskCount: subTasks.length,
        subTaskIds: subTasks.map((s) => s.id),
      },
      'Fan-out: dispatching sub-tasks to worker pool',
    );

    // Assign a job per sub-task, then execute in parallel.
    const tracked = subTasks.map((subTask) => {
      const model = assignments.get(subTask.id);
      const job = this.assignJobSafe(workerId, subTask, model);
      return { subTask, model, job };
    });

    await Promise.allSettled(
      tracked.map(async ({ subTask, model, job }) => {
        if (!model) {
          results.set(subTask.id, this.emptyResult(subTask.id, 'No model assigned'));
          if (job) workersService.completeJob(job.id, 'No model assigned');
          return;
        }

        const r = await this.executeOne(subTask, assignments, buildRequest, /* track */ true);
        results.set(subTask.id, r);

        if (job) {
          workersService.completeJob(job.id, r.success ? undefined : r.error);
        }
      }),
    );

    // Emit the "fan-in" event with the result summary.
    const successful = Array.from(results.values()).filter((r) => r.success).length;
    logger.info(
      {
        event: 'worker_pool_fanin',
        workerId,
        total: results.size,
        successful,
        failed: results.size - successful,
      },
      'Fan-in: collected sub-task results',
    );

    return results;
  }

  /**
   * Execute a single sub-task (in-process). Tracks duration and result.
   */
  private async executeOne(
    subTask: SubTask,
    assignments: Map<string, ProviderModel>,
    buildRequest: (subTask: SubTask) => UnifiedRequest,
    _track: boolean,
  ): Promise<SubTaskResult> {
    const model = assignments.get(subTask.id);
    if (!model) {
      return this.emptyResult(subTask.id, 'No model assigned');
    }

    const start = Date.now();
    try {
      const subTaskRequest = buildRequest(subTask);
      const response = await this.adapterExecutor.execute(
        model.providerId,
        model.modelId,
        subTaskRequest,
      );
      return {
        subTaskId: subTask.id,
        response,
        modelId: model.modelId,
        providerId: model.providerId,
        executionTimeMs: Date.now() - start,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        { err: error, subTaskId: subTask.id, model: model.modelId },
        'WorkerPoolFanout sub-task failed',
      );
      return {
        subTaskId: subTask.id,
        response: this.createEmptyResponse(),
        modelId: model.modelId,
        providerId: model.providerId,
        executionTimeMs: Date.now() - start,
        success: false,
        error: message,
      };
    }
  }

  private assignJobSafe(
    workerId: string,
    subTask: SubTask,
    model: ProviderModel | undefined,
  ): WorkerJob | null {
    try {
      return workersService.assignJob({
        jobType: 'router.fanout',
        payload: JSON.stringify({
          subTaskId: subTask.id,
          description: subTask.description?.slice(0, 200),
          model: model ? `${model.providerId}/${model.modelId}` : null,
        }),
        preferredWorkerId: workerId,
      });
    } catch (err) {
      logger.warn({ err, subTaskId: subTask.id }, 'Failed to assign WorkerJob (continuing)');
      return null;
    }
  }

  private emptyResult(subTaskId: string, error: string): SubTaskResult {
    return {
      subTaskId,
      response: this.createEmptyResponse(),
      modelId: 'none',
      providerId: 'none',
      executionTimeMs: 0,
      success: false,
      error,
    };
  }

  private createEmptyResponse(): UnifiedResponse {
    return {
      modality: 'llm',
      requestId: `wpf_empty_${Date.now()}`,
      providerId: 'none',
      modelId: 'none',
      latencyMs: 0,
    };
  }

  /** Tear down: drain the worker so it stops accepting new jobs. */
  shutdown(): void {
    if (this.workerId) {
      workersService.drain(this.workerId);
      logger.info({ workerId: this.workerId }, 'WorkerPoolFanout drained worker');
    }
  }
}
