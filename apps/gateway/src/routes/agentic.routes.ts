import { ValidationError, type UnifiedRequest, type ToolCall } from '@dmr-x/core';
import { agenticSessionStore } from '@dmr-x/agent-runtime';
import type { Router } from '@dmr-x/router';
import { resolveMetaModel } from '@dmr-x/router';
import { billingService } from '@dmr-x/billing';
import {
  generateRequestId,
  stepCountIs,
  hasToolCall,
  isStopConditionMet,
  createInitialState,
  updateState,
  logger,
  type StopCondition,
  type StepResult,
  type ConversationState,
} from '@dmr-x/utils';
import { writeSSE } from '../lib/sse.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  clampAgentSteps,
  clampAgentTokens,
  estimateAgentRunTokens,
  aliasFreeEvidence,
  preflightModelRun,
  releaseAgentHold,
  settleAgentRun,
  markAdmittedAgentRequest,
  type AgentUsageSums,
} from '../lib/agent-admission.js';

import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
import { executeToolCall } from './tools.routes.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { needlePreFilter } from '../lib/needlePreFilter.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const StopConditionSchema = z.object({
  type: z.enum(['step_count', 'tool_call', 'text_match', 'max_tokens', 'max_cost', 'finish_reason']),
  value: z.union([z.number(), z.string()]),
});

const ApprovalDecisionSchema = z.object({
  tool_call_id: z.string(),
  approved: z.boolean(),
  result: z.any().optional(),
});

/**
 * Schema for the agentic chat request body.
 *
 * Supports:
 * - Multi-turn tool calling via the `tools` array (OpenAI function calling format)
 * - Stop conditions via `stopWhen` (step count, tool call name, text match)
 * - Approval gates via `approvalRequired` flag and `approvalDecisions` for resuming
 * - Streaming and non-streaming responses
 * - Conversation state via `conversationId` for multi-turn persistence
 */
const AgenticChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(ToolSchema).optional(),
  tool_choice: z.any().optional(),
  system_prompt: z.string().optional(),
  stopWhen: z.array(StopConditionSchema).optional(),
  approvalRequired: z.boolean().optional().default(false),
  approvalDecisions: z.array(ApprovalDecisionSchema).optional(),
  conversationId: z.string().optional(),
  max_steps: z.number().int().positive().max(50).optional().default(10),
  max_tokens_budget: z.number().positive().optional(),
  max_cost_budget: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stream: z.boolean().optional().default(false),
  // Thinking/reasoning support (inspired by Pi agent)
  thinking_level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  thinking_budgets: z.object({
    minimal: z.number().optional(),
    low: z.number().optional(),
    medium: z.number().optional(),
    high: z.number().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Conversation state is persisted durably via AgenticSessionStore (SQLite) —
// a gateway restart or idle period no longer destroys in-flight conversations.
// The only in-process state left here is the per-conversation mutex and the
// abort-controller map (cancel is inherently in-process), plus the pure
// per-process needlePreFilter narrowing cache.
// ---------------------------------------------------------------------------

const conversationLocks = new Map<string, Promise<void>>();
interface AbortEntry { controller: AbortController; tenantId: string }
const conversationAbortControllers = new Map<string, AbortEntry>();
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function registerAbortController(convId: string, tenantId: string): AbortController {
  const controller = new AbortController();
  conversationAbortControllers.set(convId, { controller, tenantId });
  return controller;
}

function cleanupAbortController(convId: string, controller: AbortController): void {
  const entry = conversationAbortControllers.get(convId);
  if (entry && entry.controller === controller) conversationAbortControllers.delete(convId);
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const message = err instanceof Error ? err.message : String(err);
  return name === 'AbortError' || code === 20 || /abort/i.test(message);
}

function persistCancelled(
  tenantId: string,
  conversationId: string,
  conversation: ConversationState,
  metadata: Record<string, unknown>,
  lastTurn?: number,
): ConversationState {
  const cancelledState = updateState(conversation, { status: 'cancelled' as unknown as ConversationState['status'] });
  agenticSessionStore.upsert({
    tenantId,
    conversationId,
    state: cancelledState as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['state'],
    status: 'cancelled' as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['status'],
    statusReason: 'cancelled' as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['statusReason'],
    lastTurn: lastTurn ?? 0,
    metadata: metadata as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['metadata'],
    expiresAt: defaultExpiresAt(),
  });
  return cancelledState;
}

// ---------------------------------------------------------------------------
// Loop tuning (env-overridable)
// ---------------------------------------------------------------------------

// Per-turn model-call timeout. Provider hiccups (NIM 120s timeouts, etc.) must
// not hang the whole run; abort the single turn and surface a recoverable error.
const TURN_TIMEOUT_MS = Number(process.env.DMRX_AGENTIC_TURN_TIMEOUT_MS) || 120_000;
// Max consecutive tool-call errors (model calls a bad/missing tool repeatedly)
// before the loop bails with a signal instead of burning all max_steps.
const MAX_CONSECUTIVE_ERRORS = Number(process.env.DMRX_AGENTIC_MAX_CONSECUTIVE_ERRORS) || 5;

// Per-conversation narrowed tool set from needlePreFilter. The model's relevant
// tools rarely change mid-conversation, so cache the first narrowing to avoid a
// localhost:8011 round-trip every turn. Stale entries expire via their own TTL
// check below, and are dropped eagerly when a persisted conversation is evicted
// (expired/corrupt) in the load path.
const toolNarrowCache = new Map<string, { tools: any[]; ts: number }>();
const TOOL_NARROW_TTL_MS = 10 * 60 * 1000;

/** Rolling expiry for a persisted agentic conversation (30-minute TTL). */
function defaultExpiresAt(): string {
  return new Date(Date.now() + CONVERSATION_TTL_MS).toISOString();
}

/** Latest user message content — evolves as the conversation does, unlike the
 * first message the old code used. */
function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return (messages[i].content ?? '') as string;
  }
  return '';
}

/** Resolve the tool list for a turn: cached narrowed set, else full set. */
function resolveTools(
  convId: string,
  fullTools: any[] | undefined,
  queryText: string,
): any[] | undefined {
  if (!fullTools) return undefined;
  if (fullTools.length <= 8) return fullTools; // narrow only when there's a lot
  const cached = toolNarrowCache.get(convId);
  if (cached && Date.now() - cached.ts < TOOL_NARROW_TTL_MS) return cached.tools;
  return fullTools; // caller narrows via needlePreFilter and writes back to cache
}

/** Run router.route with a per-turn timeout. Throws on timeout / transport error. */
async function routeWithTimeout(
  router: Router,
  unifiedRequest: UnifiedRequest,
  qualityTarget: ReturnType<typeof parseQualityTarget>,
  parentSignal?: AbortSignal,
): Promise<{ plan: any; response: any }> {
  const ac = new AbortController();
  const onParentAbort = (): void => {
    try {
      (ac as AbortController).abort((parentSignal as unknown as { reason?: unknown })?.reason as Error);
    } catch {
      try { ac.abort(); } catch { /* noop */ }
    }
  };
  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), TURN_TIMEOUT_MS);
  try {
    return await router.route(
      { ...unifiedRequest, signal: ac.signal } as UnifiedRequest,
      { path: '/v1/agentic/chat', qualityTarget },
    );
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

// ---------------------------------------------------------------------------
// Helper: convert to UnifiedRequest
// ---------------------------------------------------------------------------

function toUnifiedRequest(
  body: {
    model: string;
    messages: any[];
    tools?: any[];
    tool_choice?: any;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stream?: boolean;
  },
  requestId: string,
  tenant?: { id: string; name: string },
  freeOnly = false,
  holdId?: string,
): UnifiedRequest {
  const request: UnifiedRequest = {
    modality: 'llm',
    model: body.model,
    messages: body.messages as any,
    tools: body.tools as any,
    tool_choice: body.tool_choice as any,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    frequency_penalty: body.frequency_penalty,
    presence_penalty: body.presence_penalty,
    stream: body.stream ?? false,
    metadata: {
      requestId,
      tenant,
      ...(freeOnly ? { freeTierStrategy: 'free_only' as const } : {}),
    },
  };
  if (holdId) markAdmittedAgentRequest(request, holdId);
  return request;
}

// ---------------------------------------------------------------------------
// Helper: write SSE event (imported from ../lib/sse.js)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stop condition evaluation (uses SDK composable stop conditions)
// ---------------------------------------------------------------------------

function buildStopConditions(
  conditions: Array<{ type: string; value: number | string }>,
  getResponseText: () => string,
  getTotalTokens: () => number,
  getTotalCost: () => number,
): StopCondition[] {
  return conditions.map((c) => {
    switch (c.type) {
      case 'step_count':
        return stepCountIs(c.value as number);
      case 'tool_call':
        return hasToolCall(c.value as string);
      case 'text_match': {
        const text = c.value as string;
        return () => getResponseText().includes(text);
      }
      case 'max_tokens': {
        const maxTokens = c.value as number;
        return () => getTotalTokens() >= maxTokens;
      }
      case 'max_cost': {
        const maxCost = c.value as number;
        return () => getTotalCost() >= maxCost;
      }
      case 'finish_reason': {
        const reason = c.value as string;
        return ({ steps }) => steps.some((s) => s.finishReason === reason);
      }
      default:
        return () => false;
    }
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function agenticRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /agentic/chat
   *
   * Agentic chat endpoint that supports multi-turn conversations with tool calling.
   *
   * Features:
   * - Multi-turn tool execution loop with automatic tool calling
   * - Stop conditions (step count, tool call name, text match)
   * - Approval gates for sensitive tool calls
   * - Conversation state persistence via conversationId
   * - Streaming and non-streaming responses
   *
   * The agentic loop:
   * 1. Send messages to the model via the Router
   * 2. If the model returns tool_calls:
   *    a. If approvalRequired: pause and return pending tool calls
   *    b. Otherwise: execute tools and loop back to step 1
   * 3. If no tool_calls or stop condition met: return final response
   *
   * For streaming, events are sent as SSE:
   * - `turn`: Model response for each turn
   * - `tool_calls`: Tool calls the model wants to execute
   * - `tool_results`: Results of tool executions
   * - `approval_required`: Pending approval decisions needed
   * - `error`: Error events
   * - `done`: Stream complete
   */
  server.post('/agentic/chat', async (request, reply) => {
    const parsed = AgenticChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const tenant = (request as any).tenant;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    // Finite server-side run budget: client input can only narrow, never widen.
    // The whole run is bounded (steps x per-turn token cap) BEFORE any provider
    // call so admission can price/hold the maximum this request can spend.
    const maxSteps = clampAgentSteps(body.max_steps);
    const perTurnTokenCap = clampAgentTokens(body.max_tokens);
    const stopConditions = body.stopWhen ?? [];

    // Whole-run bounded admission (SEC-001/SEC-002), identical discipline to
    // POST /agents/:instanceId/chat and POST /agentic/dispatch:
    //   - unknown pricing fails closed (402) before any quota boundary is hit;
    //   - a bare alias admits only with router evidence of a free-only
    //     resolution;
    //   - one ATOMIC reserveAgentRun hold covering the whole multi-turn budget
    //     (per-turn cap x maxSteps), never an estimate + checkQuota double count;
    //   - settled with measured actuals on a completed run and RELEASED in
    //     `finally` on every cancellation/error path (below) so no hold is left
    //     pinned until TTL expiry.
    // /agentic/chat has no agent definition, so there is no policy model to
    // authorize against (resolveAgentModel needs one); the model is the
    // caller's explicit choice and is instead fail-closed on unknown pricing.
    let holdId: string | undefined;
    let admissionFreeOnly = false;
    let admissionReconciled = false;
    let runSums: AgentUsageSums | null = null;
    const quotaBoundary = (): any => (server as any).quotaService;
    const settleAdmission = async (): Promise<void> => {
      if (!holdId || admissionReconciled) return;
      admissionReconciled = true;
      await settleAgentRun({
        tenantId: tenant.id,
        model: body.model,
        allSteps: [],
        requestId,
        holdId,
        sums: runSums ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
        quotaService: quotaBoundary(),
        billingService,
      });
    };
    const releaseAdmission = async (): Promise<void> => {
      if (!holdId || admissionReconciled) return;
      admissionReconciled = true;
      await releaseAgentHold(quotaBoundary(), holdId);
    };
    {
      const estimatedTokens = estimateAgentRunTokens(perTurnTokenCap, maxSteps);
      const preflight = await preflightModelRun({
        model: body.model,
        estimatedTokens,
        maxSteps,
        tenantId: tenant.id,
        requestId,
        getPricing: (providerId, modelId) => billingService.getModelPricing(providerId, modelId),
        resolveAliasFree: aliasFreeEvidence(body.model, () => router.getCandidates(), (alias, cands) =>
          resolveMetaModel(alias, cands as any, 'free'),
        ),
        quotaService: quotaBoundary(),
      });
      if (!preflight.admitted) {
        const status = preflight.status === 402 ? 402 : 429;
        return reply.code(status).send({ error: { message: preflight.reason } });
      }
      holdId = preflight.admitted ? preflight.holdId : undefined;
      // Bind the admission proof to EVERY router request in this run: a
      // zero-cost alias admission must never be routed to a paid candidate.
      admissionFreeOnly = preflight.freeOnly === true;
    }

    // Acquire conversation lock to prevent concurrent mutation.
    // Uses a loop to avoid TOCTOU: after awaiting the existing lock,
    // we re-check before creating our own.
    const convId = body.conversationId ?? requestId;
    while (true) {
      const existingLock = conversationLocks.get(convId);
      if (!existingLock) break;
      await existingLock;
    }
    let lockResolver: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => { lockResolver = resolve; });
    conversationLocks.set(convId, lockPromise);
    const releaseLock = () => { lockResolver?.(); if (conversationLocks.get(convId) === lockPromise) conversationLocks.delete(convId); };
    let inFlightAbortRef: AbortController | undefined;

    try {

    // Load or create conversation state (uses SDK ConversationState). The
    // SQLite row is the source of truth — a gateway restart loses the
    // in-process maps, so a paused conversation is rehydrated from the store
    // and its approval decisions resume against the exact persisted state
    // (status 'awaiting_approval' + pendingToolCalls survive the round-trip).
    let conversation: ConversationState;
    if (body.conversationId) {
      const persisted = agenticSessionStore.get(tenant.id, body.conversationId);
      if (persisted) {
        conversation = updateState(persisted.state, {
          messages: [...persisted.state.messages, ...body.messages],
        });
      } else {
        // Expired or never persisted — start a fresh conversation.
        toolNarrowCache.delete(body.conversationId);
        conversation = createInitialState(body.conversationId);
        conversation.messages = [...body.messages];
      }
    } else {
      conversation = createInitialState(requestId);
      conversation.messages = [...body.messages];
    }

    // Handle approval decisions for resuming a paused conversation
    if (
      body.approvalDecisions &&
      body.approvalDecisions.length > 0 &&
      conversation.status === 'awaiting_approval' &&
      conversation.pendingToolCalls
    ) {
      const approvedCalls: typeof conversation.pendingToolCalls = [];
      const rejectedCalls: typeof conversation.pendingToolCalls = [];

      for (const decision of body.approvalDecisions) {
        const pending = conversation.pendingToolCalls.find(
          (tc) => tc.id === decision.tool_call_id,
        );
        if (pending) {
          if (decision.approved) {
            approvedCalls.push(pending);
          } else {
            rejectedCalls.push(pending);
          }
        }
      }

      // Execute approved tool calls using SDK executor
      for (const tc of approvedCalls) {
        const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);
        const mockToolCall: ToolCall = {
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: args },
        };
        const result = await executeToolCall(mockToolCall, { requestId, tenant });
        conversation.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.error
            ? JSON.stringify({ error: result.error.message })
            : JSON.stringify(result.result),
        });
      }

      // Reject unapproved calls
      for (const tc of rejectedCalls) {
        conversation.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ error: 'Tool call rejected by user' }),
        });
      }

      // Clear pending calls and resume
      conversation = updateState(conversation, {
        pendingToolCalls: undefined,
        status: 'in_progress',
      });

      // Persist the resume so the cleared approval state survives a crash.
      agenticSessionStore.upsert({
        tenantId: tenant.id,
        conversationId: conversation.id,
        state: conversation,
        status: 'in_progress',
        metadata: { model: body.model, requestId },
        expiresAt: defaultExpiresAt(),
      });
    }

    // Build message history
    const messages = [...conversation.messages] as any[];
    // Prepend system_prompt if provided (not already in messages)
    if (body.system_prompt && (!messages.length || messages[0]?.role !== 'system')) {
      messages.unshift({ role: 'system', content: body.system_prompt });
    }
    let lastResponseText = '';
    let totalTokensUsed = 0;
    let totalCost = 0;
    const allStepResults: StepResult[] = [];
    const sdkStopConditions = buildStopConditions(
      stopConditions,
      () => lastResponseText,
      () => totalTokensUsed,
      () => totalCost,
    );
    const allSteps: Array<{
      turn: number;
      message: any;
      tool_calls: any[];
      tool_results: any[];
    }> = [];

    // In-flight abort controller for both streaming and non-streaming runs.
    // Tenant-bound: the cancel endpoint only aborts when the tenant matches.
    const inFlightAbort = registerAbortController(convId, tenant.id);
    inFlightAbortRef = inFlightAbort;
    const isCancelled = (): boolean => inFlightAbort.signal.aborted;

    if (body.stream) {
      // Register abort controller for this conversation
      const abortController = inFlightAbort;
      let consecutiveErrors = 0;
      let lastPlan: any;
      let lastResponse: any;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let wasCancelled = false;

      // Streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        for (let turn = 0; turn < maxSteps; turn++) {
          // Check if conversation was aborted
          if (abortController.signal.aborted) {
            wasCancelled = true;
            conversation = persistCancelled(
              tenant.id,
              conversation.id,
              conversation,
              { model: body.model, requestId },
              turn,
            );
            writeSSE(reply, 'done', { status: 'cancelled', conversationId: conversation.id });
            break;
          }

          const unifiedRequest = toUnifiedRequest(
            {
              model: body.model,
              messages,
              tools: resolveTools(convId, body.tools, lastUserText(messages)),
              tool_choice: body.tool_choice,
              temperature: body.temperature,
              max_tokens: perTurnTokenCap,
              top_p: body.top_p,
              frequency_penalty: body.frequency_penalty,
              presence_penalty: body.presence_penalty,
              stream: body.stream,
            },
            requestId,
            tenant,
            admissionFreeOnly,
            holdId,
          );

          const queryText = lastUserText(messages);
          if (body.tools && body.tools.length > 8 && !toolNarrowCache.has(convId)) {
            const narrowed = await needlePreFilter(body.tools, queryText);
            if (narrowed && narrowed.length > 0) {
              body.tools = narrowed;
              toolNarrowCache.set(convId, { tools: narrowed, ts: Date.now() });
            }
          }

          let response: any;
          let plan: any;
          try {
            ({ plan, response } = await routeWithTimeout(router, unifiedRequest, qualityTarget, abortController.signal));
          } catch (err) {
            if (abortController.signal.aborted || isAbortError(err)) {
              // If another tenant's cancel raced here without ownership it would
              // not have aborted our signal; only our own cancel reaches this.
              if (abortController.signal.aborted) {
                wasCancelled = true;
                conversation = persistCancelled(
                  tenant.id,
                  conversation.id,
                  conversation,
                  { model: body.model, requestId },
                  turn,
                );
                writeSSE(reply, 'done', { status: 'cancelled', conversationId: conversation.id });
                break;
              }
            }
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              if (isCancelled()) {
                wasCancelled = true;
                conversation = persistCancelled(
                  tenant.id,
                  conversation.id,
                  conversation,
                  { model: body.model, requestId },
                  turn,
                );
                writeSSE(reply, 'done', { status: 'cancelled', conversationId: conversation.id });
                break;
              }
              agenticSessionStore.upsert({
                tenantId: tenant.id,
                conversationId: conversation.id,
                state: conversation,
                status: 'error',
                lastTurn: turn,
                metadata: { model: body.model, requestId },
                expiresAt: defaultExpiresAt(),
              });
              writeSSE(reply, 'error', {
                error: { message: 'Agentic loop aborted: too many consecutive failed turns' },
              });
              break;
            }
            writeSSE(reply, 'error', {
              error: { message: 'Turn failed, retrying', detail: err instanceof Error ? err.message : String(err) },
            });
            continue;
          }
          consecutiveErrors = 0;

          const toolCalls = response.message?.tool_calls ?? [];
          const responseText =
            typeof response.message?.content === 'string'
              ? response.message.content
              : '';
          lastResponseText = responseText;

          // Accumulate token/cost usage
          if (response.usage) {
            totalTokensUsed += response.usage.total_tokens ?? 0;
            totalPromptTokens += response.usage.prompt_tokens ?? 0;
            totalCompletionTokens += response.usage.completion_tokens ?? 0;
            // Cost tracking: extract from usage if available
            const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
            totalCost += stepCost;
          }
          lastPlan = plan;
          lastResponse = response;

          // Stream the model response for this turn
          writeSSE(reply, 'turn', {
            turn,
            conversationId: conversation.id,
            message: response.message,
            model: response.modelId,
            usage: response.usage,
            finish_reason: response.finishReason,
          });

          // Check stop conditions using SDK composable conditions
          const stepResult: StepResult = {
            toolCalls: toolCalls.map((tc: ToolCall) => ({ name: tc.function.name })),
            usage: response.usage ? { totalTokens: response.usage.total_tokens, cost: undefined } : undefined,
            finishReason: response.finishReason ?? undefined,
          };
          allStepResults.push(stepResult);

          // Check budget limits
          const overTokenBudget = body.max_tokens_budget && totalTokensUsed >= body.max_tokens_budget;
          const overCostBudget = body.max_cost_budget && totalCost >= body.max_cost_budget;

          if (
            toolCalls.length === 0 ||
            overTokenBudget ||
            overCostBudget ||
            await isStopConditionMet({ stopConditions: sdkStopConditions, steps: allStepResults })
          ) {
            // Update conversation state
            if (response.message) messages.push(response.message);
            conversation = updateState(conversation, {
              messages,
              status: 'completed',
            });

            // Persist the completed turn so the final state survives a restart.
            agenticSessionStore.upsert({
              tenantId: tenant.id,
              conversationId: conversation.id,
              state: conversation,
              status: 'completed',
              lastTurn: turn,
              metadata: { model: body.model, requestId },
              expiresAt: defaultExpiresAt(),
            });

            // Include budget info in done event if budgets were exceeded
            if (overTokenBudget || overCostBudget) {
              writeSSE(reply, 'budget_exceeded', {
                token_budget: overTokenBudget ? body.max_tokens_budget : undefined,
                cost_budget: overCostBudget ? body.max_cost_budget : undefined,
                totalTokensUsed,
                totalCost,
              });
            }

            break;
          }

          // Check if approval is required
          if (body.approvalRequired) {
            // Store pending tool calls
            conversation = updateState(conversation, {
              pendingToolCalls: toolCalls.map((tc: ToolCall) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments || '{}'),
              })),
              status: 'awaiting_approval' as const,
            });

            // Add assistant message to conversation
            if (response.message) messages.push(response.message);
            conversation = updateState(conversation, { messages });

            // Persist the paused state (awaiting_approval + pendingToolCalls)
            // so a restart can resume the approval flow exactly.
            agenticSessionStore.upsert({
              tenantId: tenant.id,
              conversationId: conversation.id,
              state: conversation,
              status: 'awaiting_approval',
              lastTurn: turn,
              metadata: { model: body.model, requestId },
              expiresAt: defaultExpiresAt(),
            });

            // Stream approval required event
            writeSSE(reply, 'approval_required', {
              conversationId: conversation.id,
              pending_tool_calls: toolCalls.map((tc: ToolCall) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments || '{}'),
              })),
            });

            writeSSE(reply, 'done', { status: 'awaiting_approval', conversationId: conversation.id });
            reply.raw.end();
            return reply;
          }

          // Stream tool calls
          writeSSE(reply, 'tool_calls', {
            turn,
            tool_calls: toolCalls.map((tc: ToolCall) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            })),
          });

          // Execute tool calls using SDK executor
          const assistantMessage = { ...response.message };
          messages.push(assistantMessage);

          const executionPromises = toolCalls.map((tc: ToolCall) =>
            executeToolCall(tc, { requestId, tenant }),
          );

          const settled = await Promise.allSettled(executionPromises);
          const stepResults = settled
            .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
            .map((s) => s.value);

          // Stream tool results
          writeSSE(reply, 'tool_results', {
            turn,
            results: stepResults,
          });

          allSteps.push({ turn, message: response.message, tool_calls: toolCalls, tool_results: stepResults });

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

          if (abortController.signal.aborted) {
            wasCancelled = true;
            conversation = persistCancelled(
              tenant.id,
              conversation.id,
              conversation,
              { model: body.model, requestId },
              turn,
            );
            writeSSE(reply, 'done', { status: 'cancelled', conversationId: conversation.id });
            break;
          }
          // Persist the running transcript after each successful turn so an
          // interruption or restart can resume from here.
          conversation = updateState(conversation, { messages });
          agenticSessionStore.upsert({
            tenantId: tenant.id,
            conversationId: conversation.id,
            state: conversation,
            status: conversation.status,
            lastTurn: turn,
            metadata: { model: body.model, requestId },
            expiresAt: defaultExpiresAt(),
          });
        }
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          wasCancelled = true;
          try {
            conversation = persistCancelled(
              tenant.id,
              conversation.id,
              conversation,
              { model: body.model, requestId },
            );
          } catch { /* store mock never throws */ }
          writeSSE(reply, 'done', { status: 'cancelled', conversationId: conversation.id });
        } else {
          logger.error({ err: error, requestId }, 'Agentic streaming error');
          (server as any).recordTelemetryEvent?.({
            level: 'error',
            service: 'gateway',
            message: error instanceof Error ? error.message : 'Agentic streaming error',
            trace_id: requestId,
            metadata: {
              path: request.url,
              model: body.model,
              requestId,
            },
          });
          writeSSE(reply, 'error', { error: { message: 'Request failed' } });
        }
      }

      // Telemetry: surface the completed agentic request on the Requests page
      // and feed request_logs + usage via the onResponse hook.
      try {
        const servedProviderId = lastPlan?.primary?.providerId;
        const servedModelId = lastResponse?.modelId;
        if (servedProviderId && servedModelId) {
          (request as any).metrics = {
            providerId: servedProviderId,
            modelId: servedModelId,
            modality: 'agentic',
            tenantId: tenant.id,
            taskProfile: JSON.stringify({ taskType: 'agentic' }),
            tokens: {
              prompt: totalPromptTokens,
              completion: totalCompletionTokens,
              total: totalTokensUsed,
            },
            qualityTarget,
          };
        }
        (server as any).recordTelemetryEvent?.({
          level: 'info',
          service: 'gateway',
          message: 'Agentic request completed',
          metadata: {
            path: request.url,
            requestId,
            model: body.model,
            providerId: servedProviderId,
            modelId: servedModelId,
            tokens: totalTokensUsed,
            status: 'completed',
            conversationId: conversation.id,
          },
        });
      } catch (metricsErr) {
        logger.debug({ err: metricsErr }, 'agentic telemetry emission failed');
      }

      // A completed streaming run records the measured actuals so the whole-run
      // admission hold is SETTLED with real prompt/completion numbers. The
      // cancelled and error paths leave runSums null, so `finally` RELEASES the
      // hold instead (records nothing, never pins quota until TTL expiry).
      if (!wasCancelled) {
        runSums = {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalTokensUsed,
          cost: totalCost,
        };
      }

      if (!wasCancelled) {
        writeSSE(reply, 'done', { status: 'completed', conversationId: conversation.id });
      } else {
        // Cancel path already emitted `done` with status cancelled; ensure the
        // durable record stays cancelled and is not overwritten by telemetry.
        try {
          const persisted = agenticSessionStore.get(tenant.id, conversation.id);
          if (!persisted || (persisted.status as unknown as string) !== 'cancelled') {
            conversation = persistCancelled(
              tenant.id,
              conversation.id,
              conversation,
              { model: body.model, requestId },
            );
          }
        } catch { /* noop */ }
      }
      try { cleanupAbortController(convId, abortController); } catch { /* noop */ }
      reply.raw.end();
      return reply;
    }

    // Non-streaming response
    const nonStreamingStepResults: StepResult[] = [];
    let nonStreamingLastResponseText = '';
    let nonStreamingTotalTokens = 0;
    let nonStreamingTotalCost = 0;
    let nonStreamingConsecutiveErrors = 0;
    let nonStreamingPlan: any;
    let nonStreamingResponse: any;
    let nonStreamingPromptTokens = 0;
    let nonStreamingCompletionTokens = 0;
    const emitAgenticTelemetry = (status: string, stepsCompleted: number): void => {
      // Same settle-vs-release contract as the streaming path: every terminal
      // status that actually consumed a completed turn settles the admission
      // hold with measured actuals; 'cancelled' releases it instead.
      if (status !== 'cancelled') {
        runSums = {
          promptTokens: nonStreamingPromptTokens,
          completionTokens: nonStreamingCompletionTokens,
          totalTokens: nonStreamingTotalTokens,
          cost: nonStreamingTotalCost,
        };
      }
      try {
        const servedProviderId = nonStreamingPlan?.primary?.providerId;
        const servedModelId = nonStreamingResponse?.modelId;
        if (servedProviderId && servedModelId) {
          (request as any).metrics = {
            providerId: servedProviderId,
            modelId: servedModelId,
            modality: 'agentic',
            tenantId: tenant.id,
            taskProfile: JSON.stringify({ taskType: 'agentic' }),
            tokens: {
              prompt: nonStreamingPromptTokens,
              completion: nonStreamingCompletionTokens,
              total: nonStreamingTotalTokens,
            },
            qualityTarget,
          };
        }
        (server as any).recordTelemetryEvent?.({
          level: 'info',
          service: 'gateway',
          message: 'Agentic request completed',
          metadata: {
            path: request.url,
            requestId,
            model: body.model,
            providerId: servedProviderId,
            modelId: servedModelId,
            tokens: nonStreamingTotalTokens,
            status,
            steps: stepsCompleted,
            conversationId: conversation.id,
          },
        });
      } catch (metricsErr) {
        logger.debug({ err: metricsErr }, 'agentic telemetry emission failed');
      }
    };
    const nonStreamingStopConditions = buildStopConditions(
      stopConditions,
      () => nonStreamingLastResponseText,
      () => nonStreamingTotalTokens,
      () => nonStreamingTotalCost,
    );

    for (let turn = 0; turn < maxSteps; turn++) {
        if (inFlightAbort.signal.aborted) {
          conversation = persistCancelled(
            tenant.id,
            conversation.id,
            conversation,
            { model: body.model, requestId },
            turn,
          );
          emitAgenticTelemetry('cancelled', turn);
          try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Conversation cancelled.' },
                finish_reason: 'stop',
              },
            ],
            conversationId: conversation.id,
            steps_completed: turn,
            all_steps: allSteps,
            status: 'cancelled',
          };
        }
        const queryText = lastUserText(messages);
        if (body.tools && body.tools.length > 8 && !toolNarrowCache.has(convId)) {
          const narrowed = await needlePreFilter(body.tools, queryText);
          if (narrowed && narrowed.length > 0) {
            body.tools = narrowed;
            toolNarrowCache.set(convId, { tools: narrowed, ts: Date.now() });
          }
        }

        const unifiedRequest = toUnifiedRequest(
          {
            model: body.model,
            messages,
            tools: resolveTools(convId, body.tools, queryText),
            tool_choice: body.tool_choice,
            temperature: body.temperature,
            max_tokens: perTurnTokenCap,
            top_p: body.top_p,
            frequency_penalty: body.frequency_penalty,
            presence_penalty: body.presence_penalty,
            stream: false,
          },
          requestId,
          tenant,
          admissionFreeOnly,
          holdId,
        );

        let response: any;
        let plan: any;
        try {
          ({ plan, response } = await routeWithTimeout(router, unifiedRequest, qualityTarget, inFlightAbort.signal));
        } catch (err) {
          if (inFlightAbort.signal.aborted || isAbortError(err)) {
            if (inFlightAbort.signal.aborted) {
              conversation = persistCancelled(
                tenant.id,
                conversation.id,
                conversation,
                { model: body.model, requestId },
                turn,
              );
              emitAgenticTelemetry('cancelled', turn);
              try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
              return {
                id: requestId,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Conversation cancelled.' },
                    finish_reason: 'stop',
                  },
                ],
                conversationId: conversation.id,
                steps_completed: turn,
                all_steps: allSteps,
                status: 'cancelled',
              };
            }
          }
          nonStreamingConsecutiveErrors++;
          if (nonStreamingConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            if (isCancelled()) {
              conversation = persistCancelled(
                tenant.id,
                conversation.id,
                conversation,
                { model: body.model, requestId },
                turn,
              );
              emitAgenticTelemetry('cancelled', turn);
              try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
              return {
                id: requestId,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Conversation cancelled.' },
                    finish_reason: 'stop',
                  },
                ],
                conversationId: conversation.id,
                steps_completed: turn,
                all_steps: allSteps,
                status: 'cancelled',
              };
            }
            agenticSessionStore.upsert({
              tenantId: tenant.id,
              conversationId: conversation.id,
              state: conversation,
              status: 'error',
              lastTurn: turn,
              metadata: { model: body.model, requestId },
              expiresAt: defaultExpiresAt(),
            });
            return {
              id: requestId,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Agentic loop aborted: too many consecutive failed turns.' },
                  finish_reason: 'stop',
                },
              ],
              conversationId: conversation.id,
              steps_completed: turn + 1,
              all_steps: allSteps,
              error: err instanceof Error ? err.message : String(err),
            };
          }
          continue;
        }
        nonStreamingConsecutiveErrors = 0;

        const toolCalls = response.message?.tool_calls ?? [];
        const responseText =
          typeof response.message?.content === 'string'
            ? response.message.content
            : '';
        nonStreamingLastResponseText = responseText;

        // Accumulate token/cost usage
        if (response.usage) {
          nonStreamingTotalTokens += response.usage.total_tokens ?? 0;
          nonStreamingPromptTokens += response.usage.prompt_tokens ?? 0;
          nonStreamingCompletionTokens += response.usage.completion_tokens ?? 0;
          const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
          nonStreamingTotalCost += stepCost;
        }
        nonStreamingPlan = plan;
        nonStreamingResponse = response;

        // Check stop conditions using SDK composable conditions
        const stepResult: StepResult = {
          toolCalls: toolCalls.map((tc: ToolCall) => ({ name: tc.function.name })),
          usage: response.usage ? { totalTokens: response.usage.total_tokens, cost: undefined } : undefined,
          finishReason: response.finishReason ?? undefined,
        };
        nonStreamingStepResults.push(stepResult);

        allSteps.push({ turn, message: response.message, tool_calls: toolCalls, tool_results: [] });

        // Check budget limits
        const overTokenBudget = body.max_tokens_budget && nonStreamingTotalTokens >= body.max_tokens_budget;
        const overCostBudget = body.max_cost_budget && nonStreamingTotalCost >= body.max_cost_budget;

        if (
          toolCalls.length === 0 ||
          overTokenBudget ||
          overCostBudget ||
          await isStopConditionMet({ stopConditions: nonStreamingStopConditions, steps: nonStreamingStepResults })
        ) {
          if (isCancelled()) {
            conversation = persistCancelled(
              tenant.id,
              conversation.id,
              conversation,
              { model: body.model, requestId },
              turn,
            );
            emitAgenticTelemetry('cancelled', turn + 1);
            try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
            return {
              id: requestId,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Conversation cancelled.' },
                  finish_reason: 'stop',
                },
              ],
              conversationId: conversation.id,
              steps_completed: turn + 1,
              all_steps: allSteps,
              status: 'cancelled',
            };
          }
          if (response.message) messages.push(response.message);
          conversation = updateState(conversation, {
            messages,
            status: 'completed',
          });

          agenticSessionStore.upsert({
            tenantId: tenant.id,
            conversationId: conversation.id,
            state: conversation,
            status: 'completed',
            lastTurn: turn,
            metadata: { model: body.model, requestId },
            expiresAt: defaultExpiresAt(),
          });

          emitAgenticTelemetry('completed', turn + 1);
          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: response.modelId,
            choices: [
              {
                index: 0,
                message: response.message,
                finish_reason: response.finishReason,
              },
            ],
            usage: response.usage,
            conversationId: conversation.id,
            steps_completed: turn + 1,
            all_steps: allSteps,
            budget: {
              totalTokensUsed: nonStreamingTotalTokens,
              totalCost: nonStreamingTotalCost,
              tokenBudget: body.max_tokens_budget,
              costBudget: body.max_cost_budget,
              exceededToken: overTokenBudget,
              exceededCost: overCostBudget,
            },
          };
        }

        // Check if approval is required
        if (body.approvalRequired) {
          conversation = updateState(conversation, {
            pendingToolCalls: toolCalls.map((tc: ToolCall) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}'),
            })),
            status: 'awaiting_approval' as const,
          });

          if (response.message) messages.push(response.message);
          conversation = updateState(conversation, { messages });

          // Persist the paused state so a restart can resume the approval flow.
          agenticSessionStore.upsert({
            tenantId: tenant.id,
            conversationId: conversation.id,
            state: conversation,
            status: 'awaiting_approval',
            lastTurn: turn,
            metadata: { model: body.model, requestId },
            expiresAt: defaultExpiresAt(),
          });

          emitAgenticTelemetry('awaiting_approval', turn + 1);
          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: response.modelId,
            choices: [
              {
                index: 0,
                message: response.message,
                finish_reason: 'tool_calls',
              },
            ],
            usage: response.usage,
            conversationId: conversation.id,
            status: 'awaiting_approval',
            pending_tool_calls: toolCalls.map((tc: ToolCall) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}'),
            })),
          };
        }

        // Execute tool calls using SDK executor
        const assistantMessage = { ...response.message };
        messages.push(assistantMessage);

        const executionPromises = toolCalls.map((tc: ToolCall) =>
          executeToolCall(tc, { requestId, tenant }),
        );

        const settled = await Promise.allSettled(executionPromises);
        const stepResults = settled
          .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> => s.status === 'fulfilled')
          .map((s) => s.value);

        // Update the step entry (already pushed before stop check) with actual tool results
        const lastStep = allSteps[allSteps.length - 1];
        if (lastStep) lastStep.tool_results = stepResults;

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

        if (isCancelled()) {
          conversation = persistCancelled(
            tenant.id,
            conversation.id,
            conversation,
            { model: body.model, requestId },
            turn,
          );
          emitAgenticTelemetry('cancelled', turn + 1);
          try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Conversation cancelled.' },
                finish_reason: 'stop',
              },
            ],
            conversationId: conversation.id,
            steps_completed: turn + 1,
            all_steps: allSteps,
            status: 'cancelled',
          };
        }
        // Persist the running transcript after each successful turn.
        conversation = updateState(conversation, { messages });
        agenticSessionStore.upsert({
          tenantId: tenant.id,
          conversationId: conversation.id,
          state: conversation,
          status: conversation.status,
          lastTurn: turn,
          metadata: { model: body.model, requestId },
          expiresAt: defaultExpiresAt(),
        });
    }

      // Exhausted all steps — a concurrent cancel wins over completion.
      if (isCancelled()) {
        conversation = persistCancelled(
          tenant.id,
          conversation.id,
          conversation,
          { model: body.model, requestId },
          maxSteps,
        );
        emitAgenticTelemetry('cancelled', maxSteps);
        try { cleanupAbortController(convId, inFlightAbort); } catch { /* noop */ }
        return {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Conversation cancelled.' },
              finish_reason: 'stop',
            },
          ],
          conversationId: conversation.id,
          steps_completed: maxSteps,
          all_steps: allSteps,
          status: 'cancelled',
        };
      }
      conversation = updateState(conversation, { messages, status: 'completed' });

      agenticSessionStore.upsert({
        tenantId: tenant.id,
        conversationId: conversation.id,
        state: conversation,
        status: 'completed',
        lastTurn: maxSteps,
        metadata: { model: body.model, requestId },
        expiresAt: defaultExpiresAt(),
      });

    emitAgenticTelemetry('max_steps', maxSteps);
    return {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Agentic loop reached maximum steps.' },
          finish_reason: 'length',
        },
      ],
      conversationId: conversation.id,
      steps_completed: maxSteps,
      all_steps: allSteps,
    };

    } finally {
      releaseLock();
      try { if (inFlightAbortRef) cleanupAbortController(convId, inFlightAbortRef); } catch { /* noop */ }
      // Belt-and-braces: every acquired hold is either settled with the
      // measured actuals or released — on cancellation, on error, and on every
      // early return inside the loop (no hold is left to expire).
      try {
        if (runSums) await settleAdmission();
        else await releaseAdmission();
      } catch (admissionErr) {
        logger.debug({ err: admissionErr }, 'agentic admission reconciliation failed');
      }
    }
  });

  /**
   * POST /agentic/chat/:conversationId/cancel
   *
   * Cancel a running conversation by aborting its execution. Tenant-bound:
   * only the owning tenant observes and aborts the in-flight provider request.
   */
  server.post('/agentic/chat/:conversationId/cancel', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const tenant = (request as any).tenant;
    const entry = conversationAbortControllers.get(conversationId);

    if (!entry || !tenant?.id || entry.tenantId !== tenant.id) {
      return reply.status(404).send({ error: 'Conversation not found or already completed' });
    }

    entry.controller.abort();
    // Keep the entry until the chat loop cleans it up via identity-checked
    // cleanup so a concurrent duplicate conversationId cannot be affected.
    // Remove here only if the loop already finished (entry still ours).
    // The loop's finally also attempts identity-checked cleanup.

    // Persist the cancellation when durable state already exists. When the
    // chat loop is still awaiting the provider (no turns persisted yet) the
    // loop itself persists `cancelled` on abort; this best-effort write covers
    // the case where the loop already persisted prior turns.
    if (tenant?.id) {
      try {
        const persisted = agenticSessionStore.get(tenant.id, conversationId);
        // Never clobber a terminal completed run with a stale abort entry: the
        // completion path may have persisted `completed` after this abort was
        // registered. Only non-terminal states may transition to cancelled.
        if (persisted && (persisted.status as unknown as string) !== 'completed') {
          const cancelledState = updateState(persisted.state, {
            status: 'cancelled' as unknown as typeof persisted.state.status,
          });
          agenticSessionStore.upsert({
            tenantId: tenant.id,
            conversationId,
            state: cancelledState as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['state'],
            status: 'cancelled' as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['status'],
            statusReason: 'cancelled' as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['statusReason'],
            lastTurn: persisted.lastTurn,
            metadata: persisted.metadata as unknown as Parameters<typeof agenticSessionStore.upsert>[0]['metadata'],
            expiresAt: defaultExpiresAt(),
          });
        }
      } catch { /* best-effort */ }
    }

    return { status: 'cancelled', conversationId };
  });
}
