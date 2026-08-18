// ---------------------------------------------------------------------------
// Receptionist tool registration (gateway side)
//
// Exposes the Receptionist's orchestration tools to the `__receptionist`
// agent. The tool logic lives in services/agent-runtime (pure orchestration);
// this file is the only apps/ surface — it supplies the tenant id from the
// tool-call context and registers each tool with the gateway's tool registry
// so the agent chat loop can present it to the model and execute it.
// ---------------------------------------------------------------------------

import {
  RECEPTIONIST_TOOLS,
  getReceptionistToolHandlers,
  type ReceptionistToolContext,
} from '@dmr-x/agent-runtime';

import { registerToolHandler } from '../routes/tools.routes.js';

/**
 * Register every Receptionist tool (job_decompose, find_agents, assign_task,
 * read_job_board, request_verification, deliver_job, escalate_to_human).
 * Called once during server initialisation, alongside the built-in handlers.
 */
export function registerReceptionistToolHandlers(): void {
  const handlers = getReceptionistToolHandlers();

  for (const def of RECEPTIONIST_TOOLS) {
    registerToolHandler(
      def.name,
      async (args, context) => {
        const tenantId = context.tenant?.id;
        if (!tenantId) {
          return { error: 'tenant context missing' };
        }
        const handler = handlers[def.name];
        if (!handler) {
          return { error: `no receptionist handler registered for ${def.name}` };
        }
        const ctx: ReceptionistToolContext = { tenantId };
        try {
          return await handler(ctx, args);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
      { description: def.description, parameters: def.parameters },
    );
  }
}