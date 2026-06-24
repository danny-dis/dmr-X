/**
 * Workflow API Routes
 * 
 * Provides REST API endpoints for managing workflows:
 * - POST /workflows - Create and execute a workflow
 * - GET /workflows/:id - Get workflow status
 * - DELETE /workflows/:id - Cancel a running workflow
 * - POST /workflows/:id/variables - Update workflow variables
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WorkflowEngine, WorkflowDefinition, WorkflowState } from './engine';
import { logger } from '@dmr-x/utils';

// In-memory store for workflow states (in production, use database)
const workflowStates = new Map<string, WorkflowState>();

export async function workflowRoutes(
  fastify: FastifyInstance,
  options?: {
    toolExecutor?: (tool: string, input: Record<string, any>) => Promise<any>;
  }
): Promise<void> {
  const toolExecutor = options?.toolExecutor || defaultToolExecutor;
  const engine = new WorkflowEngine(toolExecutor);

  /**
   * POST /workflows - Create and execute a workflow
   */
  fastify.post('/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    const { definition, variables, timeout } = request.body as {
      definition: WorkflowDefinition;
      variables?: Record<string, any>;
      timeout?: number;
    };

    if (!definition || !definition.id || !definition.steps) {
      return reply.status(400).send({
        error: 'Invalid workflow definition',
        message: 'Workflow must have an id and steps array',
      });
    }

    logger.info(`Received workflow execution request: ${definition.id}`);

    try {
      // Start workflow execution (non-blocking)
      const resultPromise = engine.execute(definition, { variables, timeout });

      // Store initial state
      workflowStates.set(definition.id, {
        workflowId: definition.id,
        status: 'running',
        startTime: new Date().toISOString(),
        results: {},
        errors: {},
        variables: {
          ...definition.variables,
          ...variables,
        },
      });

      // Return immediately with workflow ID
      reply.status(202).send({
        workflowId: definition.id,
        status: 'accepted',
        message: 'Workflow execution started',
      });

      // Handle completion asynchronously
      resultPromise
        .then((result) => {
          workflowStates.set(definition.id, result.state);
          logger.info(`Workflow ${definition.id} completed: ${result.success}`);
        })
        .catch((error) => {
          logger.error(`Workflow ${definition.id} failed:`, error);
          workflowStates.set(definition.id, {
            workflowId: definition.id,
            status: 'failed',
            completionTime: new Date().toISOString(),
            results: {},
            errors: { workflow: error },
            variables: {},
          });
        });
    } catch (error) {
      logger.error('Failed to start workflow:', error);
      reply.status(500).send({
        error: 'Failed to start workflow',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /workflows/:id - Get workflow status
   */
  fastify.get('/workflows/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const state = workflowStates.get(id);
    if (!state) {
      return reply.status(404).send({
        error: 'Workflow not found',
        message: `No workflow found with id: ${id}`,
      });
    }

    reply.send({
      workflowId: state.workflowId,
      status: state.status,
      currentStep: state.currentStep,
      startTime: state.startTime,
      completionTime: state.completionTime,
      results: state.results,
      errors: Object.fromEntries(
        Object.entries(state.errors).map(([key, err]) => [
          key,
          err instanceof Error ? err.message : String(err),
        ])
      ),
      variables: state.variables,
    });
  });

  /**
   * DELETE /workflows/:id - Cancel a running workflow
   */
  fastify.delete('/workflows/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const state = workflowStates.get(id);
    if (!state) {
      return reply.status(404).send({
        error: 'Workflow not found',
        message: `No workflow found with id: ${id}`,
      });
    }

    if (state.status !== 'running') {
      return reply.status(400).send({
        error: 'Workflow not running',
        message: `Workflow is in state: ${state.status}`,
      });
    }

    const cancelled = engine.cancel(id);
    if (cancelled) {
      state.status = 'cancelled';
      state.completionTime = new Date().toISOString();
      workflowStates.set(id, state);

      reply.send({
        workflowId: id,
        status: 'cancelled',
        message: 'Workflow cancelled successfully',
      });
    } else {
      reply.status(500).send({
        error: 'Failed to cancel workflow',
        message: 'Could not cancel workflow',
      });
    }
  });

  /**
   * POST /workflows/:id/variables - Update workflow variables
   */
  fastify.post('/workflows/:id/variables', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { variables } = request.body as { variables: Record<string, any> };

    const state = workflowStates.get(id);
    if (!state) {
      return reply.status(404).send({
        error: 'Workflow not found',
        message: `No workflow found with id: ${id}`,
      });
    }

    if (state.status !== 'running') {
      return reply.status(400).send({
        error: 'Workflow not running',
        message: `Workflow is in state: ${state.status}`,
      });
    }

    // Update variables
    state.variables = {
      ...state.variables,
      ...variables,
    };
    workflowStates.set(id, state);

    reply.send({
      workflowId: id,
      variables: state.variables,
      message: 'Variables updated successfully',
    });
  });

  /**
   * GET /workflows - List all workflows
   */
  fastify.get('/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    const workflows = Array.from(workflowStates.values()).map((state) => ({
      workflowId: state.workflowId,
      status: state.status,
      startTime: state.startTime,
      completionTime: state.completionTime,
    }));

    reply.send({
      workflows,
      total: workflows.length,
    });
  });

  /**
   * POST /workflows/validate - Validate a workflow definition
   */
  fastify.post('/workflows/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { definition } = request.body as { definition: WorkflowDefinition };

    if (!definition) {
      return reply.status(400).send({
        error: 'No workflow definition provided',
      });
    }

    const errors = validateWorkflowDefinition(definition);
    if (errors.length > 0) {
      return reply.status(400).send({
        valid: false,
        errors,
      });
    }

    reply.send({
      valid: true,
      message: 'Workflow definition is valid',
    });
  });
}

/**
 * Validate a workflow definition
 */
function validateWorkflowDefinition(definition: WorkflowDefinition): string[] {
  const errors: string[] = [];

  if (!definition.id) {
    errors.push('Workflow must have an id');
  }

  if (!definition.name) {
    errors.push('Workflow must have a name');
  }

  if (!definition.steps || !Array.isArray(definition.steps)) {
    errors.push('Workflow must have a steps array');
    return errors;
  }

  if (definition.steps.length === 0) {
    errors.push('Workflow must have at least one step');
    return errors;
  }

  const stepIds = new Set<string>();

  for (const step of definition.steps) {
    if (!step.id) {
      errors.push('Each step must have an id');
      continue;
    }

    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
      continue;
    }
    stepIds.add(step.id);

    if (!step.name) {
      errors.push(`Step ${step.id} must have a name`);
    }

    if (!step.tool) {
      errors.push(`Step ${step.id} must specify a tool`);
    }

    // Check dependencies exist
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          // Will be checked later, but we can warn
        }
      }
    }
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (stepId: string): boolean => {
    visited.add(stepId);
    recursionStack.add(stepId);

    const step = definition.steps.find((s) => s.id === stepId);
    if (step?.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) {
            return true;
          }
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }
    }

    recursionStack.delete(stepId);
    return false;
  };

  for (const step of definition.steps) {
    if (!visited.has(step.id)) {
      if (hasCycle(step.id)) {
        errors.push('Workflow contains circular dependencies');
        break;
      }
    }
  }

  return errors;
}

/**
 * Default tool executor (placeholder)
 */
async function defaultToolExecutor(
  tool: string,
  input: Record<string, any>
): Promise<any> {
  logger.info(`Executing tool: ${tool}`, input);
  // In a real implementation, this would call the MCP server
  return {
    success: true,
    output: `Tool ${tool} executed`,
    input,
  };
}
