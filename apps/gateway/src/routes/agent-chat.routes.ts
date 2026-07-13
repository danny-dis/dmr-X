import type { ToolCall, UnifiedRequest } from '@dmr-x/core';
import { agentRegistryService, AgentChatRequestSchema } from '@dmr-x/agent-registry';
import { agentRuntimeService } from '@dmr-x/agent-runtime';
import type { Router } from '@dmr-x/router';
import {
  generateRequestId,
  createInitialState,
  updateState,
  logger,
  type ConversationState,
} from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';

import { executeToolCall, getRegisteredToolDefinitions } from './tools.routes.js';

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

function writeSSE(
  reply: { raw: { write: (data: string) => void } },
  event: string,
  data: unknown,
): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function toUnifiedRequest(
  body: {
    model: string;
    messages: any[];
    tools?: any[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  },
  requestId: string,
  tenant?: { id: string; name: string },
): UnifiedRequest {
  return {
    modality: 'llm',
    model: body.model,
    messages: body.messages,
    tools: body.tools,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream ?? false,
    metadata: { requestId, tenant },
  };
}

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

      const messages = [...conversation.messages] as any[];
      let lastResponseText = '';
      let totalTokensUsed = 0;
      let totalCost = 0;
      const allSteps: Array<{
        turn: number;
        message: any;
        tool_calls: any[];
        tool_results: any[];
      }> = [];

      if (body.stream) {
        // ── Streaming path ──────────────────────────────────────────────
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        writeSSE(reply, 'agent_start', {
          requestId,
          agentInstanceId: instanceId,
          agentName: context.definition.name,
          model,
          conversationId: conversation.id,
        });

        try {
          for (let turn = 0; turn < maxSteps; turn++) {
            // Rebuild the system prompt each turn so the skill-capture nudge can
            // become actionable on hard turn-counter multiples of the interval.
            messages[0] = { role: 'system', content: await agentRuntimeService.buildSystemPrompt(context.definition, turn) };

            const unifiedRequest = toUnifiedRequest(
              {
                model,
                messages,
                tools: agentToolDefs,
                temperature: body.temperature,
                max_tokens: body.maxTokens,
                stream: true,
              },
              requestId,
              tenant,
            );

            const { response } = await router.route(unifiedRequest, {
              path: '/v1/agents/chat',
            });

            const toolCalls = response.message?.tool_calls ?? [];
            const responseText =
              typeof response.message?.content === 'string'
                ? response.message.content
                : '';
            lastResponseText = responseText;

            if (response.usage) {
              totalTokensUsed += response.usage.total_tokens ?? 0;
              const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
              totalCost += stepCost;
            }

            // Stop if cost budget exceeded
            if (body.max_cost_budget && totalCost >= body.max_cost_budget) {
              if (response.message) messages.push(response.message);
              conversation = updateState(conversation, { messages, status: 'completed' });
              writeSSE(reply, 'budget_exceeded', {
                conversationId: conversation.id,
                max_cost_budget: body.max_cost_budget,
                totalCost,
              });
              break;
            }

            writeSSE(reply, 'turn', {
              turn,
              conversationId: conversation.id,
              message: response.message,
              model: response.modelId,
              usage: response.usage,
              finish_reason: response.finishReason,
            });

            // Stop if no tool calls or at step limit
            if (toolCalls.length === 0 || turn === maxSteps - 1) {
              if (response.message) messages.push(response.message);
              conversation = updateState(conversation, { messages, status: 'completed' });
              break;
            }

            // Filter tool calls against agent's allowedTools
            const allowedCalls = toolCalls.filter((tc: ToolCall) =>
              agentTools.length === 0 || agentTools.includes(tc.function.name),
            );
            const blockedCalls = toolCalls.filter((tc: ToolCall) =>
              agentTools.length > 0 && !agentTools.includes(tc.function.name),
            );

            // Notify about blocked calls
            if (blockedCalls.length > 0) {
              writeSSE(reply, 'tool_blocked', {
                turn,
                blocked: blockedCalls.map((tc: ToolCall) => ({
                  name: tc.function.name,
                  reason: 'Not in agent allowedTools',
                })),
              });
            }

            // Stream tool calls
            writeSSE(reply, 'tool_calls', {
              turn,
              tool_calls: allowedCalls.map((tc: ToolCall) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })),
            });

            // Execute tool calls
            const assistantMessage = { ...response.message };
            messages.push(assistantMessage);

            const executionPromises = allowedCalls.map((tc: ToolCall) =>
              executeToolCall(tc, { requestId, tenant }),
            );

            const settled = await Promise.allSettled(executionPromises);
            const stepResults = settled
              .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
              .map((s) => s.value);

            writeSSE(reply, 'tool_results', {
              turn,
              results: stepResults,
            });

            allSteps.push({
              turn,
              message: response.message,
              tool_calls: allowedCalls,
              tool_results: stepResults,
            });

            // Add tool results to messages
            for (const tr of stepResults) {
              messages.push({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                content: tr.error
                  ? JSON.stringify({ error: tr.error.message })
                  : JSON.stringify(tr.result),
              });
            }
          }
        } catch (error) {
          logger.error({ err: error, requestId, instanceId }, 'Agent chat streaming error');
          writeSSE(reply, 'error', { error: { message: 'Request failed' } });
        }

        writeSSE(reply, 'done', {
          status: 'completed',
          conversationId: conversation.id,
          durationMs: Date.now() - startTime,
          totalTokensUsed,
          totalCost,
          budget_exceeded: !!(body.max_cost_budget && totalCost >= body.max_cost_budget),
        });
        reply.raw.end();

        // Record execution
        await agentRuntimeService.recordExecution(
          context,
          JSON.stringify(body.messages),
          lastResponseText,
          allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
          model,
          totalTokensUsed,
          0,
          Date.now() - startTime,
        );

        return reply;
      }

      // ── Non-streaming path ────────────────────────────────────────────
      for (let turn = 0; turn < maxSteps; turn++) {
        // Rebuild the system prompt each turn so the skill-capture nudge can
        // become actionable on hard turn-counter multiples of the interval.
        messages[0] = { role: 'system', content: await agentRuntimeService.buildSystemPrompt(context.definition, turn) };

        const unifiedRequest = toUnifiedRequest(
          {
            model,
            messages,
            tools: agentToolDefs,
            temperature: body.temperature,
            max_tokens: body.maxTokens,
            stream: false,
          },
          requestId,
          tenant,
        );

        const { response } = await router.route(unifiedRequest, {
          path: '/v1/agents/chat',
        });

        const toolCalls = response.message?.tool_calls ?? [];
        const responseText =
          typeof response.message?.content === 'string'
            ? response.message.content
            : '';
        lastResponseText = responseText;

        if (response.usage) {
          totalTokensUsed += response.usage.total_tokens ?? 0;
          const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
          totalCost += stepCost;
        }

        // Stop if cost budget exceeded
        if (body.max_cost_budget && totalCost >= body.max_cost_budget) {
          if (response.message) messages.push(response.message);
          conversation = updateState(conversation, { messages, status: 'completed' });

          await agentRuntimeService.recordExecution(
            context,
            JSON.stringify(body.messages),
            lastResponseText,
            allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
            model,
            totalTokensUsed,
            0,
            Date.now() - startTime,
          );

          return reply.send({
            id: requestId,
            agentInstanceId: instanceId,
            agentName: context.definition.name,
            content: responseText,
            model: response.modelId,
            usage: response.usage,
            conversationId: conversation.id,
            steps_completed: turn + 1,
            all_steps: allSteps,
            durationMs: Date.now() - startTime,
            budget_exceeded: true,
            max_cost_budget: body.max_cost_budget,
            totalCost,
          });
        }

        allSteps.push({ turn, message: response.message, tool_calls: toolCalls, tool_results: [] });

        // Stop if no tool calls or at step limit
        if (toolCalls.length === 0 || turn === maxSteps - 1) {
          if (response.message) messages.push(response.message);
          conversation = updateState(conversation, { messages, status: 'completed' });

          // Record execution
          await agentRuntimeService.recordExecution(
            context,
            JSON.stringify(body.messages),
            lastResponseText,
            allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
            model,
            totalTokensUsed,
            0,
            Date.now() - startTime,
          );

          return reply.send({
            id: requestId,
            agentInstanceId: instanceId,
            agentName: context.definition.name,
            content: responseText,
            model: response.modelId,
            usage: response.usage,
            conversationId: conversation.id,
            steps_completed: turn + 1,
            all_steps: allSteps,
            durationMs: Date.now() - startTime,
          });
        }

        // Filter tool calls against agent's allowedTools
        const allowedCalls = toolCalls.filter((tc: ToolCall) =>
          agentTools.length === 0 || agentTools.includes(tc.function.name),
        );

        // Execute tool calls
        const assistantMessage = { ...response.message };
        messages.push(assistantMessage);

        const executionPromises = allowedCalls.map((tc: ToolCall) =>
          executeToolCall(tc, { requestId, tenant }),
        );

        const settled = await Promise.allSettled(executionPromises);
        const stepResults = settled
          .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
          .map((s) => s.value);

        const lastStep = allSteps[allSteps.length - 1];
        if (lastStep) lastStep.tool_results = stepResults;

        for (const tr of stepResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tr.tool_call_id,
            content: tr.error
              ? JSON.stringify({ error: tr.error.message })
              : JSON.stringify(tr.result),
          });
        }
      }

      // Exhausted all steps
      conversation = updateState(conversation, { messages, status: 'completed' });

      await agentRuntimeService.recordExecution(
        context,
        JSON.stringify(body.messages),
        lastResponseText,
        allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
        model,
        totalTokensUsed,
        0,
        Date.now() - startTime,
      );

      return reply.send({
        id: requestId,
        agentInstanceId: instanceId,
        agentName: context.definition.name,
        content: 'Agent loop reached maximum steps.',
        model,
        conversationId: conversation.id,
        steps_completed: maxSteps,
        all_steps: allSteps,
        durationMs: Date.now() - startTime,
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
      agentRuntimeService.removeContext(requestId);
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
