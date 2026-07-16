import type { Router } from '@dmr-x/router';
import { agentRegistryService, AgentChatRequestSchema } from '@dmr-x/agent-registry';
import { agentRuntimeService, agentSessionStore } from '@dmr-x/agent-runtime';
import {
  generateRequestId,
  createInitialState,
  updateState,
  logger,
  type ConversationState,
} from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';

import { writeSSE } from '../lib/sse.js';
import { executeToolCall, getRegisteredToolDefinitions } from './tools.routes.js';
import { runAgentChatLoop } from './agent-chat-loop.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentChatBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  maxSteps?: number;
  conversationId?: string;
  max_cost_budget?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// writeSSE is imported from ../lib/sse.js

// ---------------------------------------------------------------------------
/**
 * Build the OpenAI-format `tools` array for a subagent, derived from the
 * gateway's registered tool definitions and narrowed to the agent's
 * `allowedTools`. Returns `undefined` when the agent has no allowed tools, so
 * the model is never handed an empty tool list.
 */
function buildAgentTools(allowedTools: string[]): any[] | undefined {
  if (!allowedTools || allowedTools.length === 0) return undefined;
  const defs = getRegisteredToolDefinitions(allowedTools);
  return defs.length > 0 ? defs : undefined;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function agentChatRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /agents/:instanceId/chat
   *
   * Full agentic loop for agent instances:
   * - Multi-turn tool calling with automatic execution
   * - Conversation state persisted durably (survives restarts / crashes)
   * - Load-on-demand skills (progressive disclosure via `load_skill`)
   * - Subagent delegation (isolated sessions via the `delegate` tool)
   * - Streaming and non-streaming responses
   * - Tool access filtered by agent's allowedTools
   */
  server.post('/agents/:instanceId/chat', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId } = request.params as { instanceId: string };
    const parsed = AgentChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const body = parsed.data as AgentChatBody;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const maxSteps = body.maxSteps ?? 10;

    // Load agent context
    const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
    if (!context) {
      return reply.code(404).send({ error: { message: 'Agent instance not found or inactive' } });
    }

    const definition = context.definition;
    const model = agentRuntimeService.resolveModel(definition);
    const agentTools = definition.allowedTools;
    const agentToolDefs = buildAgentTools(agentTools);

    // Acquire conversation lock. Key per-conversation (not per-instance) so
    // concurrent external agents can run the same subagent in parallel without
    // sharing one transcript. Callers may pass their own conversationId; if not,
    // a fresh per-request conversation is used (guaranteed unique via requestId).
    const convId =
      body.conversationId && body.conversationId.length > 0
        ? body.conversationId
        : `${instanceId}:${requestId}`;
    const locks = agentSessionStore.locks;
    while (locks.has(convId)) {
      await locks.get(convId)!;
    }
    let lockResolver: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => { lockResolver = resolve; });
    locks.set(convId, lockPromise);
    const releaseLock = () => {
      lockResolver?.();
      if (locks.get(convId) === lockPromise) locks.delete(convId);
    };

    const startTime = Date.now();

    try {
      // Load or create the DURABLE conversation state. This is the heart of
      // feature #1 (crash-safe, resumable agent sessions): the state lives in
      // SQLite, keyed by conversationId + tenant, not in a process Map.
      let conversation: ConversationState;
      let loadedSkillIds: string[];
      const persisted = agentSessionStore.get(tenant.id, convId);
      if (persisted) {
        conversation = persisted.state as ConversationState;
        loadedSkillIds = JSON.parse(persisted.metadata?.loadedSkillIds ?? '[]');
        conversation = updateState(conversation, {
          messages: [...conversation.messages, ...body.messages],
        });
      } else {
        const systemPrompt = await agentRuntimeService.buildSystemPrompt(definition, 0, []);
        conversation = createInitialState(convId);
        conversation.messages = [
          { role: 'system', content: systemPrompt },
          ...body.messages,
        ];
        loadedSkillIds = [];
      }

      const result = await runAgentChatLoop({
        conversation,
        maxSteps,
        model,
        agentTools,
        agentToolDefs,
        body,
        requestId,
        tenant,
        router,
        context,
        stream: body.stream === true,
        onStreamEvent: (event, data) => writeSSE(reply, event, data),
        buildSystemPrompt: (turn) =>
          agentRuntimeService.buildSystemPrompt(definition, turn, loadedSkillIds),
        agentDefinition: {
          id: definition.id,
          name: definition.name,
          tenantId: definition.tenantId,
          allowedTools: definition.allowedTools,
        },
        loadedSkillIds,
      });

      // Persist the durable session (feature #1) so it can be resumed later.
      agentSessionStore.upsert({
        tenantId: tenant.id,
        conversationId: convId,
        instanceId,
        agentDefinitionId: definition.id,
        state: conversation,
        status: result.budgetExceeded ? 'interrupted' : conversation.status,
        metadata: {
          lastResponseText: result.lastResponseText,
          totalTokensUsed: result.totalTokensUsed,
          loadedSkillIds: JSON.stringify(loadedSkillIds),
        },
      });

      // Record execution
      await agentRuntimeService.recordExecution(
        context,
        JSON.stringify(body.messages),
        result.lastResponseText,
        result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
        model,
        result.totalTokensUsed,
        0,
        Date.now() - startTime,
      );

      if (body.stream) {
        writeSSE(reply, 'done', {
          status: 'completed',
          conversationId: conversation.id,
          durationMs: Date.now() - startTime,
          totalTokensUsed: result.totalTokensUsed,
          totalCost: result.totalCost,
          budget_exceeded: result.budgetExceeded,
        });
        reply.raw.end();
        return reply;
      }

      return reply.send({
        id: requestId,
        agentInstanceId: instanceId,
        agentName: definition.name,
        content: result.lastResponseText,
        model,
        usage: result.finalUsage,
        conversationId: conversation.id,
        steps_completed: result.stepsCompleted,
        all_steps: result.allSteps,
        durationMs: Date.now() - startTime,
        ...(result.budgetExceeded
          ? { budget_exceeded: true, max_cost_budget: body.max_cost_budget, totalCost: result.totalCost }
          : {}),
        ...(loadedSkillIds.length ? { loadedSkills: loadedSkillIds } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ requestId, instanceId, error: message }, 'Agent chat failed');

      await agentRuntimeService.recordExecution(
        context,
        JSON.stringify(body.messages),
        '',
        [],
        model,
        0,
        0,
        Date.now() - startTime,
        'error',
        message,
      );

      if (body.stream) {
        writeSSE(reply, 'error', { message });
        reply.raw.end();
      } else {
        return reply.code(500).send({ error: { message } });
      }
    } finally {
      releaseLock();
    }
  });

  /**
   * POST /agents/:instanceId/chat/:conversationId/resume
   *
   * Resume a durable, interrupted, or paused agent session (feature #1).
   * Pushes the provided `messages` into the persisted conversation and runs
   * the loop again from where it left off. Used after an approval gate, a
   * human answer, or a crash recovery.
   */
  server.post('/agents/:instanceId/chat/:conversationId/resume', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId, conversationId } = request.params as {
      instanceId: string;
      conversationId: string;
    };
    const body = parsedResumeBody(request.body);
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const maxSteps = body.maxSteps ?? 10;
    const startTime = Date.now();

    const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
    if (!context) {
      return reply.code(404).send({ error: { message: 'Agent instance not found or inactive' } });
    }
    const persisted = agentSessionStore.get(tenant.id, conversationId);
    if (!persisted) {
      return reply.code(404).send({ error: { message: 'No durable session to resume' } });
    }
    const loadedSkillIds = JSON.parse(persisted.metadata?.loadedSkillIds ?? '[]');

    const conversation = updateState(persisted.state as ConversationState, {
      messages: [...persisted.state.messages, ...body.messages],
      status: 'in_progress',
    });

    const definition = context.definition;
    const model = agentRuntimeService.resolveModel(definition);
    const agentTools = definition.allowedTools;
    const agentToolDefs = buildAgentTools(agentTools);

    const result = await runAgentChatLoop({
      conversation,
      maxSteps,
      model,
      agentTools,
      agentToolDefs,
      body,
      requestId,
      tenant,
      router,
      context,
      stream: false,
      onStreamEvent: () => {},
      buildSystemPrompt: (turn) =>
        agentRuntimeService.buildSystemPrompt(definition, turn, loadedSkillIds),
      agentDefinition: {
        id: definition.id,
        name: definition.name,
        tenantId: definition.tenantId,
        allowedTools: definition.allowedTools,
      },
      loadedSkillIds,
    });

    agentSessionStore.upsert({
      tenantId: tenant.id,
      conversationId,
      instanceId,
      agentDefinitionId: definition.id,
      state: conversation,
      status: result.budgetExceeded ? 'interrupted' : conversation.status,
      metadata: {
        lastResponseText: result.lastResponseText,
        totalTokensUsed: result.totalTokensUsed,
        loadedSkillIds: JSON.stringify(loadedSkillIds),
      },
    });

    return reply.send({
      id: requestId,
      agentInstanceId: instanceId,
      agentName: definition.name,
      content: result.lastResponseText,
      model,
      usage: result.finalUsage,
      conversationId,
      steps_completed: result.stepsCompleted,
      durationMs: Date.now() - startTime,
      loadedSkills: loadedSkillIds,
      resumed: true,
    });
  });

  /**
   * GET /agents/:instanceId/sessions
   *
   * List durable sessions for an agent instance (feature #1). Lets clients
   * see which conversations can be resumed.
   */
  server.get('/agents/:instanceId/sessions', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });
    const { instanceId } = request.params as { instanceId: string };
    const sessions = agentSessionStore.listForInstance(tenant.id, instanceId);
    return reply.send({ instanceId, sessions });
  });

  /**
   * DELETE /agents/:instanceId/chat/:conversationId
   *
   * Forget a durable session.
   */
  server.delete('/agents/:instanceId/chat/:conversationId', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });
    const { conversationId } = request.params as { conversationId: string };
    agentSessionStore.delete(conversationId);
    return reply.send({ status: 'deleted', conversationId });
  });

  /**
   * POST /agents/:instanceId/chat/:conversationId/cancel
   */
  server.post('/agents/:instanceId/chat/:conversationId/cancel', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const persisted = agentSessionStore.get((request as any).tenant?.id, conversationId);
    if (!persisted) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    agentSessionStore.upsert({
      tenantId: (request as any).tenant.id,
      conversationId,
      instanceId: (persisted as any).agentInstanceId,
      agentDefinitionId: (persisted as any).agentDefinitionId,
      state: updateState(persisted.state as ConversationState, { status: 'completed' }),
      status: 'completed',
      metadata: (persisted as any).metadata ?? {},
    });
    return { status: 'cancelled', conversationId };
  });

  /**
   * GET /agents/:instanceId/stats
   */
  server.get('/agents/:instanceId/stats', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId } = request.params as { instanceId: string };
    const stats = await agentRegistryService.getExecutionStats(instanceId, tenant.id);
    return reply.send(stats);
  });

  /**
   * GET /agents/:instanceId/executions
   */
  server.get('/agents/:instanceId/executions', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId } = request.params as { instanceId: string };
    const executions = await agentRegistryService.listExecutions(instanceId, tenant.id);
    return reply.send(executions);
  });
}

function parsedResumeBody(body: unknown): AgentChatBody {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    messages: (b.messages as AgentChatBody['messages']) ?? [],
    maxSteps: (b.maxSteps as number) ?? undefined,
  } as AgentChatBody;
}
