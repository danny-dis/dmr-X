import type { ToolCall, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import {
  updateState,
  stepCountIs,
  hasToolCall,
  isStopConditionMet,
  logger,
  type StopCondition,
  type StepResult,
  type ConversationState,
} from '@dmr-x/utils';
import type { AgentRuntimeService, AgentExecutionContext } from '@dmr-x/agent-runtime';
import type { AgentDefinition } from '@dmr-x/agent-registry';

import { executeToolCall } from './tools.routes.js';
import { parseQualityTarget } from '../utils/quality-target.js';

// ---------------------------------------------------------------------------
// Shared agentic loop engine for the /agents/:instanceId/chat route.
// ---------------------------------------------------------------------------

export interface AgentChatLoopBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  maxSteps?: number;
  resolvedConversationId?: string;
  max_cost_budget?: number;
  /** Composable stop conditions (step_count/tool_call/text_match/max_tokens/max_cost/finish_reason). */
  stopWhen?: Array<{ type: string; value: number | string }>;
  /** Pause before executing tool calls, persisting an awaiting_approval state for /resume. */
  approvalRequired?: boolean;
  /** Human approval decisions supplied on the /resume path. */
  approvalDecisions?: Array<{ tool_call_id: string; approved: boolean; result?: unknown }>;
}

export interface AgentChatLoopResult {
  lastResponseText: string;
  totalTokensUsed: number;
  totalCost: number;
  stepsCompleted: number;
  budgetExceeded: boolean;
  /** True when the loop paused for human approval (status awaiting_approval). */
  awaitingApproval?: boolean;
  finalUsage: any;
  allSteps: Array<{
    turn: number;
    message: any;
    tool_calls: any[];
    tool_results: any[];
  }>;
}

interface RunAgentChatLoopArgs {
  conversation: ConversationState;
  maxSteps: number;
  model: string;
  agentTools: string[];
  agentToolDefs: any[] | undefined;
  body: AgentChatLoopBody;
  requestId: string;
  tenant: { id: string; name: string };
  router: Router;
  context: AgentExecutionContext;
  runtime: AgentRuntimeService;
  stream: boolean;
  onStreamEvent: (event: string, data: unknown) => void;
  /** Rebuilds the system prompt for a given turn (skill-capture nudge support). */
  buildSystemPrompt: (turn: number) => Promise<string>;
  /** Agent definition, threaded into tool execution for the `delegate` tool. */
  agentDefinition: {
    id: string;
    name: string;
    tenantId: string;
    allowedTools: string[];
  };
  /** Mutable list of skill ids loaded via `load_skill` this session. */
  loadedSkillIds: string[];
  /** Execution record id returned by recordExecution, for evaluation linkage. */
  executionId?: string;
  /** Conversation id for durable session linkage. Defaults to conversation.id. */
  conversationId?: string;
  /** Per-turn checkpoint hook — invoked whenever the loop's messages change. */
  onCheckpoint?: (turn: number, conversation: ConversationState) => void;
  /** Composable stop conditions; also honored from body.stopWhen. */
  stopWhen?: Array<{ type: string; value: number | string }>;
  /** Pause before tool execution; also honored from body.approvalRequired. */
  approvalRequired?: boolean;
  /** Resume-path approval decisions; also honored from body.approvalDecisions. */
  approvalDecisions?: Array<{ tool_call_id: string; approved: boolean; result?: unknown }>;
  /** Router quality target (from the X-Quality-Target header). Defaults to 'balanced'. */
  qualityTarget?: ReturnType<typeof parseQualityTarget>;
  /** Opt-in: route per-turn model calls through the godmode wrap using the
   *  agent's own resolved model (any family) instead of plain router routing.
   *  Falls back to normal routing when the wrap is unavailable. */
  godmodeWrap?: boolean;
}

const MAX_TURN_RETRIES = 2;

// Per-turn model-call timeout. A hung provider call must not hang the whole
// durable run; abort the single turn and surface a recoverable error.
const TURN_TIMEOUT_MS = Number(process.env.DMRX_AGENTIC_TURN_TIMEOUT_MS) || 120_000;

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

function classifyRouteError(
  runtime: AgentRuntimeService,
  error: unknown,
): { retryable: boolean; reason: string } {
  try {
    return runtime.classifyProviderError(error);
  } catch {
    return { retryable: false, reason: 'classification_failed' };
  }
}

function resolveFallbackForError(
  runtime: AgentRuntimeService,
  error: unknown,
  definition: AgentDefinition,
  currentModel: string,
): { retry: boolean; fallback: string | null; reason: string } {
  const classification = classifyRouteError(runtime, error);
  if (!classification.retryable) {
    return { retry: false, fallback: null, reason: classification.reason };
  }

  const fallback = runtime.resolveFallbackModel(definition, currentModel);
  if (!fallback) {
    return { retry: false, fallback: null, reason: 'no_fallback_model' };
  }

  return { retry: true, fallback, reason: classification.reason };
}

// ---------------------------------------------------------------------------
// Opt-in agentic upgrades ported from /agentic/chat (all default OFF)
// ---------------------------------------------------------------------------

// Once the transcript grows past this many messages, compact the early
// tool-activity turns into a single rolling summary (history-compaction mode).
// These are defaults; AgentDefinition.compactionThreshold overrides.
const DEFAULT_COMPACTION_THRESHOLD = 24;
const DEFAULT_COMPACTION_KEEP_RECENT = 8;
const DEFAULT_COMPACTION_MIN_HEAD = 8;

/**
 * Resolve effective compaction parameters from agent definition.
 * Falls back to defaults when the definition doesn't override them.
 */
function resolveCompactionParams(definition: { compactionThreshold?: number; compactionKeepRecent?: number }): {
  threshold: number;
  keepRecent: number;
  minHead: number;
} {
  const threshold = definition.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const keepRecent = definition.compactionKeepRecent ?? DEFAULT_COMPACTION_KEEP_RECENT;
  const minHead = DEFAULT_COMPACTION_MIN_HEAD;
  return { threshold, keepRecent, minHead };
}

/**
 * Plan-then-execute phase. Makes exactly ONE tool-free model call asking for a
 * numbered execution plan, then returns the raw plan text. No tools -> cannot
 * loop. On any failure returns null (non-fatal; caller falls back to ReAct).
 */
async function runPlanPhase(args: {
  router: Router;
  model: string;
  tenant: { id: string; name: string };
  requestId: string;
  systemPrompt: string;
  firstUserMessage: string;
}): Promise<string | null> {
  const { router, model, tenant, requestId, systemPrompt, firstUserMessage } = args;
  try {
    const { response } = await router.route(
      toUnifiedRequest(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                'Before acting, produce a concise numbered execution plan (3-8 steps) that ' +
                'breaks the task into tool-using steps. Output ONLY the plan. You will then be ' +
                'given the same task again to execute it step by step.\n\nTASK:\n' +
                firstUserMessage,
            },
          ],
          temperature: undefined,
          max_tokens: undefined,
          stream: false,
        },
        requestId,
        tenant,
      ),
      { path: '/v1/agents/plan' },
    );
    const plan =
      typeof response.message?.content === 'string' ? response.message.content.trim() : '';
    return plan.length > 0 ? plan : null;
  } catch {
    return null;
  }
}

/**
 * Summarize the early portion of a transcript into a single system message.
 * Non-fatal: any failure returns the original messages unchanged. Keeps the
 * most recent keepRecent messages verbatim.
 */
async function summarizeHistory(args: {
  router: Router;
  model: string;
  tenant: { id: string; name: string };
  requestId: string;
  messages: any[];
  keepRecent: number;
}): Promise<{ messages: any[]; summary: string } | null> {
  const { router, model, tenant, requestId, messages, keepRecent } = args;
  // messages[0] is the live system prompt; we compact the user/assistant/tool
  // turns that precede the recent tail.
  const head = messages.slice(1, messages.length - keepRecent);
  const tail = messages.slice(messages.length - keepRecent);
  if (head.length < keepRecent) return null;

  const transcript = head
    .map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content.slice(0, 2000) : '[non-text]'}`)
    .join('\n');

  try {
    const { response } = await router.route(
      toUnifiedRequest(
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Summarize the following agent transcript into a compact context block: ' +
                'preserve decisions made, tools used, key results, and any open sub-tasks. ' +
                'Be dense and factual. Under 400 words.',
            },
            { role: 'user', content: transcript },
          ],
          temperature: undefined,
          max_tokens: undefined,
          stream: false,
        },
        requestId,
        tenant,
      ),
      { path: '/v1/agents/compact' },
    );
    const summary =
      typeof response.message?.content === 'string' ? response.message.content.trim() : '';
    if (!summary) return null;
    return {
      // Re-insert the live system prompt, then the rolling summary, then the tail.
      messages: [messages[0], { role: 'system', content: `PRIOR CONTEXT SUMMARY:\n${summary}` }, ...tail],
      summary,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Opt-in agentic upgrades ported from /agentic/chat (all default OFF)
// ---------------------------------------------------------------------------

/**
 * Run router.route with a per-turn timeout. Throws on timeout / transport error.
 * `timeoutMs` defaults to the module-level env knob (DMRX_AGENTIC_TURN_TIMEOUT_MS);
 * overridable so tests can exercise the abort path without importing late.
 */
export async function routeWithTimeout(
  router: Router,
  unifiedRequest: UnifiedRequest,
  qualityTarget: ReturnType<typeof parseQualityTarget>,
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<{ response: any }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await router.route(
      { ...unifiedRequest, signal: ac.signal } as UnifiedRequest,
      { path: '/v1/agents/chat', qualityTarget },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a godmode proxy completion (OpenAI wire format) back into the loop's
 * UnifiedResponse shape so the ReAct loop can consume tool_calls/content/
 * usage/finishReason unchanged.
 */
function godmodeCompletionToResponse(
  completion: any,
  wrapModel: string | undefined,
  requestId: string,
): any {
  const choice = completion?.choices?.[0];
  const gmMessage = choice?.message;
  const toolCalls = gmMessage?.tool_calls;
  return {
    modality: 'llm',
    requestId,
    providerId: 'godmode',
    modelId: wrapModel ?? completion?.model ?? 'godmode',
    message: {
      role: 'assistant',
      content: typeof gmMessage?.content === 'string' ? gmMessage.content : '',
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    },
    usage: completion?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finishReason: choice?.finish_reason ?? (toolCalls ? 'tool_calls' : 'stop'),
    latencyMs: 0,
  };
}

/**
 * Complete one agent turn. With `godmodeWrap` the request is routed through
 * the godmode proxy first, resolving the wrap order from the agent's OWN
 * resolved model (any family) via {@link wrapViaGodmode}. When the wrap is
 * unavailable the turn degrades to normal router routing — unless strict mode
 * is on, in which case the turn hard-fails (operator asked for a wrap, got
 * none). Without `godmodeWrap` this is a plain routeWithTimeout.
 */
async function completeAgentTurn(
  router: Router,
  unifiedRequest: UnifiedRequest,
  target: ReturnType<typeof parseQualityTarget>,
  requestId: string,
  godmodeWrap: boolean,
): Promise<{ response: any }> {
  if (!godmodeWrap) {
    return routeWithTimeout(router, unifiedRequest, target);
  }

  const { wrapViaGodmode, isGodmodeStrict } = await import('../lib/godmode-guard.js');
  const candidates = router.getCandidates();
  const result = await wrapViaGodmode({
    requestId,
    messages: (unifiedRequest.messages ?? []) as any[],
    model: unifiedRequest.model ?? '',
    candidates,
    costFilter: 'all',
    temperature: unifiedRequest.temperature,
    maxTokens: unifiedRequest.max_tokens,
    tools: unifiedRequest.tools,
  });

  if (result.status === 'wrapped' && result.completion) {
    return { response: godmodeCompletionToResponse(result.completion, result.wrapModel, requestId) };
  }

  if (isGodmodeStrict()) {
    throw new Error(`godmode wrap unavailable for agent turn (strict mode): ${requestId}`);
  }

  logger.warn(
    { requestId, wrapOrder: result.wrapOrder },
    'godmode wrap unavailable for agent turn — falling back to router routing',
  );
  return routeWithTimeout(router, unifiedRequest, target);
}

/**
 * Build composable SDK stop conditions from request-body conditions. Closures
 * read the loop's live lastResponseText / totalTokensUsed / totalCost, so the
 * conditions stay current across turns.
 */
export function buildStopConditions(
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

/**
 * Process human approval decisions against a paused conversation's pending
 * tool calls. Executes approved calls (injecting their tool-result messages),
 * injects rejection messages for the rest, then clears pendingToolCalls and
 * returns the conversation to in_progress. No-op unless the conversation is
 * awaiting approval with pending calls.
 */
export async function processApprovalDecisions(
  conversation: ConversationState,
  approvalDecisions: Array<{ tool_call_id: string; approved: boolean; result?: unknown }>,
  context: {
    requestId: string;
    tenant?: { id: string; name: string };
    agentDefinition?: RunAgentChatLoopArgs['agentDefinition'];
    router?: Router;
    loadedSkills?: string[];
    conversationId?: string;
  },
): Promise<{ processed: boolean }> {
  if (
    !approvalDecisions ||
    approvalDecisions.length === 0 ||
    conversation.status !== 'awaiting_approval' ||
    !conversation.pendingToolCalls
  ) {
    return { processed: false };
  }

  const approvedCalls: typeof conversation.pendingToolCalls = [];
  const rejectedCalls: typeof conversation.pendingToolCalls = [];

  for (const decision of approvalDecisions) {
    const pending = conversation.pendingToolCalls.find((tc) => tc.id === decision.tool_call_id);
    if (pending) {
      if (decision.approved) approvedCalls.push(pending);
      else rejectedCalls.push(pending);
    }
  }

  for (const tc of approvedCalls) {
    const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);
    const mockToolCall: ToolCall = {
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: args },
    };
    const result = await executeToolCall(mockToolCall, {
      requestId: context.requestId,
      tenant: context.tenant,
      agentDefinition: context.agentDefinition,
      router: context.router,
      loadedSkills: context.loadedSkills,
      conversationId: context.conversationId,
    });
    conversation.messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: result.error
        ? JSON.stringify({ error: result.error.message })
        : JSON.stringify(result.result),
    });
  }

  for (const tc of rejectedCalls) {
    conversation.messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify({ error: 'Tool call rejected by user' }),
    });
  }

  Object.assign(
    conversation,
    updateState(conversation, { pendingToolCalls: undefined, status: 'in_progress' }),
  );

  return { processed: true };
}

/**
 * Commit the loop's accumulated messages + status into the conversation object
 * in place. The route holds the same object reference, so this is what makes
 * per-turn checkpointing and the final durable upsert see the live state.
 */
function commitConversationState(
  conversation: ConversationState,
  messages: any[],
  status: ConversationState['status'],
): void {
  Object.assign(conversation, updateState(conversation, { messages, status }));
}

export async function runAgentChatLoop(args: RunAgentChatLoopArgs): Promise<AgentChatLoopResult> {
  const {
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
    stream,
    onStreamEvent,
    buildSystemPrompt,
    agentDefinition,
    loadedSkillIds,
    runtime,
    executionId,
    conversationId,
    onCheckpoint,
    qualityTarget,
    godmodeWrap = false,
  } = args;

  // conversationId is optional; fall back to the conversation's own id so
  // callers that don't thread it still persist telemetry correctly.
  const resolvedConversationId = conversationId ?? conversation.id;

  // Opt-in flags; honored from either the args or the request body.
  const approvalRequired = args.approvalRequired ?? body.approvalRequired ?? false;
  const approvalDecisions = args.approvalDecisions ?? body.approvalDecisions;
  const stopConditions = args.stopWhen ?? body.stopWhen ?? [];
  const target = qualityTarget ?? parseQualityTarget(undefined);

  // Resume path: process human approval decisions for a previously paused run
  // BEFORE the loop so the model sees the injected tool-result messages.
  if (approvalDecisions && approvalDecisions.length > 0) {
    await processApprovalDecisions(conversation, approvalDecisions, {
      requestId,
      tenant,
      agentDefinition,
      router,
      loadedSkills: loadedSkillIds,
      conversationId: resolvedConversationId,
    });
  }

  const messages = [...conversation.messages] as any[];

  // Opt-in plan-then-execute: produce a one-shot plan BEFORE the ReAct loop and
  // keep it in front of the model every turn. Off unless definition.planMode.
  const definition = context?.definition;
  const planMode = definition?.planMode === true;
  const historyCompaction = definition?.historyCompaction === true;
  let planText: string | null = null;
  if (planMode) {
    const firstUser = messages.find((m: any) => m.role === 'user')?.content ?? '';
    planText = await runPlanPhase({
      router,
      model,
      tenant,
      requestId,
      systemPrompt: await buildSystemPrompt(0),
      firstUserMessage: firstUser,
    });
    if (stream && planText) {
      onStreamEvent('plan', { resolvedConversationId, plan: planText });
    }
  }
  let lastResponseText = '';
  let totalTokensUsed = 0;
  let totalCost = 0;
  let budgetExceeded = false;
  let awaitingApproval = false;
  let finalUsage: any;
  const allSteps: AgentChatLoopResult['allSteps'] = [];
  const allStepResults: StepResult[] = [];
  const sdkStopConditions = buildStopConditions(
    stopConditions,
    () => lastResponseText,
    () => totalTokensUsed,
    () => totalCost,
  );

  if (stream) {
    onStreamEvent('agent_start', {
      requestId,
      agentInstanceId: context?.instanceId,
      agentName: context?.definition?.name,
      model,
      resolvedConversationId,
    });
  }

  for (let turn = 0; turn < maxSteps; turn++) {
    let systemPromptText = await buildSystemPrompt(turn);
    // Keep the plan in front of the model every turn (plan-then-execute mode).
    if (planText) {
      systemPromptText += `\n\nEXECUTION PLAN (follow these steps):\n${planText}`;
    }
    messages[0] = { role: 'system', content: systemPromptText };

    const unifiedRequest = toUnifiedRequest(
      {
        model,
        messages,
        tools: agentToolDefs,
        temperature: body.temperature,
        max_tokens: body.maxTokens,
        stream,
      },
      requestId,
      tenant,
    );

    let response: UnifiedResponse;

    try {
      ({ response } = await completeAgentTurn(router, unifiedRequest, target, requestId, godmodeWrap));
    } catch (error) {
      const decision = resolveFallbackForError(runtime, error, context.definition, model);

      if (!decision.retry) {
        throw error;
      }

      logger.warn(
        { requestId, resolvedConversationId, reason: decision.reason, fallback: decision.fallback },
        'agent_run_retry',
      );

      if (stream) {
        onStreamEvent('model_retry', {
          resolvedConversationId,
          reason: decision.reason,
          fallbackModel: decision.fallback,
        });
      }

      const retryRequest = toUnifiedRequest(
        {
          model: decision.fallback ?? model,
          messages,
          tools: agentToolDefs,
          temperature: body.temperature,
          max_tokens: body.maxTokens,
          stream,
        },
        requestId,
        tenant,
      );

      ({ response } = await completeAgentTurn(router, retryRequest, target, requestId, godmodeWrap));
    }

    const toolCalls = response.message?.tool_calls ?? [];
    const responseText =
      typeof response.message?.content === 'string' ? response.message.content : '';
    lastResponseText = responseText;
    finalUsage = response.usage;

    if (response.usage) {
      totalTokensUsed += response.usage.total_tokens ?? 0;
      const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
      totalCost += stepCost;
    }

    // Stop if cost budget exceeded
    if (body.max_cost_budget && totalCost >= body.max_cost_budget) {
      if (response.message) messages.push(response.message);
      commitConversationState(conversation, messages, 'completed');
      budgetExceeded = true;
      if (stream) {
        onStreamEvent('budget_exceeded', {
          resolvedConversationId,
          max_cost_budget: body.max_cost_budget,
          totalCost,
        });
      }
      onCheckpoint?.(turn, updateState(conversation, { messages, status: 'in_progress' }));
      break;
    }

    if (stream) {
      onStreamEvent('turn', {
        turn,
        resolvedConversationId,
        message: response.message,
        model: response.modelId,
        usage: response.usage,
        finish_reason: response.finishReason,
      });
    }

    // Accumulate the step result for SDK stop-condition evaluation.
    const stepResult: StepResult = {
      toolCalls: toolCalls.map((tc: ToolCall) => ({ name: tc.function.name })),
      usage: response.usage ? { totalTokens: response.usage.total_tokens } : undefined,
      finishReason: response.finishReason ?? undefined,
    };
    allStepResults.push(stepResult);

    // Stop if no tool calls, at step limit, or a stop condition is met.
    if (
      toolCalls.length === 0 ||
      turn === maxSteps - 1 ||
      (await isStopConditionMet({ stopConditions: sdkStopConditions, steps: allStepResults }))
    ) {
      if (response.message) messages.push(response.message);
      commitConversationState(conversation, messages, 'completed');
      allSteps.push({
        turn,
        message: response.message,
        tool_calls: toolCalls,
        tool_results: [],
      });
      onCheckpoint?.(turn, updateState(conversation, { messages, status: 'in_progress' }));
      break;
    }

    // Filter tool calls against agent's allowedTools
    const allowedCalls = toolCalls.filter((tc: ToolCall) =>
      agentTools.length === 0 || agentTools.includes(tc.function.name),
    );
    const blockedCalls = toolCalls.filter(
      (tc: ToolCall) => agentTools.length > 0 && !agentTools.includes(tc.function.name),
    );

    // Notify about blocked calls
    if (blockedCalls.length > 0 && stream) {
      onStreamEvent('tool_blocked', {
        turn,
        blocked: blockedCalls.map((tc: ToolCall) => ({
          name: tc.function.name,
          reason: 'Not in agent allowedTools',
        })),
      });
    }

    if (stream) {
      onStreamEvent('tool_calls', {
        turn,
        tool_calls: allowedCalls.map((tc: ToolCall) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
      });
    }

    // Approval gate: pause before executing any tool when human approval is
    // required. The conversation is persisted in an awaiting_approval state;
    // a later /resume supplies approvalDecisions.
    if (approvalRequired && allowedCalls.length > 0) {
      const pendingToolCalls = allowedCalls.map((tc: ToolCall) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
      if (response.message) messages.push(response.message);
      Object.assign(
        conversation,
        updateState(conversation, {
          messages,
          pendingToolCalls,
          status: 'awaiting_approval',
        }),
      );
      allSteps.push({
        turn,
        message: response.message,
        tool_calls: allowedCalls,
        tool_results: [],
      });
      if (stream) {
        onStreamEvent('approval_required', {
          turn,
          resolvedConversationId,
          pending_tool_calls: pendingToolCalls,
        });
        onStreamEvent('done', {
          status: 'awaiting_approval',
          conversationId: resolvedConversationId,
        });
      }
      awaitingApproval = true;
      break;
    }

    // Execute tool calls
    const assistantMessage = { ...response.message };
    messages.push(assistantMessage);

    const executionPromises = allowedCalls.map((tc: ToolCall) =>
      executeToolCall(tc, {
        requestId,
        tenant,
        agentDefinition,
        router,
        loadedSkills: loadedSkillIds,
        // Key the coding sandbox on the conversation, not the request, so
        // every turn of this (possibly resumed) session shares one workspace.
        conversationId: resolvedConversationId,
      }),
    );

    const settled = await Promise.allSettled(executionPromises);
    const stepResults = settled
      .filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> =>
          s.status === 'fulfilled',
      )
      .map((s) => s.value);

    if (stream) {
      onStreamEvent('tool_results', { turn, results: stepResults });
    }

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

    onCheckpoint?.(turn, updateState(conversation, { messages, status: 'in_progress' }));

    // Opt-in history compaction: once the transcript is large, fold the early
    // tool-activity turns into a single rolling summary. Non-fatal — on any
    // failure we keep the full transcript (ReAct behavior unchanged).
    // Compaction thresholds live in the loop engine (see migration 058);
    // AgentDefinition only carries the on/off `historyCompaction` flag.
    const { threshold, keepRecent } = resolveCompactionParams({});
    if (historyCompaction && messages.length > threshold) {
      const compacted = await summarizeHistory({ router, model, tenant, requestId, messages, keepRecent });
      if (compacted) {
        messages.length = 0;
        messages.push(...compacted.messages);
        if (stream) {
          onStreamEvent('context_compacted', { resolvedConversationId, summary: compacted.summary });
        }
      }
    }
  }

  try {
    if (executionId && context) {
      try {
        const evaluation = await runtime.evaluateExecution(context, {
          id: executionId,
          output: lastResponseText,
          toolsUsed: allSteps.flatMap((s) => s.tool_calls.map((tc) => tc.function?.name ?? tc.name)),
          inputTokens: totalTokensUsed,
          outputTokens: totalTokensUsed,
          durationMs: Date.now(),
          status: budgetExceeded ? 'error' : 'success',
          error: budgetExceeded ? 'budget_exceeded' : null,
        }, allSteps, maxSteps);
      } catch (evaluationError) {
        logger.warn({ executionId, error: evaluationError }, 'failed_to_evaluate_execution');
      }
    }
  } catch (persistenceError) {
    logger.warn({ resolvedConversationId, executionId, error: persistenceError }, 'failed_to_persist_telemetry');
  }

  return {
    lastResponseText,
    totalTokensUsed,
    totalCost,
    stepsCompleted: allSteps.length || maxSteps,
    budgetExceeded,
    awaitingApproval,
    finalUsage,
    allSteps,
  };
}
