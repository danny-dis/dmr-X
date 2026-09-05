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

import crypto from 'crypto';

import { writeSSE } from '../lib/sse.js';
import { getRegisteredToolDefinitions, normalizeAllowedTools, cleanupSandboxDir } from './tools.routes.js';
import { runAgentChatLoop } from './agent-chat-loop.js';
import { parseQualityTarget } from '../utils/quality-target.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentChatBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  maxSteps?: number;
  model?: string;
  conversationId?: string;
  max_cost_budget?: number;
  stopWhen?: Array<{ type: string; value: number | string }>;
  approvalRequired?: boolean;
  approvalDecisions?: Array<{ tool_call_id: string; approved: boolean; result?: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// writeSSE is imported from ../lib/sse.js

// ---------------------------------------------------------------------------
/**
 * Build the OpenAI-format `tools` array for a subagent, derived from the
 * gateway's registered tool definitions and narrowed to the agent's
 * `allowedTools`. When the agent lists no tools, the FULL registered standard
 * set is used ("tools always on"): an absent/empty allowedTools means "give the
 * agent everything", not "tool-less". An explicit non-empty list narrows.
 *
 * Unresolvable names are SKIPPED by getRegisteredToolDefinitions() and were
 * previously dropped in complete silence, which hid a real capability gap:
 * 16 of the 17 agents that restrict their tools ask for `WebFetch`/`WebSearch`,
 * and NEITHER exists in the registry (nor does any equivalent — the only
 * web-ish entries are MCP agent wrappers and `search_files`, which searches the
 * local filesystem). Those agents therefore ran with file tools only. A
 * "Trend Researcher" with no way to reach the web still answers confidently
 * from model priors, so nothing looked broken.
 *
 * We cannot invent the capability here, so the next best thing is to make the
 * gap LOUD: log exactly which requested tools did not resolve, and surface the
 * count so the caller can act. Callers keep the resolvable subset — narrowing
 * behaviour is unchanged, so this is observability, not a behaviour change.
 */
function buildAgentTools(
  allowedTools: unknown,
  agentName?: string,
): { defs: any[] | undefined; missing: string[] } {
  const names = normalizeAllowedTools(allowedTools);
  const defs =
    names.length === 0
      ? getRegisteredToolDefinitions()
      : getRegisteredToolDefinitions(names);

  // Only an EXPLICIT list can go unresolved; the empty case asks for whatever
  // is registered, so by definition nothing is missing there.
  let missing: string[] = [];
  if (names.length > 0) {
    const resolved = new Set(defs.map((d) => d?.function?.name).filter(Boolean));
    missing = names.filter((n) => !resolved.has(n));
    if (missing.length > 0) {
      logger.warn(
        {
          agent: agentName,
          requested: names.length,
          resolved: resolved.size,
          missing,
        },
        'agent requested tools that are not registered — it will run WITHOUT them',
      );
    }
  }

  return { defs: defs.length > 0 ? defs : undefined, missing };
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
    const model = body.model ?? agentRuntimeService.resolveModel(definition);
    const agentTools = normalizeAllowedTools(definition.allowedTools);
    const { defs: agentToolDefs } = buildAgentTools(agentTools, definition.name);

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
          allowedTools: agentTools,
        },
        godmodeWrap: definition.godmodeWrap === true,
        loadedSkillIds,
        runtime: agentRuntimeService,
        conversationId: convId,
        onCheckpoint: (turn, conversation) => {
          agentSessionStore.upsert({
            tenantId: tenant.id,
            conversationId: convId,
            instanceId,
            agentDefinitionId: definition.id,
            state: conversation,
            status: 'in_progress',
            lastTurn: turn,
            metadata: {
              loadedSkillIds: JSON.stringify(loadedSkillIds),
              totalTokensUsed: 0,
            },
          });
        },
        stopWhen: body.stopWhen,
        approvalRequired: body.approvalRequired,
        approvalDecisions: body.approvalDecisions,
        qualityTarget: parseQualityTarget(request.headers['x-quality-target'] as string),
      });

      agentSessionStore.upsert({
        tenantId: tenant.id,
        conversationId: convId,
        instanceId,
        agentDefinitionId: definition.id,
        state: conversation,
        status: result.awaitingApproval
          ? 'awaiting_approval'
          : result.budgetExceeded
            ? 'interrupted'
            : conversation.status,
        metadata: {
          lastResponseText: result.lastResponseText,
          totalTokensUsed: result.totalTokensUsed,
          loadedSkillIds: JSON.stringify(loadedSkillIds),
        },
      });

      agentSessionStore.persistRunSteps(tenant.id, convId, result.allSteps.map((step) => ({
        turn: step.turn,
        status: 'ok',
        budgetStatus: result.budgetExceeded ? 'exceeded' : 'within',
        allowedToolCallNames: step.tool_calls.map((tc) => tc.function?.name ?? tc.name),
        blockedToolCallNames: [],
        toolResults: step.tool_results,
        tokenDelta: (step.message as any)?.usage?.total_tokens ?? 0,
        costDelta: (step.message as any)?.usage?.cost ?? (step.message as any)?.usage?.total_cost ?? 0,
      })));

      const executionRecord = await agentRuntimeService.createExecution(
        context,
        JSON.stringify(body.messages),
        result.lastResponseText,
        result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
        model,
        result.totalTokensUsed,
        0,
        Date.now() - startTime,
      );
      // Persist an evaluation record linked to this execution so the
      // /evaluations endpoint has data to serve.
      // Use the latest execution's ID since recordExecution returns void.
      let evalId: string | undefined;
      if (executionRecord?.id) {
        evalId = executionRecord.id;
      } else {
        // Fallback: get the most recent execution for this instance
        const latestExec = agentRegistryService.getLatestExecution(context.instanceId, context.tenantId);
        evalId = latestExec?.id;
      }
      if (evalId) {
        try {
          await agentRuntimeService.evaluateExecution(
            context,
            {
              id: evalId,
              output: result.lastResponseText,
              toolsUsed: result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
              inputTokens: result.totalTokensUsed,
              outputTokens: 0,
              durationMs: Date.now() - startTime,
              status: result.budgetExceeded ? 'error' : 'success',
              error: result.budgetExceeded ? 'budget_exceeded' : null,
            },
            result.allSteps,
            maxSteps,
          );
        } catch (evaluationError) {
          logger.warn({ executionId: evalId, error: evaluationError }, 'failed_to_evaluate_execution');
        }
      }


      if (body.stream) {
        writeSSE(reply, 'done', {
          status: result.awaitingApproval ? 'awaiting_approval' : 'completed',
          conversationId: conversation.id,
          durationMs: Date.now() - startTime,
          totalTokensUsed: result.totalTokensUsed,
          totalCost: result.totalCost,
          budget_exceeded: result.budgetExceeded,
          ...(result.awaitingApproval
            ? { pending_tool_calls: conversation.pendingToolCalls ?? [] }
            : {}),
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
        // finalUsage is only the last step. The loop accumulates across every
        // step, and a caller metering a multi-step run (a job charging spend
        // against a budget, say) needs the totals, not the tail.
        totalTokens: result.totalTokensUsed,
        costUsd: result.totalCost,
        conversationId: conversation.id,
        steps_completed: result.stepsCompleted,
        all_steps: result.allSteps,
        durationMs: Date.now() - startTime,
        ...(result.awaitingApproval
          ? { status: 'awaiting_approval', pending_tool_calls: conversation.pendingToolCalls ?? [] }
          : {}),
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

    // Serialize against any other request (a concurrent /chat call or another
    // /resume) touching the same conversationId. This was already required to
    // avoid racing the durable ConversationState; it now ALSO protects the
    // coding-tool sandbox, which is keyed on conversationId (see
    // tools.routes.ts resolveSandboxDir) so all turns of a session share one
    // workspace directory. Without this lock, two overlapping requests for
    // the same conversation could interleave reads/writes to that shared
    // directory. Requests for DIFFERENT conversations are unaffected — each
    // conversationId gets its own lock key and its own workspace directory.
    const locks = agentSessionStore.locks;
    while (locks.has(conversationId)) {
      await locks.get(conversationId)!;
    }
    let lockResolver: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => { lockResolver = resolve; });
    locks.set(conversationId, lockPromise);
    const releaseLock = () => {
      lockResolver?.();
      if (locks.get(conversationId) === lockPromise) locks.delete(conversationId);
    };

    try {
      const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
      if (!context) {
        return reply.code(404).send({ error: { message: 'Agent instance not found or inactive' } });
      }
      const persisted = agentSessionStore.get(tenant.id, conversationId);
      if (!persisted) {
        return reply.code(404).send({ error: { message: 'No durable session to resume' } });
      }
      const loadedSkillIds = JSON.parse(persisted.metadata?.loadedSkillIds ?? '[]');

      // Keep `awaiting_approval` when the caller is answering an approval
      // prompt. processApprovalDecisions() refuses to act on any other status,
      // so forcing 'in_progress' here made every approval a no-op: the resume
      // reported success, the approved tool never ran, and the unanswered
      // tool_calls message was resent to the provider on the next turn.
      const hasApprovalDecisions = (body.approvalDecisions?.length ?? 0) > 0;
      const persistedState = persisted.state as ConversationState;
      const conversation = updateState(persistedState, {
        messages: [...persistedState.messages, ...body.messages],
        status:
          hasApprovalDecisions && persistedState.status === 'awaiting_approval'
            ? 'awaiting_approval'
            : 'in_progress',
      });

      const definition = context.definition;
      const model = body.model ?? agentRuntimeService.resolveModel(definition);
      const agentTools = normalizeAllowedTools(definition.allowedTools);
      const { defs: agentToolDefs } = buildAgentTools(agentTools, definition.name);

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
          allowedTools: agentTools,
        },
        godmodeWrap: definition.godmodeWrap === true,
        loadedSkillIds,
        runtime: agentRuntimeService,
        conversationId,
        onCheckpoint: (turn, conversation) => {
          agentSessionStore.upsert({
            tenantId: tenant.id,
            conversationId,
            instanceId,
            agentDefinitionId: definition.id,
            state: conversation,
            status: 'in_progress',
            lastTurn: turn,
            metadata: {
              loadedSkillIds: JSON.stringify(loadedSkillIds),
              totalTokensUsed: 0,
            },
          });
        },
        stopWhen: body.stopWhen,
        approvalRequired: body.approvalRequired,
        approvalDecisions: body.approvalDecisions,
        qualityTarget: parseQualityTarget(request.headers['x-quality-target'] as string),
      });

      agentSessionStore.upsert({
        tenantId: tenant.id,
        conversationId,
        instanceId,
        agentDefinitionId: definition.id,
        state: conversation,
        status: result.awaitingApproval
          ? 'awaiting_approval'
          : result.budgetExceeded
            ? 'interrupted'
            : conversation.status,
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
        totalTokens: result.totalTokensUsed,
        costUsd: result.totalCost,
        conversationId,
        steps_completed: result.stepsCompleted,
        durationMs: Date.now() - startTime,
        loadedSkills: loadedSkillIds,
        resumed: true,
        ...(result.awaitingApproval
          ? { status: 'awaiting_approval', pending_tool_calls: conversation.pendingToolCalls ?? [] }
          : {}),
      });
    } finally {
      releaseLock();
    }
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
   * Forget a durable session. Also reclaims the conversation's on-disk coding
   * sandbox (apps/gateway/src/routes/tools.routes.ts keys the workspace on
   * conversationId), since deletion is the one point where we know for
   * certain the workspace will never be read again — unlike a plain
   * cancel/timeout, which may still be resumed later.
   */
  server.delete('/agents/:instanceId/chat/:conversationId', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });
    const { conversationId } = request.params as { conversationId: string };
    agentSessionStore.delete(conversationId);
    cleanupSandboxDir(tenant.id, conversationId);
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

  /**
   * POST /agents/:instanceId/analyze
   *
   * Analyze a completed conversation transcript for skill-capture opportunities.
   * Returns suggested skills that could be captured from repeated workflows,
   * tool usage patterns, and reusable response templates.
   */
  server.post('/agents/:instanceId/analyze', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId } = request.params as { instanceId: string };
    const body = (request.body ?? {}) as { conversationId?: string; messages?: any[] };

    // Get messages from conversation or request body
    let messages = body.messages ?? [];
    if (body.conversationId && messages.length === 0) {
      const session = agentSessionStore.get(tenant.id, body.conversationId);
      if (session) {
        messages = session.state?.messages ?? [];
      }
    }

    if (messages.length === 0) {
      return reply.code(400).send({ error: { message: 'No messages to analyze' } });
    }

    const { analyzeTranscript } = await import('@dmr-x/agent-runtime');
    const analysis = analyzeTranscript(messages, []);

    return reply.send(analysis);
  });
}

function parsedResumeBody(body: unknown): AgentChatBody {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    messages: (b.messages as AgentChatBody['messages']) ?? [],
    maxSteps: (b.maxSteps as number) ?? undefined,
    stopWhen: (b.stopWhen as AgentChatBody['stopWhen']) ?? undefined,
    approvalRequired: (b.approvalRequired as boolean) ?? undefined,
    approvalDecisions: (b.approvalDecisions as AgentChatBody['approvalDecisions']) ?? undefined,
    max_cost_budget: (b.max_cost_budget as number) ?? undefined,
    temperature: (b.temperature as number) ?? undefined,
    maxTokens: (b.maxTokens as number) ?? undefined,
    stream: (b.stream as boolean) ?? undefined,
    conversationId: (b.conversationId as string) ?? undefined,
  } as AgentChatBody;
}
