import { logger } from '@dmr-x/utils';
export class CompositeExecutor {
    specialistRouter;
    adapterExecutor;
    constructor(specialistRouter, adapterExecutor) {
        this.specialistRouter = specialistRouter;
        this.adapterExecutor = adapterExecutor;
    }
    /**
     * Execute a decomposed task
     */
    async execute(decomposed, candidates, originalRequest, qualityTarget = 'balanced') {
        const start = Date.now();
        const subTaskResults = new Map();
        const modelAssignments = new Map();
        // Route all sub-tasks to specialist models
        const assignments = this.specialistRouter.routeAllSubTasks(decomposed.subTasks, candidates, qualityTarget);
        // Log assignments
        for (const [subTaskId, model] of assignments) {
            modelAssignments.set(subTaskId, `${model.providerName}/${model.modelId}`);
            logger.info({ subTaskId, provider: model.providerName, model: model.modelId }, 'Sub-task assigned to specialist');
        }
        // Execute groups in order
        for (const group of decomposed.executionPlan.groups) {
            // Check if group dependencies are satisfied
            if (group.dependsOn) {
                const allDepsMet = group.dependsOn.every((depId) => {
                    // Check if all sub-tasks in dependency group completed successfully
                    const depGroup = decomposed.executionPlan.groups.find((g) => g.id === depId);
                    return depGroup?.subTaskIds.every((id) => subTaskResults.get(id)?.success) ?? true;
                });
                if (!allDepsMet) {
                    logger.warn({ groupId: group.id }, 'Skipping group - dependencies not met');
                    continue;
                }
            }
            if (group.type === 'parallel') {
                await this.executeParallel(group, decomposed.subTasks, assignments, originalRequest, subTaskResults);
            }
            else {
                await this.executeSequential(group, decomposed.subTasks, assignments, originalRequest, subTaskResults);
            }
        }
        // Aggregate results
        const aggregatedResponse = this.aggregateResults(decomposed, subTaskResults, originalRequest);
        return {
            taskId: decomposed.id,
            subTaskResults,
            aggregatedResponse,
            executionTimeMs: Date.now() - start,
            modelAssignments,
        };
    }
    /**
     * Execute sub-tasks in parallel
     */
    async executeParallel(group, subTasks, assignments, originalRequest, results) {
        const tasks = group.subTaskIds
            .map((id) => subTasks.find((t) => t.id === id))
            .filter((t) => t !== undefined);
        const promises = tasks.map((subTask) => this.executeSubTask(subTask, assignments, originalRequest, results));
        await Promise.allSettled(promises);
    }
    /**
     * Execute sub-tasks sequentially
     */
    async executeSequential(group, subTasks, assignments, originalRequest, results) {
        for (const subTaskId of group.subTaskIds) {
            const subTask = subTasks.find((t) => t.id === subTaskId);
            if (subTask) {
                await this.executeSubTask(subTask, assignments, originalRequest, results);
            }
        }
    }
    /**
     * Execute a single sub-task
     */
    async executeSubTask(subTask, assignments, originalRequest, results) {
        const model = assignments.get(subTask.id);
        if (!model) {
            logger.warn({ subTaskId: subTask.id }, 'No model assigned for sub-task');
            results.set(subTask.id, {
                subTaskId: subTask.id,
                response: this.createEmptyResponse(),
                modelId: 'none',
                providerId: 'none',
                executionTimeMs: 0,
                success: false,
                error: 'No model assigned',
            });
            return;
        }
        const start = Date.now();
        try {
            // Build request for this sub-task
            const subTaskRequest = this.buildSubTaskRequest(subTask, originalRequest, results);
            // Execute via adapter
            const response = await this.adapterExecutor.execute(model.providerId, model.modelId, subTaskRequest);
            results.set(subTask.id, {
                subTaskId: subTask.id,
                response,
                modelId: model.modelId,
                providerId: model.providerId,
                executionTimeMs: Date.now() - start,
                success: true,
            });
            logger.info({ subTaskId: subTask.id, model: model.modelId, latencyMs: Date.now() - start }, 'Sub-task completed');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            results.set(subTask.id, {
                subTaskId: subTask.id,
                response: this.createEmptyResponse(),
                modelId: model.modelId,
                providerId: model.providerId,
                executionTimeMs: Date.now() - start,
                success: false,
                error: errorMessage,
            });
            logger.error({ err: error, subTaskId: subTask.id, model: model.modelId }, 'Sub-task failed');
        }
    }
    /**
     * Build a request for a sub-task
     */
    buildSubTaskRequest(subTask, originalRequest, previousResults) {
        // Include context from dependent sub-tasks
        const context = [];
        if (subTask.dependsOn) {
            for (const depId of subTask.dependsOn) {
                const depResult = previousResults.get(depId);
                if (depResult?.success && depResult.response.message?.content) {
                    context.push(`[${depId} result]: ${depResult.response.message.content.slice(0, 500)}`);
                }
            }
        }
        const messages = [
            ...(originalRequest.messages || []),
            {
                role: 'user',
                content: context.length > 0
                    ? `${subTask.description}\n\nContext from previous steps:\n${context.join('\n')}`
                    : subTask.description,
            },
        ];
        return {
            ...originalRequest,
            messages,
            metadata: {
                ...originalRequest.metadata,
                subTaskId: subTask.id,
                specializations: subTask.specializations,
            },
        };
    }
    /**
     * Aggregate results from all sub-tasks
     */
    aggregateResults(decomposed, results, originalRequest) {
        const successfulResults = Array.from(results.values()).filter((r) => r.success);
        const failedResults = Array.from(results.values()).filter((r) => !r.success);
        // Combine all outputs
        const combinedOutput = successfulResults
            .map((r) => {
            const header = `## ${r.subTaskId} (${r.modelId})`;
            const content = r.response.message?.content || '';
            return `${header}\n\n${content}`;
        })
            .join('\n\n---\n\n');
        // Calculate totals
        const totalLatency = Array.from(results.values()).reduce((sum, r) => sum + r.executionTimeMs, 0);
        const totalTokens = successfulResults.reduce((sum, r) => sum + (r.response.usage?.total_tokens || 0), 0);
        return {
            modality: 'llm',
            requestId: `composite_${Date.now()}`,
            providerId: 'dmr-x-composite',
            modelId: 'multi-model',
            message: {
                role: 'assistant',
                content: combinedOutput,
            },
            usage: {
                prompt_tokens: totalTokens,
                completion_tokens: 0,
                total_tokens: totalTokens,
            },
            finishReason: failedResults.length > 0 ? 'length' : 'stop',
            latencyMs: totalLatency,
            qualitySignals: [
                {
                    type: 'composite',
                    score: successfulResults.length / results.size,
                    details: {
                        totalSubTasks: results.size,
                        successful: successfulResults.length,
                        failed: failedResults.length,
                        models: Array.from(new Set(successfulResults.map((r) => r.modelId))),
                    },
                },
            ],
        };
    }
    createEmptyResponse() {
        return {
            modality: 'llm',
            requestId: `empty_${Date.now()}`,
            providerId: 'none',
            modelId: 'none',
            latencyMs: 0,
        };
    }
}
//# sourceMappingURL=composite-executor.js.map