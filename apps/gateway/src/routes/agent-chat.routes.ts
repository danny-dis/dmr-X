import type { Router } from '@dmr-x/router';
import { resolveMetaModel } from '@dmr-x/router';
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

import { billingService } from '@dmr-x/billing';
import { writeSSE } from '../lib/sse.js';
import {
  resolveAgentModel,
  clampAgentSteps,
  clampAgentTokens,
  estimateAgentRunTokens,
  aliasFreeEvidence,
  resolveAgentToolCatalog,
  preflightModelRun,
  releaseAgentHold,
  settleAgentRun,
} from '../lib/agent-admission.js';
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
 * Resolve the effective tool catalog for an agent definition.
 *
 * An absent/empty allowedTools still means "everything registered"
 * ("tools always on"). An explicit non-empty list is REQUIRED by default:
 * names that do not resolve fail the invocation closed (400) with the
 * resolved/missing catalog, instead of running with a silently narrowed
 * subset. The `optional:` prefix (or trailing `?`) marks a best-effort
 * capability whose absence only warns.
 */
function resolveAgentToolsOrReject(
  allowedTools: unknown,
  agentName?: string,
):
  | { ok: true; defs: any[] | undefined; agentTools: string[]; missing: string[] }
  | { ok: false; missing: string[]; requiredMissing: string[]; resolved: string[] } {
  const names = normalizeAllowedTools(allowedTools);
  const catalog = resolveAgentToolCatalog(names, (wanted) =>
    wanted && wanted.length > 0 ? getRegisteredToolDefinitions(wanted) : getRegisteredToolDefinitions(),
  );
  if (catalog.requiredMissing.length > 0) {
    logger.warn(
      {
        agent: agentName,
        requested: names.length,
        resolved: catalog.resolved.length,
        missing: catalog.missing,
        requiredMissing: catalog.requiredMissing,
      },
      'agent requested required tools that are not registered — failing closed',
    );
    return {
      ok: false,
      missing: catalog.missing,
      requiredMissing: catalog.requiredMissing,
      resolved: catalog.resolved,
    };
  }
  if (catalog.missing.length > 0) {
    logger.warn(
      {
        agent: agentName,
        requested: names.length,
        resolved: catalog.resolved.length,
        missing: catalog.missing,
      },
      'agent requested optional tools that are not registered — continuing with the resolvable subset',
    );
  }
  return { ok: true, defs: catalog.defs.length > 0 ? catalog.defs : undefined, agentTools: catalog.resolved, missing: catalog.missing };
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
    // Finite server-side turn cap: client input can only narrow, never widen.
    const maxSteps = clampAgentSteps(body.maxSteps);
    const clampedMaxTokens = clampAgentTokens(body.maxTokens);

    // Load agent context
    const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
    if (!context) {
      return reply.code(404).send({ error: { message: 'Agent instance not found or inactive' } });
    }

    const definition = context.definition;
    const requestedConversationId =
      body.conversationId && body.conversationId.length > 0 ? body.conversationId : undefined;
    const convId = requestedConversationId ?? `${instanceId}:${requestId}`;
    const claim = agentSessionStore.claim({
      tenantId: tenant.id,
      conversationId: convId,
      instanceId: context.instanceId,
      agentDefinitionId: definition.id,
    });
    if (claim.outcome === 'conflict') {
      return reply.code(404).send({ error: { message: 'Conversation not found' } });
    }
    const isNewClaim = claim.outcome === 'claimed';
    void isNewClaim;

    // Policy-authorized model overrides only: a caller-supplied model outside
    // the agent policy fails closed instead of routing unapproved spend.
    const modelDecision = resolveAgentModel(body.model, definition, () =>
      agentRuntimeService.resolveModel(definition),
    );
    if (modelDecision.error) {
      return reply.code(modelDecision.status ?? 403).send({ error: { message: modelDecision.error } });
    }
    const model = modelDecision.model;
    const toolDecision = resolveAgentToolsOrReject(definition.allowedTools, definition.name);
    if (!toolDecision.ok) {
      return reply.code(400).send({
        error: {
          message: `Agent requires tools that are not registered: ${toolDecision.requiredMissing.join(', ')}`,
          missing: toolDecision.missing,
          requiredMissing: toolDecision.requiredMissing,
          resolved: toolDecision.resolved,
        },
      });
    }
    const agentTools = toolDecision.agentTools;
    const agentToolDefs = toolDecision.defs;

    // Preflight admission with an ATOMIC whole-run reserve (SEC-002):
    // the estimate covers the full multi-turn budget (per-turn cap x
    // maxSteps), unknown pricing fails closed (402) before any quota touch,
    // and bare aliases admit only with router evidence of a free-only
    // resolution (SEC-001). The hold is released on failure paths below and
    // reconciled with measured actuals after the loop.
    let holdId: string | undefined;
    let admissionFreeOnly = false;
    {
      const estimatedTokens = estimateAgentRunTokens(clampedMaxTokens, maxSteps);
      const preflight = await preflightModelRun({
        model,
        estimatedTokens,
        maxSteps,
        tenantId: tenant.id,
        requestId,
        getPricing: (providerId, modelId) => billingService.getModelPricing(providerId, modelId),
        resolveAliasFree: aliasFreeEvidence(model, () => router.getCandidates(), (alias, cands) =>
          resolveMetaModel(alias, cands as any, 'free'),
        ),
        quotaService: (server as any).quotaService,
      });
      if (!preflight.admitted) {
        const status = preflight.status === 402 ? 402 : 429;
        return reply.code(status).send({ error: { message: preflight.reason } });
      }
      holdId = preflight.admitted ? preflight.holdId : undefined;
      // Bind the admission proof to every turn: a zero-cost alias admission
      // must never be routed to a paid candidate.
      admissionFreeOnly = preflight.freeOnly === true;
    }

    // Acquire conversation lock. Key per-conversation (not per-instance) so
    // concurrent external agents can run the same subagent in parallel without
    // sharing one transcript. Callers may pass their own conversationId; if not,
    // a fresh per-request conversation is used (guaranteed unique via requestId).
    // Reuses the pre-admission requestedConversationId so the id admitted and
    // the id locked/loaded cannot drift apart.
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
        if (
          persisted.agentInstanceId !== context.instanceId ||
          persisted.agentDefinitionId !== definition.id
        ) {
          await releaseAgentHold((server as any).quotaService, holdId);
          return reply.code(404).send({ error: { message: 'Conversation not found' } });
        }
        conversation = persisted.state as ConversationState;
        loadedSkillIds = JSON.parse(persisted.metadata?.loadedSkillIds ?? '[]');
        conversation = updateState(conversation, {
          messages: [...conversation.messages, ...body.messages],
        });
      } else {
        const systemPrompt = await agentRuntimeService.buildSystemPrompt(definition, 0, [], tenant.id);
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
        body: { ...body, maxTokens: clampedMaxTokens },
        requestId,
        tenant,
        router,
        context,
        stream: body.stream === true,
        onStreamEvent: (event, data) => writeSSE(reply, event, data),
        buildSystemPrompt: (turn) =>
          agentRuntimeService.buildSystemPrompt(definition, turn, loadedSkillIds, tenant.id),
        agentDefinition: {
          id: definition.id,
          name: definition.name,
          tenantId: definition.tenantId,
          allowedTools: agentTools,
        },
        godmodeWrap: definition.godmodeWrap === true,
        freeOnly: admissionFreeOnly,
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
        holdId,
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

      // Settle ACTUAL measured prompt/completion usage against the preflight
      // hold (reconciled once — never estimate + actual double count), then
      // persist the same split in the execution record — never (total, 0).
      const settled = await settleAgentRun({
        tenantId: tenant.id,
        model,
        allSteps: result.allSteps as any,
        requestId,
        sums: {
          promptTokens: result.totalPromptTokens,
          completionTokens: result.totalCompletionTokens,
          totalTokens: result.totalTokensUsed,
          cost: result.totalCost,
        },
        holdId,
        quotaService: (server as any).quotaService,
        billingService,
      });
      holdId = undefined;
      const executionRecord = await agentRuntimeService.createExecution(
        context,
        JSON.stringify(body.messages),
        result.lastResponseText,
        result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
        model,
        settled.promptTokens,
        settled.completionTokens,
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
        const recentExecs = await agentRegistryService.listExecutions(context.instanceId, context.tenantId, 1);
        evalId = recentExecs[0]?.id;
      }
      if (evalId) {
        try {
          await agentRuntimeService.evaluateExecution(
            context,
            {
              id: evalId,
              output: result.lastResponseText,
              toolsUsed: result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
              inputTokens: settled.promptTokens,
              outputTokens: settled.completionTokens,
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
      // Failed runs record nothing: release the hold (no usage recorded).
      await releaseAgentHold((server as any).quotaService, holdId);
      holdId = undefined;

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
      // Belt-and-braces: the hold is already settled-or-released above; this
      // is a no-op in that case and plugs any early-return leak otherwise.
      await releaseAgentHold((server as any).quotaService, holdId);
      // Persistent instances park after a turn; their durable definition,
      // runtime state and conversation remain available for the next wake-up.
      await agentRuntimeService.markInstanceReady(context.instanceId, tenant.id).catch((err) => {
        logger.warn({ instanceId, err }, 'Failed to park hosted agent instance after chat');
      });
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
    const maxSteps = clampAgentSteps(body.maxSteps);
    const clampedMaxTokens = clampAgentTokens(body.maxTokens);
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

    let resolvedInstanceId = instanceId;
    let resumeHoldId: string | undefined;
    let resumeFreeOnly = false;
    try {
      const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
      if (!context) {
        return reply.code(404).send({ error: { message: 'Agent instance not found or inactive' } });
      }
      resolvedInstanceId = context.instanceId;
      const persisted = agentSessionStore.get(tenant.id, conversationId);
      if (!persisted) {
        return reply.code(404).send({ error: { message: 'No durable session to resume' } });
      }
      if (
        persisted.agentInstanceId !== context.instanceId ||
        persisted.agentDefinitionId !== context.definition.id
      ) {
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
      const modelDecision = resolveAgentModel(body.model, definition, () =>
        agentRuntimeService.resolveModel(definition),
      );
      if (modelDecision.error) {
        return reply.code(modelDecision.status ?? 403).send({ error: { message: modelDecision.error } });
      }
      const model = modelDecision.model;
      const toolDecision = resolveAgentToolsOrReject(definition.allowedTools, definition.name);
      if (!toolDecision.ok) {
        return reply.code(400).send({
          error: {
            message: `Agent requires tools that are not registered: ${toolDecision.requiredMissing.join(', ')}`,
            missing: toolDecision.missing,
            requiredMissing: toolDecision.requiredMissing,
            resolved: toolDecision.resolved,
          },
        });
      }
      const agentTools = toolDecision.agentTools;
      const agentToolDefs = toolDecision.defs;

      {
        const estimatedTokens = estimateAgentRunTokens(clampedMaxTokens, maxSteps);
        const preflight = await preflightModelRun({
          model,
          estimatedTokens,
          maxSteps,
          tenantId: tenant.id,
          requestId,
          getPricing: (providerId, modelId) => billingService.getModelPricing(providerId, modelId),
          resolveAliasFree: aliasFreeEvidence(model, () => router.getCandidates(), (alias, cands) =>
            resolveMetaModel(alias, cands as any, 'free'),
          ),
          quotaService: (server as any).quotaService,
        });
        if (!preflight.admitted) {
          const status = preflight.status === 402 ? 402 : 429;
          return reply.code(status).send({ error: { message: preflight.reason } });
        }
        resumeHoldId = preflight.admitted ? preflight.holdId : undefined;
        resumeFreeOnly = preflight.freeOnly === true;
      }

      const result = await runAgentChatLoop({
        conversation,
        maxSteps,
        model,
        agentTools,
        agentToolDefs,
        body: { ...body, maxTokens: clampedMaxTokens },
        requestId,
        tenant,
        router,
        context,
        stream: false,
        onStreamEvent: () => {},
        buildSystemPrompt: (turn) =>
          agentRuntimeService.buildSystemPrompt(definition, turn, loadedSkillIds, tenant.id),
        agentDefinition: {
          id: definition.id,
          name: definition.name,
          tenantId: definition.tenantId,
          allowedTools: agentTools,
        },
        godmodeWrap: definition.godmodeWrap === true,
        freeOnly: resumeFreeOnly,
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
        holdId: resumeHoldId,
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

      agentSessionStore.persistRunSteps(tenant.id, conversationId, result.allSteps.map((step) => ({
        turn: step.turn,
        status: 'ok',
        budgetStatus: result.budgetExceeded ? 'exceeded' : 'within',
        allowedToolCallNames: step.tool_calls.map((tc) => tc.function?.name ?? tc.name),
        blockedToolCallNames: [],
        toolResults: step.tool_results,
        tokenDelta: (step.message as any)?.usage?.total_tokens ?? 0,
        costDelta: (step.message as any)?.usage?.cost ?? (step.message as any)?.usage?.total_cost ?? 0,
      })));

      // SEC-003: resumed runs execute real provider calls, so they settle
      // measured usage exactly like the chat path (hold reconciled once),
      // then persist a run execution row for the resumed segment.
      let resumeSettled: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number };
      try {
        resumeSettled = await settleAgentRun({
          tenantId: tenant.id,
          model,
          allSteps: result.allSteps as any,
          requestId,
          sums: {
            promptTokens: result.totalPromptTokens,
            completionTokens: result.totalCompletionTokens,
            totalTokens: result.totalTokensUsed,
            cost: result.totalCost,
          },
          holdId: resumeHoldId,
          quotaService: (server as any).quotaService,
          billingService,
        });
        resumeHoldId = undefined;
      } catch (settleError) {
        await releaseAgentHold((server as any).quotaService, resumeHoldId);
        resumeHoldId = undefined;
        logger.warn({ conversationId, error: settleError }, 'agent resume settlement failed');
        resumeSettled = {
          promptTokens: result.totalPromptTokens,
          completionTokens: result.totalCompletionTokens,
          totalTokens: result.totalTokensUsed,
          cost: result.totalCost,
        };
      }
      try {
        const resumeContext = {
          instanceId: context.instanceId,
          definition,
          instance: context.instance,
          tenantId: tenant.id,
          requestId,
        } as any;
        const executionRecord = await agentRuntimeService.createExecution(
          resumeContext,
          JSON.stringify(body.messages),
          result.lastResponseText,
          result.allSteps.flatMap((s) => s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name)),
          model,
          resumeSettled.promptTokens,
          resumeSettled.completionTokens,
          Date.now() - startTime,
        );
        const resumeEvalId =
          executionRecord?.id ??
          (await agentRegistryService.listExecutions(context.instanceId, context.tenantId, 1))[0]?.id;
        if (resumeEvalId) {
          try {
            await agentRuntimeService.evaluateExecution(
              resumeContext,
              {
                id: resumeEvalId,
                output: result.lastResponseText,
                toolsUsed: result.allSteps.flatMap((s) =>
                  s.tool_calls.map((tc: any) => tc.function?.name ?? tc.name),
                ),
                inputTokens: resumeSettled.promptTokens,
                outputTokens: resumeSettled.completionTokens,
                durationMs: Date.now() - startTime,
                status: result.budgetExceeded ? 'error' : 'success',
                error: result.budgetExceeded ? 'budget_exceeded' : null,
              },
              result.allSteps,
              maxSteps,
            );
          } catch (evaluationError) {
            logger.warn({ executionId: resumeEvalId, error: evaluationError }, 'failed_to_evaluate_resumed_execution');
          }
        }
      } catch (recordError) {
        logger.warn({ conversationId, error: recordError }, 'agent resume: failed to record execution');
      }

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
      await releaseAgentHold((server as any).quotaService, resumeHoldId);
      await agentRuntimeService.markInstanceReady(resolvedInstanceId, tenant.id).catch((err) => {
        logger.warn({ instanceId, err }, 'Failed to park hosted agent instance after resume');
      });
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
   *
   * SECURITY (session boundary): agentSessionStore.delete() is keyed on
   * conversationId ALONE, so calling it straight from the route let any
   * authenticated tenant delete another tenant's durable session by id and
   * then reclaim that session's sandbox workspace. Authorization is now the
   * same seam the resume path already used: load the session with a
   * tenant.id-scoped get and require it to be bound to the :instanceId being
   * addressed (and to that instance's definition) before deleting. A foreign
   * tenant, a foreign instance, or an absent session are all reported
   * identically so the response cannot be used to probe for session ids.
   */
  server.delete('/agents/:instanceId/chat/:conversationId', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId, conversationId } = request.params as {
      instanceId: string;
      conversationId: string;
    };

    const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
    if (!context) {
      return reply.code(404).send({ error: { message: 'No durable session to delete' } });
    }

    const persisted = agentSessionStore.get(tenant.id, conversationId);
    if (!persisted) {
      return reply.code(404).send({ error: { message: 'No durable session to delete' } });
    }
    if (
      persisted.agentInstanceId !== context.instanceId ||
      persisted.agentDefinitionId !== context.definition.id
    ) {
      return reply.code(404).send({ error: { message: 'No durable session to delete' } });
    }

    agentSessionStore.delete(conversationId);
    cleanupSandboxDir(tenant.id, conversationId);
    return reply.send({ status: 'deleted', conversationId });
  });

  /**
   * POST /agents/:instanceId/chat/:conversationId/cancel
   *
   * Same session boundary as resume/delete: the tenant-scoped get alone let
   * any instance of the tenant cancel a sibling instance's conversation, so
   * the persisted binding is verified against the addressed instance here too.
   */
  server.post('/agents/:instanceId/chat/:conversationId/cancel', async (request, reply) => {
    const tenant = (request as any).tenant;
    if (!tenant) return reply.code(401).send({ error: { message: 'Unauthorized' } });

    const { instanceId, conversationId } = request.params as {
      instanceId: string;
      conversationId: string;
    };

    const context = await agentRuntimeService.loadContext(instanceId, tenant.id);
    if (!context) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    const persisted = agentSessionStore.get(tenant.id, conversationId);
    if (!persisted) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    if (
      persisted.agentInstanceId !== context.instanceId ||
      persisted.agentDefinitionId !== context.definition.id
    ) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    agentSessionStore.upsert({
      tenantId: tenant.id,
      conversationId,
      instanceId: context.instanceId,
      agentDefinitionId: context.definition.id,
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
    // The model override must survive parsing: dropping it here made the
    // resume-time resolveAgentModel() policy gate unreachable (body.model was
    // always undefined), so an unauthorized override was silently ignored
    // instead of failing closed with 403 like the chat path.
    model: (b.model as string) ?? undefined,
  } as AgentChatBody;
}
