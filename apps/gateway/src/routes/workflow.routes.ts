import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ValidationError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';

import { executeToolCall } from './tools.routes.js';

// ---------------------------------------------------------------------------
// Playground Workflows — a thin REST surface for the multi-step "workflow"
// capability of the Playground UI. Reuses the gateway's existing MCP tool
// execution pipeline (executeToolCall) so each workflow step is simply a tool
// call with arguments. dmrx_workflow in the full MCP server is strictly
// MCP-only; this route is the REST analogue the Playground talks to.
// ---------------------------------------------------------------------------

const WorkflowStepSchema = z.object({
  tool: z.string().min(1).max(256),
  input: z.record(z.unknown()).optional(),
  dependsOn: z.array(z.string()).optional(),
});

const RunWorkflowSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(64),
  model: z.string().optional(),
  parallel: z.boolean().optional().default(false),
});

export function registerWorkflowRoutes(server: FastifyInstance): void {
  server.post('/workflows', async (request, reply) => {
    const parsed = RunWorkflowSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid workflow request', { errors: parsed.error.errors });
    }

    const { name, steps, parallel } = parsed.data;
    const requestId = generateRequestId();
    const tenant = (request as any).tenant;
    const router = (server as any).router;

    // Note: tool availability is delegated to executeToolCall() per step, which
    // surfaces a clear error for any unregistered tool rather than failing the
    // whole workflow up-front. This lets the workflow engine drive the same
    // MCP tools the rest of the playground lists via /v1/admin/mcp/tools.

    const runStep = (step: z.infer<typeof WorkflowStepSchema>, idx: number) =>
      executeToolCall(
        { id: `step-${idx + 1}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.input ?? {}) } },
        { requestId, tenant, router, loadedSkills: [] },
      ).then((out) => ({
        id: `step-${idx + 1}`,
        tool: out.tool_name,
        status: out.error ? 'error' : 'success',
        result: out.result ?? null,
        error: out.error?.message,
      }));

    if (!parallel) {
      const results: Array<Record<string, unknown>> = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = `step-${i + 1}`;
        if (step.dependsOn?.length && !step.dependsOn.every((d) => results.some((r) => r.id === d))) {
          results.push({ id: stepId, tool: step.tool, status: 'skipped', error: 'Dependency not satisfied' });
          continue;
        }
        const out = await runStep(step, i);
        results.push(out);
        if (out.status === 'error') {
          logger.warn({ stepId, tool: step.tool }, 'Workflow step failed (stopping sequential run)');
          break;
        }
      }
      reply.status(200);
      return { id: requestId, name: name ?? 'workflow', status: 'completed', steps: results };
    }

    // Parallel execution — ignores dependsOn ordering.
    const outs = await Promise.all(steps.map((s, i) => runStep(s, i)));
    reply.status(200);
    return { id: requestId, name: name ?? 'workflow', status: 'completed', steps: outs };
  });
}
