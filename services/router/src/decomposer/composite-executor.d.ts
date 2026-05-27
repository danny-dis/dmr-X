import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import type { DecomposedTask } from './task-decomposer.js';
import type { SpecialistRouter } from './specialist-router.js';
import type { AdapterExecutor } from '../fallback/fallback-executor.js';
import type { CandidateSet } from '@dmr-x/core';
export interface CompositeResult {
    taskId: string;
    subTaskResults: Map<string, SubTaskResult>;
    aggregatedResponse: UnifiedResponse;
    executionTimeMs: number;
    modelAssignments: Map<string, string>;
}
export interface SubTaskResult {
    subTaskId: string;
    response: UnifiedResponse;
    modelId: string;
    providerId: string;
    executionTimeMs: number;
    success: boolean;
    error?: string;
}
export declare class CompositeExecutor {
    private specialistRouter;
    private adapterExecutor;
    constructor(specialistRouter: SpecialistRouter, adapterExecutor: AdapterExecutor);
    /**
     * Execute a decomposed task
     */
    execute(decomposed: DecomposedTask, candidates: CandidateSet, originalRequest: UnifiedRequest, qualityTarget?: 'frontier' | 'balanced' | 'economy'): Promise<CompositeResult>;
    /**
     * Execute sub-tasks in parallel
     */
    private executeParallel;
    /**
     * Execute sub-tasks sequentially
     */
    private executeSequential;
    /**
     * Execute a single sub-task
     */
    private executeSubTask;
    /**
     * Build a request for a sub-task
     */
    private buildSubTaskRequest;
    /**
     * Aggregate results from all sub-tasks
     */
    private aggregateResults;
    private createEmptyResponse;
}
//# sourceMappingURL=composite-executor.d.ts.map