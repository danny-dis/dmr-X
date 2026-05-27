import type { Specialization } from '@dmr-x/core';
import type { UnifiedRequest } from '@dmr-x/core';
/**
 * A sub-task extracted from a complex prompt
 */
export interface SubTask {
    id: string;
    description: string;
    specializations: Specialization[];
    priority: number;
    estimatedTokens: number;
    dependsOn?: string[];
    canParallel: boolean;
    modality: 'llm' | 'diffusion' | 'embedding' | 'audio_tts';
}
/**
 * Decomposed task result
 */
export interface DecomposedTask {
    id: string;
    originalPrompt: string;
    subTasks: SubTask[];
    executionPlan: ExecutionPlan;
    requiresOrchestration: boolean;
}
/**
 * Execution plan - defines parallel and sequential groups
 */
export interface ExecutionPlan {
    groups: ExecutionGroup[];
    totalEstimatedTokens: number;
    estimatedDurationMs: number;
}
export interface ExecutionGroup {
    id: string;
    type: 'parallel' | 'sequential';
    subTaskIds: string[];
    dependsOn?: string[];
}
/**
 * Task Decomposer - breaks complex prompts into sub-tasks
 *
 * Uses keyword analysis and pattern matching to identify
 * different types of work in a single prompt.
 */
export declare class TaskDecomposer {
    /**
     * Decompose a prompt into sub-tasks
     */
    decompose(request: UnifiedRequest): DecomposedTask;
    private extractPrompt;
    private createSingleTask;
    /**
     * Extract sub-tasks from a complex prompt
     */
    private extractSubTasks;
    /**
     * Build execution plan from sub-tasks
     */
    private buildExecutionPlan;
    /**
     * Detect specializations from prompt text
     */
    private detectSpecializations;
    private containsKeywords;
    private extractRelevantSection;
    private estimateTokens;
}
//# sourceMappingURL=task-decomposer.d.ts.map