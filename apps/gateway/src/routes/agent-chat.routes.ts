import type { Router } from '@dmr-x/router';
import { agentRegistryService, AgentChatRequestSchema } from '@dmr-x/agent-registry';
import { agentRuntimeService } from '@dmr-x/agent-runtime';
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
// Conversation state store (per-agent instance)
// ---------------------------------------------------------------------------

const agentConversations = new Map<string, ConversationState>();
const agentConversationLocks = new Map<string, Promise<void>>();
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const agentConversationTimestamps = new Map<string, number>();

const conversationCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of agentConversationTimestamps) {
    if (agentConversationLocks.has(id)) continue;
    if (now - ts > CONVERSATION_TTL_MS) {
      agentConversations.delete(id);
      agentConversationTimestamps.delete(id);
    }
  }
}, 60_000);
if (conversationCleanupTimer.unref) conversationCleanupTimer.unref();

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
   * - Approval gates for sensitive tool calls
   * - Conversation state persistence via conversationId
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

    const systemPrompt = await agentRuntimeService.buildSystemPrompt(context.definition, 0);
    const model = agentRuntimeService.resolveModel(context.definition);
    const agentTools = context.definition.allowedTools;
    const agentToolDefs = buildAgentTools(agentTools);

    // Acquire conversation lock. Key per-conversation (not per-instance) so
    // concurrent external agents can run the same subagent in parallel without
    // sharing one transcript. Callers may pass their own conversationId; if not,
    // a fresh per-request conversation is used (guaranteed unique via requestId).
    const convId =
      body.conversationId && body.conversationId.length > 0
        ? body.conversationId
        : `${instanceId}:${requestId}`;
    while (true) {
      const existingLock = agentConversationLocks.get(convId);
      if (!existingLock) break;
      await existingLock;
    }
    let lockResolver: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => { lockResolver = resolve; });
    agentConversationLocks.set(convId, lockPromise);
    const releaseLock = () => {
      lockResolver?.();
      if (agentConversationLocks.get(convId) === lockPromise) agentConversationLocks.delete(convId);
    };

    const startTime = Date.now();

    try {
      // Load or create conversation state
      let conversation: ConversationState;
      const existingConv = agentConversations.get(convId);
      if (existingConv) {
        conversation = updateState(existingConv, {
          messages: [...existingConv.messages, ...body.messages],
        });
        agentConversationTimestamps.set(convId, Date.now());
      } else {
        conversation = createInitialState(convId);
        conversation.messages = [
          { role: 'system', content: systemPrompt },
          ...body.messages,
        ];
        agentConversations.set(convId, conversation);
        agentConversationTimestamps.set(convId, Date.now());
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
        buildSystemPrompt: (turn) => agentRuntimeService.buildSystemPrompt(context.definition, turn),
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
        agentName: context.definition.name,
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
   * POST /agents/:instanceId/chat/:conversationId/cancel
   */
  server.post('/agents/:instanceId/chat/:conversationId/cancel', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const conversation = agentConversations.get(conversationId);
    if (!conversation) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    conversation.status = 'completed';
    agentConversations.delete(conversationId);
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
