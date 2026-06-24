/**
 * Advanced Workflow Engine
 * 
 * Provides advanced workflow orchestration capabilities:
 * - Parallel execution with dependency graphs
 * - Conditional branching
 * - Error handling and retry policies
 * - Variable interpolation
 * - State persistence
 */

import { logger } from '@dmr-x/utils';

export interface WorkflowStep {
  id: string;
  name: string;
  tool: string;
  input?: Record<string, any>;
  dependsOn?: string[];
  condition?: {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
    value: any;
  };
  retry?: {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier?: number;
  };
  timeout?: number;
  onError?: 'fail' | 'skip' | 'retry';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  variables?: Record<string, any>;
  timeout?: number;
  metadata?: Record<string, any>;
}

export interface WorkflowState {
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep?: string;
  startTime?: string;
  completionTime?: string;
  results: Record<string, any>;
  errors: Record<string, Error>;
  variables: Record<string, any>;
}

export interface WorkflowResult {
  success: boolean;
  state: WorkflowState;
  results: Record<string, any>;
  duration: number;
}

export class WorkflowEngine {
  private activeWorkflows: Map<string, AbortController> = new Map();
  private toolExecutor: (tool: string, input: Record<string, any>) => Promise<any>;

  constructor(
    toolExecutor: (tool: string, input: Record<string, any>) => Promise<any>
  ) {
    this.toolExecutor = toolExecutor;
  }

  /**
   * Execute a workflow definition
   */
  async execute(
    definition: WorkflowDefinition,
    options?: {
      variables?: Record<string, any>;
      timeout?: number;
    }
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeWorkflows.set(definition.id, abortController);

    const state: WorkflowState = {
      workflowId: definition.id,
      status: 'running',
      startTime: new Date().toISOString(),
      results: {},
      errors: {},
      variables: {
        ...definition.variables,
        ...options?.variables,
      },
    };

    const timeout = options?.timeout || definition.timeout || 300000;
    const timeoutId = setTimeout(() => {
      abortController.abort();
      state.status = 'failed';
      state.errors['timeout'] = new Error(`Workflow timed out after ${timeout}ms`);
    }, timeout);

    try {
      // Build execution graph
      const executionPlan = this.buildExecutionPlan(definition.steps);

      // Execute steps in order
      for (const stepGroup of executionPlan) {
        if (abortController.signal.aborted) {
          break;
        }

        // Execute steps in parallel within each group
        const results = await Promise.all(
          stepGroup.map((step) =>
            this.executeStep(step, state, abortController.signal)
          )
        );

        // Store results
        results.forEach((result, index) => {
          const step = stepGroup[index];
          state.results[step.id] = result;
        });
      }

      if (!abortController.signal.aborted) {
        state.status = 'completed';
        state.completionTime = new Date().toISOString();
      }
    } catch (error) {
      state.status = 'failed';
      state.completionTime = new Date().toISOString();
      if (error instanceof Error) {
        state.errors['workflow'] = error;
      }
    } finally {
      clearTimeout(timeoutId);
      this.activeWorkflows.delete(definition.id);
    }

    const duration = Date.now() - startTime;
    return {
      success: state.status === 'completed',
      state,
      results: state.results,
      duration,
    };
  }

  /**
   * Cancel a running workflow
   */
  cancel(workflowId: string): boolean {
    const controller = this.activeWorkflows.get(workflowId);
    if (controller) {
      controller.abort();
      this.activeWorkflows.delete(workflowId);
      return true;
    }
    return false;
  }

  /**
   * Get the status of a running workflow
   */
  getStatus(workflowId: string): WorkflowState | undefined {
    // In a real implementation, this would retrieve from persistent storage
    return undefined;
  }

  /**
   * Build execution plan from steps
   */
  private buildExecutionPlan(steps: WorkflowStep[]): WorkflowStep[][] {
    const visited = new Set<string>();
    const groups: WorkflowStep[][] = [];
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    const visit = (stepId: string, groupIndex: number) => {
      if (visited.has(stepId)) {
        return;
      }

      const step = stepMap.get(stepId);
      if (!step) {
        return;
      }

      // Ensure all dependencies are visited first
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!visited.has(dep)) {
            visit(dep, groupIndex);
          }
        }
      }

      // Add to appropriate group
      const maxDepIndex = step.dependsOn
        ? Math.max(
            ...step.dependsOn.map((dep) =>
              groups.findIndex((g) => g.some((s) => s.id === dep))
            )
          )
        : -1;

      const targetGroup = Math.max(groupIndex, maxDepIndex + 1);
      if (!groups[targetGroup]) {
        groups[targetGroup] = [];
      }

      groups[targetGroup].push(step);
      visited.add(stepId);
    };

    // Visit all steps
    steps.forEach((step, index) => visit(step.id, index));

    return groups.filter((g) => g.length > 0);
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: WorkflowStep,
    state: WorkflowState,
    signal: AbortSignal
  ): Promise<any> {
    logger.info(`Executing step ${step.id}: ${step.name}`);

    // Check condition if specified
    if (step.condition) {
      const shouldExecute = this.evaluateCondition(step.condition, state);
      if (!shouldExecute) {
        logger.info(`Skipping step ${step.id} due to condition`);
        return null;
      }
    }

    // Prepare input with variable substitution
    const input = this.substituteVariables(step.input || {}, state.variables);

    // Execute with retry logic
    const maxRetries = step.retry?.maxRetries || 0;
    const backoffMs = step.retry?.backoffMs || 1000;
    const backoffMultiplier = step.retry?.backoffMultiplier || 2;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) {
        throw new Error('Workflow cancelled');
      }

      try {
        const result = await Promise.race([
          this.toolExecutor(step.tool, input),
          this.createTimeoutPromise(step.timeout || 60000),
        ]);

        logger.info(`Step ${step.id} completed successfully`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Step ${step.id} failed (attempt ${attempt + 1}):`, lastError.message);

        if (attempt < maxRetries) {
          const backoff = backoffMs * Math.pow(backoffMultiplier, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    // Handle error based on onError policy
    if (step.onError === 'skip') {
      logger.warn(`Skipping failed step ${step.id}`);
      return null;
    }

    state.errors[step.id] = lastError!;
    throw lastError;
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(
    condition: WorkflowStep['condition'],
    state: WorkflowState
  ): boolean {
    if (!condition) {
      return true;
    }

    const value = state.variables[condition.field];
    const target = condition.value;

    switch (condition.operator) {
      case 'eq':
        return value === target;
      case 'neq':
        return value !== target;
      case 'gt':
        return value > target;
      case 'lt':
        return value < target;
      case 'gte':
        return value >= target;
      case 'lte':
        return value <= target;
      case 'in':
        return Array.isArray(target) && target.includes(value);
      case 'contains':
        return typeof value === 'string' && value.includes(target);
      default:
        return true;
    }
  }

  /**
   * Substitute variables in an object
   */
  private substituteVariables(
    obj: Record<string, any>,
    variables: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Replace ${var} patterns
        result[key] = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          return variables[varName] ?? match;
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.substituteVariables(value, variables);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Create a timeout promise
   */
  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Step timed out after ${ms}ms`));
      }, ms);
    });
  }
}
