import { buildReceptionistReceipt } from '../lib/receptionist-receipt.js';
import { ProviderUnavailableError } from '@dmr-x/core';
import type { ToolCall, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { isMetaModel, isInferenceSettlementError, isTrustedExternalAccounting, markTrustedExternalAccounting } from '@dmr-x/router';
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
import { agentRegistryService } from '@dmr-x/agent-registry';

import { executeToolCall } from './tools.routes.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { markAdmittedAgentRequest } from '../lib/agent-admission.js';

// ---------------------------------------------------------------------------
// Tool call retry helper
//
// Retries a tool call up to maxRetries times with exponential backoff.
// A tool call fails with tr.error — we classify the error as transient
// (retryable) or persistent (non-retryable). Persistent errors like
// schema validation or missing parameters are NOT retried since they
// will fail the same way. Transient errors (provider errors, timeouts)
// are retried with exponential backoff.
// ---------------------------------------------------------------------------
async function executeToolCallWithRetry(
  tc: ToolCall,
  ctx: {
    requestId: string;
    tenant?: { id: string; name: string };
    agentDefinition: { id: string; name: string; tenantId: string; allowedTools: string[] };
    router: Router;
    loadedSkills: string[];
    conversationId: string;
  },
  maxRetries: number,
  baseDelayMs: number,
) {
  let lastResult: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeToolCall(tc, ctx);
    if (!result.error) return result;
    lastResult = result;
    // Don't retry on the last attempt
    if (attempt === maxRetries) break;
    // Only retry transient errors: ProviderUnavailableError, timeouts
    const errName = result.error?.constructor?.name ?? '';
    const isTransient =
      errName === 'ProviderUnavailableError' ||
      errName === 'TimeoutError' ||
      (result.error?.message && /timeout|econnreset|socket|network|rate.?limit|429|503|502/i.test(result.error.message));
    if (!isTransient) break;
    const delay = baseDelayMs * Math.pow(2, attempt);
    logger.warn(
      { toolCallId: tc.id, attempt: attempt + 1, delayMs: delay, error: result.error?.message },
      'agent-chat-loop: retrying tool call',
    );
    await new Promise((r) => setTimeout(r, delay));
  }
  return lastResult;
}

// ---------------------------------------------------------------------------
// Tool call dedupe
//
// Observed on live runs: models re-issue the SAME tool call inside one turn
// AND across turns, burning the step budget re-asking a question they already
// have the answer to. A 'Codebase Archaeologist' run with maxSteps=4 produced
// `recall, recall, list_files, list_files, search_files, search_files` — every
// tool executed twice with near-identical arguments.
//
// Two defences, both keyed on (tool name + NORMALIZED arguments):
//   1. within-turn : execute once, fan the single result out to every
//                    tool_call_id that asked for it.
//   2. cross-turn  : replay the cached earlier result instead of re-executing.
//
// CRITICAL: the OpenAI tool protocol requires exactly one tool message per
// tool_call_id. Dedupe therefore never DROPS a call — it only avoids the
// second EXECUTION, and always emits a result row per id.
//
// Gated by DMRX_AGENT_TOOL_DEDUPE (default on; set to 0/false/off to disable).
// ---------------------------------------------------------------------------

/** Recursively sort object keys so {"a":1,"b":2} and {"b":2,"a":1} normalize equal. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out;
  }
  return value;
}

/**
 * Canonical form of a tool call's argument string. Parses JSON and sorts keys
 * so key order and whitespace do not defeat the comparison. Unparseable
 * arguments fall back to the trimmed raw string (still a valid equality test).
 */
export function normalizeToolArguments(raw: string | undefined | null): string {
  const text = (raw ?? '').trim();
  if (!text) return '{}';
  try {
    return JSON.stringify(sortKeysDeep(JSON.parse(text)));
  } catch {
    return text;
  }
}

/** Identity of a tool call for dedupe purposes: name + normalized arguments. */
export function toolCallDedupeKey(tc: ToolCall): string {
  return `${tc.function.name}\u0000${normalizeToolArguments(tc.function.arguments)}`;
}

function isToolDedupeEnabled(): boolean {
  const raw = (process.env.DMRX_AGENT_TOOL_DEDUPE ?? '').trim().toLowerCase();
  if (!raw) return true; // default ON
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

type ToolExecResult = {
  tool_call_id: string;
  tool_name: string;
  result: unknown;
  error?: { message: string };
  /** Set when this row was fanned out from another execution rather than executed. */
  deduped?: 'within_turn' | 'cross_turn';
  /** The tool_call_id whose real execution produced this row. */
  deduped_from?: string;
};

/**
 * Split a turn's allowed calls into the ones that must really execute and the
 * ones whose result can be copied (same turn) or replayed (earlier turn).
 */
function planToolExecution(
  allowedCalls: ToolCall[],
  cache: Map<string, ToolExecResult>,
  enabled: boolean,
): {
  toExecute: ToolCall[];
  withinTurnAliases: Array<{ tc: ToolCall; key: string }>;
  crossTurnReplays: Array<{ tc: ToolCall; key: string }>;
  keyOf: Map<string, string>;
} {
  const toExecute: ToolCall[] = [];
  const withinTurnAliases: Array<{ tc: ToolCall; key: string }> = [];
  const crossTurnReplays: Array<{ tc: ToolCall; key: string }> = [];
  const keyOf = new Map<string, string>();
  const firstSeen = new Set<string>();

  for (const tc of allowedCalls) {
    if (!enabled) {
      toExecute.push(tc);
      continue;
    }
    const key = toolCallDedupeKey(tc);
    keyOf.set(tc.id, key);
    if (cache.has(key)) {
      crossTurnReplays.push({ tc, key });
      continue;
    }
    if (firstSeen.has(key)) {
      withinTurnAliases.push({ tc, key });
      continue;
    }
    firstSeen.add(key);
    toExecute.push(tc);
  }
  return { toExecute, withinTurnAliases, crossTurnReplays, keyOf };
}

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
  /** Measured prompt-token sum across every model call in this run. */
  totalPromptTokens: number;
  /** Measured completion-token sum across every model call in this run. */
  totalCompletionTokens: number;
  totalCost: number;
  stepsCompleted: number;
  budgetExceeded: boolean;
  /** True when the loop paused for human approval (status awaiting_approval). */
  awaitingApproval?: boolean;
  /** True when the run hit the global wall-clock deadline (DMRX_AGENTIC_RUN_TIMEOUT_MS). */
  runTimedOut?: boolean;
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
  /**
   * Preflight holdId from reserveAgentRun. When present, the unified requests
   * built in this loop are marked as trusted external accounting so the router's
   * inference lease does not debit the tenant a second time (the hold already
   * owns the tenant debit via settleAgentRun).
   */
  holdId?: string;
  /**
   * True when admission was authorized only by zero-cost pricing or a
   * free-only alias resolution. Every model request in this loop inherits the
   * hard free-only router constraint when set.
   */
  freeOnly?: boolean;
  /** Opt-in: route per-turn model calls through the godmode wrap using the
   *  agent's own resolved model (any family) instead of plain router routing.
   *  Falls back to normal routing when the wrap is unavailable. */
  godmodeWrap?: boolean;
}

const MAX_TURN_RETRIES = 2;

// Per-turn model-call timeout. A hung provider call must not hang the whole
// durable run; abort the single turn and surface a recoverable error.
const TURN_TIMEOUT_MS = Number(process.env.DMRX_AGENTIC_TURN_TIMEOUT_MS) || 120_000;

// Global wall-clock deadline for one agent run (all turns). A run that exceeds
// it is interrupted before the next model call instead of running unbounded.
const RUN_TIMEOUT_MS = Number(process.env.DMRX_AGENTIC_RUN_TIMEOUT_MS) || 900_000;

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
  freeOnly = false,
  holdId?: string,
): UnifiedRequest {
  const request: UnifiedRequest = {
    modality: 'llm',
    model: body.model,
    messages: body.messages,
    tools: body.tools,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream ?? false,
    metadata: {
      requestId,
      tenant,
      ...(freeOnly ? { freeTierStrategy: 'free_only' } : {}),
    },
  };
  if (holdId) markAdmittedAgentRequest(request, holdId);
  return request;
}

function resolveFreeOnlyPolicy(model: string, router: Router, requested: boolean | undefined): boolean {
  if (requested !== undefined) return requested;

  // A concrete model may prove zero cost from the live candidate catalog. Do
  // not infer free status from an alias name: aliases can resolve to mixed
  // paid/free pools unless admission explicitly supplied free-only evidence.
  if (model.includes('/')) {
    const slash = model.indexOf('/');
    const providerId = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    // Minimal/fake routers may not expose the catalog accessor; without proof
    // the run is treated as not-free rather than throwing.
    if (typeof (router as any)?.getCandidate !== 'function') return false;
    const candidate = router.getCandidate(providerId, modelId);
    if (
      candidate &&
      (candidate.costPerInputToken ?? 0) <= 0 &&
      (candidate.costPerOutputToken ?? 0) <= 0
    ) {
      return true;
    }
    return false;
  }

  if (typeof (router as any)?.getEffectiveCostFilter !== 'function') return false;
  if (router.getEffectiveCostFilter(model) === 'free') return true;
  if (isMetaModel(model)) {
    throw new Error('free-only admission proof is required for an unresolved alias');
  }
  return false;
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
  holdId?: string;
  onUsage: (usage: UnifiedResponse['usage']) => void;
  freeOnly: boolean;
}): Promise<string | null> {
  const { router, model, tenant, requestId, systemPrompt, firstUserMessage, holdId } = args;
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
        args.freeOnly,
        holdId,
      ),
      { path: '/v1/agents/plan' },
    );
    args.onUsage(response.usage);
    const plan =
      typeof response.message?.content === 'string' ? response.message.content.trim() : '';
    return plan.length > 0 ? plan : null;
  } catch (error) {
    if (isInferenceSettlementError(error)) throw error;
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
  holdId?: string;
  onUsage: (usage: UnifiedResponse['usage']) => void;
  freeOnly: boolean;
}): Promise<{ messages: any[]; summary: string } | null> {
  const { router, model, tenant, requestId, messages, keepRecent, holdId } = args;
  // messages[0] is the live system prompt; we compact the user/assistant/tool
  // turns that precede the recent tail.
  let tailStart = Math.max(1, messages.length - keepRecent);
  // Never retain a tool reply while compacting away its requesting assistant.
  while (tailStart > 1 && messages[tailStart]?.role === 'tool') tailStart--;
  const head = messages.slice(1, tailStart);
  const tail = messages.slice(tailStart);
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
        args.freeOnly,
        holdId,
      ),
      { path: '/v1/agents/compact' },
    );
    args.onUsage(response.usage);
    const summary =
      typeof response.message?.content === 'string' ? response.message.content.trim() : '';
    if (!summary) return null;
    return {
      // Re-insert the live system prompt, then the rolling summary, then the tail.
      messages: [messages[0], { role: 'system', content: `PRIOR CONTEXT SUMMARY:\n${summary}` }, ...tail],
      summary,
    };
  } catch (error) {
    if (isInferenceSettlementError(error)) throw error;
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
  freeOnly: boolean,
): Promise<{ response: any }> {
  const routedRequest = freeOnly
    ? { ...unifiedRequest, metadata: { ...unifiedRequest.metadata, freeTierStrategy: 'free_only' } }
    : unifiedRequest;
  if (isTrustedExternalAccounting(unifiedRequest)) markTrustedExternalAccounting(routedRequest);
  if (!godmodeWrap) {
    return routeWithTimeout(
      router,
      routedRequest,
      target,
    );
  }

  const { wrapViaGodmode, isGodmodeStrict } = await import('../lib/godmode-guard.js');
  const candidates = router.getCandidates();
  const result = await wrapViaGodmode({
    requestId,
    messages: (unifiedRequest.messages ?? []) as any[],
    model: unifiedRequest.model ?? '',
    candidates,
    costFilter: freeOnly ? 'free' : 'all',
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
  return routeWithTimeout(
    router,
    routedRequest,
    target,
  );
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
interface ApprovalJournalState extends ConversationState { approvalExecutionIntents?: string[] }
const approvalExecutionsInFlight = new WeakSet<ConversationState>();

export async function processApprovalDecisions(
  conversation: ConversationState,
  approvalDecisions: Array<{ tool_call_id: string; approved: boolean; result?: unknown }>,
  context: { requestId: string; tenant?: { id: string; name: string }; agentDefinition?: RunAgentChatLoopArgs['agentDefinition']; router?: Router; loadedSkills?: string[]; conversationId?: string; onCheckpoint?: () => void },
): Promise<{ processed: boolean }> {
  if (!approvalDecisions?.length || conversation.status !== 'awaiting_approval' || !conversation.pendingToolCalls || approvalExecutionsInFlight.has(conversation)) return { processed: false };
  approvalExecutionsInFlight.add(conversation);
  try {
    const journal = conversation as ApprovalJournalState;
    const decisions = new Map<string, boolean>();
    for (const d of approvalDecisions) decisions.set(d.tool_call_id, decisions.get(d.tool_call_id) === false ? false : d.approved);
    let processed = false;
    for (const tc of [...conversation.pendingToolCalls]) {
      const approved = decisions.get(tc.id);
      if (approved === undefined) continue;
      let content: string;
      let rejected: unknown;
      if (!approved) content = JSON.stringify({ executed: false, error: 'Tool call rejected by user' });
      else if (journal.approvalExecutionIntents?.includes(tc.id)) {
        content = JSON.stringify({ error: 'Previous approval execution outcome is unknown; no automatic replay.' });
        rejected = new Error('Previous approval execution outcome is unknown');
      } else {
        // Persist intent before the side effect. A crash after dispatch but
        // before result persistence must fail closed on approval redelivery.
        journal.approvalExecutionIntents = [...(journal.approvalExecutionIntents ?? []), tc.id];
        context.onCheckpoint?.();
        const call: ToolCall = { id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) } };
        try {
          const result = await executeToolCall(call, context);
          content = result.error ? JSON.stringify({ error: result.error.message }) : JSON.stringify(result.result) ?? 'null';
        } catch (error) {
          content = JSON.stringify({ error: 'Tool execution outcome is unknown; no automatic replay.' });
          rejected = error;
        }
      }
      conversation.messages.push({ role: 'tool', tool_call_id: tc.id, content });
      const remaining = conversation.pendingToolCalls!.filter(call => call.id !== tc.id);
      journal.approvalExecutionIntents = journal.approvalExecutionIntents?.filter(id => id !== tc.id);
      Object.assign(conversation, updateState(conversation, { pendingToolCalls: remaining.length ? remaining : undefined, status: rejected ? 'interrupted' : remaining.length ? 'awaiting_approval' : 'in_progress' }));
      processed = true;
      context.onCheckpoint?.();
      if (rejected) throw rejected;
    }
    return { processed };
  } finally { approvalExecutionsInFlight.delete(conversation); }
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

// ---------------------------------------------------------------------------
// Thought-block sanitization + safe placeholders.
//
// Providers may return assistant content wrapped in hidden <thought> blocks.
// That internal reasoning must never reach the caller: strip it before ANY
// persistence (conversation.messages), telemetry (allSteps), streaming event,
// or return (lastResponseText), for both original and recovery turns. The
// spread preserves tool_calls / role / other fields — only content is replaced.
const THOUGHT_BLOCK_RE = /<thought>[\s\S]*?<\/thought>/gi;
function stripThoughtBlocks(text: string): string {
  return (text ?? '').replace(THOUGHT_BLOCK_RE, '').trim();
}
function sanitizedAssistantMessage(message: any, visibleText: string): any {
  if (!message) return message;
  if (typeof message.content !== 'string') return message;
  return { ...message, content: visibleText };
}

const EMPTY_VISIBLE_REPLY_PLACEHOLDER =
  '[dmr-x] No agent output produced: the model returned no user-visible text for this turn.';
const AWAITING_APPROVAL_PLACEHOLDER =
  '[dmr-x] No agent output produced: awaiting human approval before tool execution.';
const RUN_TIMEOUT_PLACEHOLDER =
  '[dmr-x] No agent output produced: run timed out before a reply.';

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
    freeOnly: requestedFreeOnly,
    holdId,
  } = args;

  // conversationId is optional; fall back to the conversation's own id so
  // callers that don't thread it still persist telemetry correctly.
  const resolvedConversationId = conversationId ?? conversation.id;

  // Opt-in flags; honored from either the args or the request body.
  const approvalRequired = args.approvalRequired ?? body.approvalRequired ?? false;
  const approvalDecisions = args.approvalDecisions ?? body.approvalDecisions;
  const stopConditions = args.stopWhen ?? body.stopWhen ?? [];
  const target = qualityTarget ?? parseQualityTarget(undefined);
  const freeOnly = resolveFreeOnlyPolicy(model, router, requestedFreeOnly);

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
      onCheckpoint: () => onCheckpoint?.(-1, conversation),
    });
  }

  const messages = [...conversation.messages] as any[];

  let totalTokensUsed = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = 0;
  const recordAuxiliaryUsage = (usage: UnifiedResponse['usage']) => {
    if (!usage) return;
    totalTokensUsed += usage.total_tokens ?? 0;
    totalPromptTokens += (usage as any).prompt_tokens ?? 0;
    totalCompletionTokens += (usage as any).completion_tokens ?? 0;
    totalCost += (usage as any).cost ?? (usage as any).total_cost ?? 0;
  };

  // Opt-in plan-then-execute: produce a one-shot plan BEFORE the ReAct loop and
  // keep it in front of the model every turn. Off unless definition.planMode.
  const definition = context?.definition;
  const planMode = definition?.planMode === true;
  const historyCompaction = definition?.historyCompaction === true;
  let planText: string | null = null;
  if (planMode && conversation.status !== 'awaiting_approval') {
    const firstUser = messages.find((m: any) => m.role === 'user')?.content ?? '';
    planText = await runPlanPhase({
      router,
      model,
      tenant,
      requestId,
      systemPrompt: await buildSystemPrompt(0),
      firstUserMessage: firstUser,
      holdId,
      onUsage: recordAuxiliaryUsage,
      freeOnly,
    });
    if (stream && planText) {
      onStreamEvent('plan', { resolvedConversationId, plan: planText });
    }
  }
  let lastResponseText = '';
  let budgetExceeded = false;
  let awaitingApproval = conversation.status === 'awaiting_approval';
  let runTimedOut = false;
  let responseTruncated = false;
  // Set when the loop exits on the step limit while the model was still asking
  // for tools. The final pending calls did not execute; the runtime-owned
  // receipt reports this interruption without asking the model for findings.
  let stepLimitedWithPendingTools = false;
  let stopConditionWithPendingTools = false;
  // Set when the loop exits on a terminal turn with NO tool calls (a normal
  // stop / stop-condition exit). Used to detect a thought-only terminal reply
  // that stripped to empty prose and needs ONE recovery completion.
  let terminalNoToolStop = false;
  let providerFailure = false;
  let finalUsage: any;
  const allSteps: AgentChatLoopResult['allSteps'] = [];
  const allStepResults: StepResult[] = [];

  // A failed follow-up cannot erase completed coordinator side effects. Keep
  // the real rows/accounting and exit through runtime-owned reporting instead
  // of the route catch, which lacks this run's accumulated evidence.
  const retainReceptionistProviderFailure = (error: unknown): boolean => {
    if (isInferenceSettlementError(error)) return false;
    if (agentDefinition?.name !== '__receptionist' || !buildReceptionistReceipt(allSteps)) return false;
    providerFailure = true;
    commitConversationState(conversation, messages, 'interrupted');
    logger.warn({ requestId, resolvedConversationId }, 'receptionist_provider_followup_failed_with_recorded_actions');
    return true;
  };

  // Run-scoped tool-result cache for CROSS-TURN repeat detection, keyed on
  // (tool name + normalized arguments). Populated only with results that were
  // really executed in this run; errors are cached too so a failing call is not
  // hammered every turn (the reflection prompt already tells the model to change
  // its approach). Lives for the duration of one runAgentChatLoop call only.
  const toolResultCache = new Map<string, ToolExecResult>();
  const toolDedupeEnabled = isToolDedupeEnabled();
  let dedupedCallCount = 0;
  let stalledTurnNudged = false;

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

  const runStartedAt = Date.now();
  for (let turn = 0; turn < maxSteps && !awaitingApproval; turn++) {
    // Global wall-clock deadline: stop BEFORE making another model call.
    const elapsedMs = Date.now() - runStartedAt;
    if (elapsedMs > RUN_TIMEOUT_MS) {
      commitConversationState(conversation, messages, 'interrupted');
      logger.warn(
        { resolvedConversationId, elapsedMs, runTimeoutMs: RUN_TIMEOUT_MS },
        'agent_run_timeout',
      );
      if (stream) {
        onStreamEvent('run_timeout', { resolvedConversationId, elapsedMs });
      }
      runTimedOut = true;
      break;
    }
    let systemPromptText = await buildSystemPrompt(turn);
    // Keep the plan in front of the model every turn (plan-then-execute mode).
    if (planText) {
      systemPromptText += `\n\nEXECUTION PLAN (follow these steps):\n${planText}`;
    }
    // The system prompt belongs at the head of the transcript. It is NOT safe to
    // assume index 0 already holds one: a conversation resumed from a
    // `claim_reserved` placeholder (see agent-chat.routes.ts) arrives with an
    // empty-or-system-less transcript whose first entry is the CALLER'S USER
    // MESSAGE. A blind `messages[0] = ...` then overwrote that message with the
    // system prompt, silently discarding the entire request — every agent on the
    // fleet answered its persona greeting instead of the user's task, and a
    // ~1200-token prompt billed the identical 5077 tokens as a one-word "hi".
    // Replace in place only when a system message is actually there; otherwise
    // prepend, so the user's turn is preserved.
    if (messages.length > 0 && messages[0]?.role === 'system') {
      messages[0] = { role: 'system', content: systemPromptText };
    } else {
      messages.unshift({ role: 'system', content: systemPromptText });
    }

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
      freeOnly,
      holdId,
    );

    let response: UnifiedResponse;

    try {
      ({ response } = await completeAgentTurn(router, unifiedRequest, target, requestId, godmodeWrap, freeOnly));
    } catch (error) {
      if (isInferenceSettlementError(error)) throw error;
      // When every provider in the router's pool is rate-limited or down,
      // the router throws ProviderUnavailableError with a retryAfter hint.
      // The agent loop must respect that hint and back off — retrying
      // immediately just re-hits the same exhausted pool and fails again.
      if (error instanceof ProviderUnavailableError && error.retryAfter > 0) {
        const maxWaitMs = 30_000;
        const waitMs = Math.min(error.retryAfter * 1000, maxWaitMs);
        logger.warn(
          { requestId, resolvedConversationId, waitMs, retryAfter: error.retryAfter },
          'agent_run_provider_unavailable_backing_off',
        );
        if (stream) {
          onStreamEvent('provider_backoff', {
            resolvedConversationId,
            waitMs,
            retryAfter: error.retryAfter,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      const decision = resolveFallbackForError(runtime, error, context.definition, model);

      if (!decision.retry) {
        if (retainReceptionistProviderFailure(error)) break;
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
        freeOnly,
        holdId,
      );

      try {
        ({ response } = await completeAgentTurn(router, retryRequest, target, requestId, godmodeWrap, freeOnly));
      } catch (retryError) {
        if (retainReceptionistProviderFailure(retryError)) break;
        throw retryError;
      }
    }

    const toolCalls = response.message?.tool_calls ?? [];
    let responseText =
      typeof response.message?.content === 'string' ? response.message.content : '';
    responseText = stripThoughtBlocks(responseText);
    // Sanitized copy for persistence/events: visible prose only, tool_calls preserved.
    const sanitizedMessage = sanitizedAssistantMessage(response.message, responseText);
    // Only OVERWRITE the running reply when this turn actually produced prose.
    //
    // Providers emit `content: ''` (or null) on a pure tool-call turn. Since the
    // loop breaks when `turn === maxSteps - 1`, a step-limited run ends on such a
    // turn — and an unconditional assignment wiped whatever the agent had already
    // said, handing the caller an empty reply after real work. Observed across the
    // DMR-X agent fleet: every agent that invoked a tool returned 0 characters.
    if (responseText) {
      lastResponseText = responseText;
    }
    finalUsage = response.usage;

    if (response.usage) {
      totalTokensUsed += response.usage.total_tokens ?? 0;
      totalPromptTokens += (response.usage as any).prompt_tokens ?? 0;
      totalCompletionTokens += (response.usage as any).completion_tokens ?? 0;
      const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
      totalCost += stepCost;
    }

    // Stop if cost budget exceeded
    if (body.max_cost_budget && totalCost >= body.max_cost_budget) {
      if (sanitizedMessage) messages.push(sanitizedMessage);
      for (const tc of toolCalls) messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ executed: false, error: 'Tool call withheld by cost budget.' }) });
      allSteps.push({ turn, message: sanitizedMessage, tool_calls: toolCalls, tool_results: [] });
      commitConversationState(conversation, messages, 'interrupted');
      budgetExceeded = true;
      if (stream) {
        onStreamEvent('budget_exceeded', {
          resolvedConversationId,
          max_cost_budget: body.max_cost_budget,
          totalCost,
        });
      }
      onCheckpoint?.(turn, conversation);
      break;
    }

    if (stream) {
      onStreamEvent('turn', {
        turn,
        resolvedConversationId,
        message: sanitizedMessage,
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
    //
    // NOTE ON THE STEP LIMIT: pending calls are retained but NOT executed.
    // Their tool_results stay empty. After this loop, the deterministic runtime
    // receipt replaces final prose and protocol-only executed:false rejections
    // pair the pending IDs in durable messages; neither is a provider step or
    // evidence of tool execution. Raw assistant prose remains in the transcript.

    responseTruncated = response.finishReason === 'length';
    if (
      responseTruncated ||
      toolCalls.length === 0 ||
      turn === maxSteps - 1 ||
      (await isStopConditionMet({ stopConditions: sdkStopConditions, steps: allStepResults }))
    ) {
      if (sanitizedMessage) messages.push(sanitizedMessage);
      commitConversationState(conversation, messages, toolCalls.length > 0 || responseTruncated ? 'interrupted' : 'completed');
      allSteps.push({
        turn,
        message: sanitizedMessage,
        tool_calls: toolCalls,
        tool_results: [],
      });
      if (toolCalls.length > 0 && !responseTruncated) {
        stepLimitedWithPendingTools = true;
        stopConditionWithPendingTools = turn < maxSteps - 1;
      }
      for (const tc of toolCalls) messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ executed: false, error: responseTruncated ? 'Tool call withheld because provider response was truncated.' : stopConditionWithPendingTools ? 'Tool call withheld by configured stop condition.' : 'Tool call was not executed because the run reached its step limit.' }) });
      // A pure no-tool exit (final stop turn, or a stop condition firing on a
      // text-only turn) is the path where a thought-only reply strips to ''.
      if (toolCalls.length === 0) terminalNoToolStop = true;
      onCheckpoint?.(turn, conversation);
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
      if (sanitizedMessage) messages.push(sanitizedMessage);
      for (const tc of blockedCalls) messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ executed: false, error: 'Tool call blocked: not in agent allowedTools.' }) });
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
        message: sanitizedMessage,
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

    // The next provider needs the requesting assistant message immediately
    // before its tool replies. Without it strict providers cannot resolve the
    // function name from tool_call_id and reject an otherwise valid request.
    if (sanitizedMessage) messages.push(sanitizedMessage);

    // Execute tool calls with automatic retry for transient failures.
    // A tool call can fail for transient reasons (network timeout, provider
    // rate limit) or persistent reasons (bad input, syntax error). We retry
    // transient failures up to MAX_TOOL_RETRIES times with exponential backoff.
    // Persistent errors are reported back to the model immediately so it can
    // self-correct on the next turn.
    const MAX_TOOL_RETRIES = 2;
    const TOOL_RETRY_BASE_MS = 1000;

    // ---------------------------------------------------------------- DEDUPE
    // Plan the turn: which calls really execute, which are duplicates of a call
    // in THIS turn, and which repeat a call already executed in an EARLIER turn.
    const { toExecute, withinTurnAliases, crossTurnReplays } = planToolExecution(
      allowedCalls,
      toolResultCache,
      toolDedupeEnabled,
    );

    if (withinTurnAliases.length > 0 || crossTurnReplays.length > 0) {
      dedupedCallCount += withinTurnAliases.length + crossTurnReplays.length;
      logger.info(
        {
          turn,
          requestId,
          executed: toExecute.length,
          withinTurnDuplicates: withinTurnAliases.length,
          crossTurnRepeats: crossTurnReplays.length,
          names: [...withinTurnAliases, ...crossTurnReplays].map((a) => a.tc.function.name),
        },
        'agent-chat-loop: deduped redundant tool calls',
      );
      if (stream) {
        onStreamEvent('tool_deduped', {
          turn,
          within_turn: withinTurnAliases.map((a) => ({ id: a.tc.id, name: a.tc.function.name })),
          cross_turn: crossTurnReplays.map((a) => ({ id: a.tc.id, name: a.tc.function.name })),
        });
      }
    }

    const executionPromises = toExecute.map((tc: ToolCall) =>
      executeToolCallWithRetry(tc, {
        requestId,
        tenant,
        agentDefinition,
        router,
        loadedSkills: loadedSkillIds,
        conversationId: resolvedConversationId,
      }, MAX_TOOL_RETRIES, TOOL_RETRY_BASE_MS),
    );

    const settled = await Promise.allSettled(executionPromises);
    const executedResults = settled
      .filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof executeToolCall>>> =>
          s.status === 'fulfilled',
      )
      .map((s) => s.value)
      .filter((v): v is ToolExecResult => v != null);

    // Cache every real execution under its dedupe key so a later turn asking the
    // identical question gets the cached answer instead of a second execution.
    const executedByKey = new Map<string, ToolExecResult>();
    for (const tc of toExecute) {
      const row = executedResults.find((r) => r?.tool_call_id === tc.id);
      if (!row) continue; // rejected promise — no result to fan out or cache
      const key = toolCallDedupeKey(tc);
      executedByKey.set(key, row);
      if (toolDedupeEnabled && tc.function.name !== 'read_job_board' && !toolResultCache.has(key)) toolResultCache.set(key, row);
    }

    // TRANSCRIPT INTEGRITY: the OpenAI protocol demands one tool message per
    // tool_call_id, so every duplicate id still gets its own result row — a copy
    // of the single execution, re-stamped with the duplicate's own id.
    const dedupedRows: ToolExecResult[] = [];
    for (const { tc, key } of withinTurnAliases) {
      const source = executedByKey.get(key);
      if (!source) continue;
      dedupedRows.push({
        ...source,
        tool_call_id: tc.id,
        deduped: 'within_turn',
        deduped_from: source.tool_call_id,
      });
    }
    for (const { tc, key } of crossTurnReplays) {
      const source = toolResultCache.get(key);
      if (!source) continue;
      dedupedRows.push({
        ...source,
        tool_call_id: tc.id,
        deduped: 'cross_turn',
        deduped_from: source.tool_call_id,
      });
    }

    // Emit results in the ORIGINAL tool_calls order so the transcript mirrors
    // the assistant message that requested them.
    const resultById = new Map<string, ToolExecResult>();
    for (const r of [...executedResults, ...dedupedRows]) {
      if (r?.tool_call_id) resultById.set(r.tool_call_id, r);
    }
    const stepResults: ToolExecResult[] = allowedCalls.map((tc: ToolCall) =>
      resultById.get(tc.id) ?? {
        tool_call_id: tc.id,
        tool_name: tc.function.name,
        result: null,
        error: { message: 'Tool execution did not return a result. Outcome is unknown; do not claim success.' },
      },
    );

    if (stream) {
      onStreamEvent('tool_results', { turn, results: stepResults });
    }

    // If any tool failed after retries, inject a reflection prompt asking
    // the model to acknowledge the error and propose a fix. This nudges
    // self-correction instead of ignoring the error.
    // Only reflect on errors from calls that REALLY executed this turn — a
    // deduped copy of an already-reported failure would repeat the same
    // reflection prompt every turn.
    const failedResults = stepResults.filter((tr) => tr.error && !tr.deduped);
    // Reflection is appended after the contiguous assistant/tool exchange.

    allSteps.push({
      turn,
      message: sanitizedMessage,
      tool_calls: allowedCalls,
      tool_results: stepResults,
    });

    // Add tool results to messages. Every tool_call_id gets exactly one tool
    // message — including deduped ids — or the provider rejects the transcript.
    // Repeats carry a short note so the model can see it already asked this.
    for (const tc of toolCalls) {
      const tr = stepResults.find(result => result.tool_call_id === tc.id);
      if (!tr) {
        const blocked = blockedCalls.some(call => call.id === tc.id);
        messages.push({
          role: 'tool', tool_call_id: tc.id,
          content: JSON.stringify(blocked
            ? { executed: false, error: 'Tool call blocked: not in agent allowedTools.' }
            : { error: 'Tool execution did not return a result. Outcome is unknown; do not claim success.' }),
        });
        continue;
      }
      let content: string;
      if (tr.deduped) {
        const note =
          tr.deduped === 'cross_turn'
            ? 'Duplicate call: you already ran this exact tool with these exact arguments earlier in this run. This is the cached prior result — do not request it again; use it or make a different call.'
            : 'Duplicate call within the same turn: the tool ran once and this is that same result.';
        content = JSON.stringify(
          tr.error ? { error: tr.error.message, _dmrx_note: note } : { result: tr.result, _dmrx_note: note },
        );
      } else {
        content = tr.error ? JSON.stringify({ error: tr.error.message }) : JSON.stringify(tr.result);
      }
      messages.push({
        role: 'tool',
        tool_call_id: tr.tool_call_id,
        content,
      });
    }

    if (failedResults.length > 0) {
      const errorSummary = failedResults.map(tr =>
        `Tool call ${tr.tool_call_id} failed: ${tr.error?.message ?? 'unknown error'}`,
      ).join('\n');
      messages.push({
        role: 'system',
        content: `⚠️ TOOL EXECUTION ERROR(S):\n${errorSummary}\n\nReview the above error(s) and correct your approach. If a file was written with incorrect content, rewrite it. If a command failed, fix the syntax and retry.`,
      });
    }

    // One nudge per consecutive all-replayed streak, AFTER protocol-required
    // tool messages. No extra inference or executions; real progress resets it.
    const allReplayed = stepResults.length > 0 &&
      stepResults.length === allowedCalls.length && stepResults.every((tr) => tr.deduped);
    if (allReplayed && !stalledTurnNudged) {
      messages.push({
        role: 'system',
        content: 'No new tool execution occurred this turn: identical calls already executed ' +
          'and their cached results are above. Continue the remaining task using the next ' +
          'necessary actions instead of repeating identical calls. Report only evidenced ' +
          'outcomes and clearly identify unfinished steps.',
      });
    }
    stalledTurnNudged = allReplayed;

    onCheckpoint?.(turn, conversation);

    // Opt-in history compaction: once the transcript is large, fold the early
    // tool-activity turns into a single rolling summary. Non-fatal — on any
    // failure we keep the full transcript (ReAct behavior unchanged).
    // Compaction thresholds live in the loop engine (see migration 058);
    // AgentDefinition only carries the on/off `historyCompaction` flag.
    const { threshold, keepRecent } = resolveCompactionParams({});
    if (historyCompaction && messages.length > threshold) {
      const compacted = await summarizeHistory({ router, model, tenant, requestId, messages, keepRecent, holdId, onUsage: recordAuxiliaryUsage, freeOnly });
      if (compacted) {
        messages.length = 0;
        messages.push(...compacted.messages);
        if (stream) {
          onStreamEvent('context_compacted', { resolvedConversationId, summary: compacted.summary });
        }
      }
    }
  }

  // The final model/tool turn can itself cross the wall-clock deadline. Check
  // again before auxiliary inference, preserving intentional budget/approval exits.
  if (!budgetExceeded && !awaitingApproval && !runTimedOut && Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
    runTimedOut = true;
    commitConversationState(conversation, messages, 'interrupted');
    if (stream) onStreamEvent('run_timeout', { resolvedConversationId, elapsedMs: Date.now() - runStartedAt });
  }

  // ------------------------------------------------------- INTERRUPTED RECEIPT
  // Runtime-owned reporting: another inference cannot certify unexecuted calls.
  // Preserve provider evidence; protocol rejections are not execution results.
  if (stepLimitedWithPendingTools && !budgetExceeded && !awaitingApproval && !runTimedOut && !responseTruncated) {
    lastResponseText = stopConditionWithPendingTools ? '[dmr-x] Run interrupted by configured stop condition. The pending tool calls were not executed; evidence remains in all_steps.' : '[dmr-x] Run interrupted: the tool-use step limit was reached. The final requested tool calls were not executed. Earlier model output and actual tool results remain in all_steps; pending calls are not proof of completed work.';
    commitConversationState(conversation, messages, 'interrupted');
    if (stream) {
      onStreamEvent('final_summary', { resolvedConversationId, content: lastResponseText });
    }
  }
  if (budgetExceeded) {
    lastResponseText = '[dmr-x] Run interrupted: cost budget reached. Pending tool calls were not executed. Actual model output and prior results remain in all_steps; no completion is certified.';
    commitConversationState(conversation, messages, 'interrupted');
    if (stream) onStreamEvent('final_summary', { resolvedConversationId, content: lastResponseText, runtimeOwned: true });
  }
  // ---------------------------------------------------------------- RECOVERY
  // Thought-only terminal reply recovery.
  //
  // A terminal no-tool turn whose provider content is ONLY a <thought> block
  // strips to empty prose. That path never reaches the FINAL SUMMARY turn above
  // (which requires pending tool calls at the step limit), so the run used to
  // fall through to an empty 200. Spend exactly ONE extra tools-withheld
  // completion asking for a concise user-visible answer. If that also yields no
  // visible prose, the last-resort placeholder below guarantees a non-empty,
  // non-secret gateway failure instead of empty content. Budget and approval
  // stops are excluded — those exits are intentional and already reported.
  if (
    terminalNoToolStop &&
    !budgetExceeded &&
    !awaitingApproval &&
    !runTimedOut &&
    !responseTruncated &&
    !stepLimitedWithPendingTools &&
    !lastResponseText.trim()
  ) {
    try {
      messages.push({
        role: 'user',
        content:
          'Your previous reply contained no user-visible text. Do not use tools and do not ' +
          'include internal reasoning tags. Give one concise final answer the user can read now.',
      });
      const recoveryRequest = toUnifiedRequest(
        {
          model,
          messages,
          // No `tools` — withholding them forces a prose turn.
          temperature: body.temperature,
          max_tokens: body.maxTokens,
          stream: false,
        },
        requestId,
        tenant,
        freeOnly,
        holdId,
      );
      const { response: recoveryResponse } = await completeAgentTurn(
        router,
        recoveryRequest,
        target,
        requestId,
        godmodeWrap,
        freeOnly,
      );
      let recoveryText =
        typeof recoveryResponse.message?.content === 'string' ? recoveryResponse.message.content : '';
      responseTruncated = recoveryResponse.finishReason === 'length';
      recoveryText = stripThoughtBlocks(recoveryText);
      const sanitizedRecovery = sanitizedAssistantMessage(recoveryResponse.message, recoveryText);
      if (sanitizedRecovery) messages.push(sanitizedRecovery);
      allSteps.push({
        turn: allSteps.length,
        message: sanitizedRecovery,
        tool_calls: [],
        tool_results: [],
      });
      if (recoveryResponse.usage) {
        totalTokensUsed += recoveryResponse.usage.total_tokens ?? 0;
        totalPromptTokens += (recoveryResponse.usage as any).prompt_tokens ?? 0;
        totalCompletionTokens += (recoveryResponse.usage as any).completion_tokens ?? 0;
        totalCost +=
          (recoveryResponse.usage as any).cost ?? (recoveryResponse.usage as any).total_cost ?? 0;
        finalUsage = recoveryResponse.usage;
      }
      if (recoveryText) {
        lastResponseText = recoveryText;
        if (stream) {
          onStreamEvent('empty_reply_recovery', { resolvedConversationId, content: recoveryText });
        }
      } else {
        // Second thought-only response: persist a safe assistant placeholder so
        // the caller never sees an empty 200 and hidden reasoning never leaks.
        const placeholderMessage = { role: 'assistant', content: EMPTY_VISIBLE_REPLY_PLACEHOLDER };
        messages.push(placeholderMessage);
        allSteps.push({
          turn: allSteps.length,
          message: placeholderMessage,
          tool_calls: [],
          tool_results: [],
        });
        lastResponseText = EMPTY_VISIBLE_REPLY_PLACEHOLDER;
        if (stream) {
          onStreamEvent('empty_reply_recovery', {
            resolvedConversationId,
            content: EMPTY_VISIBLE_REPLY_PLACEHOLDER,
          });
        }
      }
      commitConversationState(conversation, messages, responseTruncated ? 'interrupted' : 'completed');
    } catch (recoveryError) {
      if (isInferenceSettlementError(recoveryError)) throw recoveryError;
      logger.warn(
        { resolvedConversationId, error: recoveryError },
        'empty-reply recovery turn failed — falling back to gateway placeholder',
      );
      // Recovery threw: still persist a safe non-empty placeholder and leave
      // the conversation completed. Streaming must not finish silently.
      const placeholderMessage = { role: 'assistant', content: EMPTY_VISIBLE_REPLY_PLACEHOLDER };
      messages.push(placeholderMessage);
      allSteps.push({
        turn: allSteps.length,
        message: placeholderMessage,
        tool_calls: [],
        tool_results: [],
      });
      lastResponseText = EMPTY_VISIBLE_REPLY_PLACEHOLDER;
      if (stream) {
        onStreamEvent('empty_reply_recovery', {
          resolvedConversationId,
          content: EMPTY_VISIBLE_REPLY_PLACEHOLDER,
        });
      }
      commitConversationState(conversation, messages, 'completed');
    }
  }

  const receptionistReceipt = agentDefinition?.name === '__receptionist'
    && !budgetExceeded && !awaitingApproval && (!runTimedOut || providerFailure) && !stepLimitedWithPendingTools && !responseTruncated
    ? buildReceptionistReceipt(allSteps) : null;
  if (receptionistReceipt) {
    lastResponseText = providerFailure
      ? `[dmr-x Receptionist] Run interrupted: ${runTimedOut ? 'run timed out after a failed model/provider request' : 'a model/provider request failed'} after recorded coordination actions. No further work was executed by the failed model turn.\n` + receptionistReceipt.content
      : receptionistReceipt.content;
    messages.push({ role: 'assistant', content: lastResponseText });
    commitConversationState(conversation, messages, receptionistReceipt.failed || conversation.status === 'interrupted' ? 'interrupted' : 'completed');
    if (stream) onStreamEvent('final_summary', { resolvedConversationId, content: lastResponseText, runtimeOwned: true });
  }

  const executionError = budgetExceeded ? 'budget_exceeded'
    : awaitingApproval ? 'awaiting_approval'
    : runTimedOut ? 'run_timeout'
    : stepLimitedWithPendingTools ? (stopConditionWithPendingTools ? 'stop_condition' : 'step_limit')
    : responseTruncated ? 'response_truncated'
    : providerFailure ? 'provider_failure'
    : receptionistReceipt?.failed ? 'receptionist_tool_failure'
    : conversation.status === 'interrupted' ? 'interrupted' : null;
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
          status: executionError ? 'error' : 'success',
          error: executionError,
        }, allSteps, maxSteps);
        // Persist the evaluation so it appears in the evaluations endpoint.
        if (evaluation) {
          await agentRegistryService.createEvaluation(context.tenantId, {
            agentInstanceId: context.instanceId,
            executionId,
            toolSuccessRate: evaluation.toolSuccessRate,
            budgetAdherence: evaluation.budgetAdherence,
            turnEfficiency: evaluation.turnEfficiency,
            score: evaluation.score,
            breakdown: evaluation.breakdown,
            status: executionError ? 'error' : 'success',
          });
        }
      } catch (evaluationError) {
        logger.warn({ executionId, error: evaluationError }, 'failed_to_evaluate_execution');
      }
    }
  } catch (persistenceError) {
    logger.warn({ resolvedConversationId, executionId, error: persistenceError }, 'failed_to_persist_telemetry');
  }

  // Last-resort guard: never hand the caller a silently empty reply.
  //
  // Reached only when the FINAL SUMMARY turn above was skipped or itself failed
  // to produce prose. This text is the GATEWAY speaking, not the agent — it is
  // deliberately worded so it can never be mistaken for an agent's answer in a
  // benchmark or a UI. Treat its presence as a failure to report on, not a
  // success: a run whose reply matches this shape produced no model output.
  // The tool calls themselves remain in `allSteps` for callers wanting detail.
  if (!lastResponseText.trim()) {
    const namesUsed = Array.from(
      new Set(
        allSteps.flatMap((s) =>
          (s.tool_calls ?? []).map((tc: any) => tc.function?.name ?? tc.name).filter(Boolean),
        ),
      ),
    );
    if (awaitingApproval) {
      lastResponseText = AWAITING_APPROVAL_PLACEHOLDER;
    } else if (runTimedOut) {
      lastResponseText = RUN_TIMEOUT_PLACEHOLDER;
    } else if (budgetExceeded) {
      lastResponseText = '[dmr-x] No agent output produced: cost budget exceeded before a reply.';
    } else if (responseTruncated) {
      lastResponseText = '[dmr-x] No agent output produced: the model reply was truncated.';
    } else if (namesUsed.length > 0) {
      lastResponseText =
        `[dmr-x] No agent output produced. The ${maxSteps}-step limit was reached after calling: ` +
        `${namesUsed.join(', ')}, and the final summarisation turn did not return text. ` +
        'Raise maxSteps so the agent can report its findings.';
    } else {
      // Terminal no-tool turn (often thought-only) plus a failed/empty recovery
      // turn: still never hand the caller an empty 200.
      lastResponseText = EMPTY_VISIBLE_REPLY_PLACEHOLDER;
    }
    if (lastResponseText) {
      logger.warn(
        { resolvedConversationId, maxSteps, toolsUsed: namesUsed, budgetExceeded, awaitingApproval, runTimedOut },
        'agent loop produced no model prose — returned a gateway placeholder',
      );
    }
  }

  if (dedupedCallCount > 0) {
    logger.info(
      { resolvedConversationId, requestId, dedupedCallCount, uniqueToolCalls: toolResultCache.size },
      'agent-chat-loop: run finished with deduped tool calls',
    );
  }

  return {
    lastResponseText,
    totalTokensUsed,
    totalPromptTokens,
    totalCompletionTokens,
    totalCost,
    stepsCompleted: allSteps.length,
    budgetExceeded,
    awaitingApproval,
    runTimedOut,
    finalUsage,
    allSteps,
  };
}
