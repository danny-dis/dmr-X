import type { ToolCall, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { updateState, type ConversationState, logger } from '@dmr-x/utils';
import type { AgentRuntimeService, AgentExecutionContext } from '@dmr-x/agent-runtime';
import type { AgentDefinition } from '@dmr-x/agent-registry';

import { executeToolCall } from './tools.routes.js';

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
}

export interface AgentChatLoopResult {
  lastResponseText: string;
  totalTokensUsed: number;
  totalCost: number;
  stepsCompleted: number;
  budgetExceeded: boolean;
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
}

const MAX_TURN_RETRIES = 2;

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
// Opt-in agentic upgrades (both default OFF — existing agents are unchanged)
// ---------------------------------------------------------------------------

// Once the transcript grows past this many messages, compact the early
// tool-activity turns into a single rolling summary (history-compaction mode).
const COMPACTION_THRESHOLD = 24;
// Always keep this many of the most recent messages verbatim (recency matters).
const COMPACTION_KEEP_RECENT = 8;

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
 * most recent COMPACTION_KEEP_RECENT messages verbatim.
 */
async function summarizeHistory(args: {
  router: Router;
  model: string;
  tenant: { id: string; name: string };
  requestId: string;
  messages: any[];
}): Promise<{ messages: any[]; summary: string } | null> {
  const { router, model, tenant, requestId, messages } = args;
  // messages[0] is the live system prompt; we compact the user/assistant/tool
  // turns that precede the recent tail.
  const head = messages.slice(1, messages.length - COMPACTION_KEEP_RECENT);
  const tail = messages.slice(messages.length - COMPACTION_KEEP_RECENT);
  if (head.length < COMPACTION_KEEP_RECENT) return null;

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
  } = args;

  // conversationId is optional; fall back to the conversation's own id so
  // callers that don't thread it still persist telemetry correctly.
  const resolvedConversationId = conversationId ?? conversation.id;

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
  let finalUsage: any;
  const allSteps: AgentChatLoopResult['allSteps'] = [];

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
      ({ response } = await router.route(unifiedRequest, {
        path: '/v1/agents/chat',
      }));
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

      ({ response } = await router.route(retryRequest, {
        path: '/v1/agents/chat',
      }));
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
      updateState(conversation, { messages, status: 'completed' });
      budgetExceeded = true;
      if (stream) {
        onStreamEvent('budget_exceeded', {
          resolvedConversationId,
          max_cost_budget: body.max_cost_budget,
          totalCost,
        });
      }
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

    // Stop if no tool calls or at step limit
    if (toolCalls.length === 0 || turn === maxSteps - 1) {
      if (response.message) messages.push(response.message);
      updateState(conversation, { messages, status: 'completed' });
      allSteps.push({
        turn,
        message: response.message,
        tool_calls: toolCalls,
        tool_results: [],
      });
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

    // Execute tool calls
    const assistantMessage = { ...response.message };
    messages.push(assistantMessage);

    const executionPromises = allowedCalls.map((tc: ToolCall) =>
      executeToolCall(tc, { requestId, tenant, agentDefinition, router, loadedSkills: loadedSkillIds }),
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

    // Opt-in history compaction: once the transcript is large, fold the early
    // tool-activity turns into a single rolling summary. Non-fatal — on any
    // failure we keep the full transcript (ReAct behavior unchanged).
    if (historyCompaction && messages.length > COMPACTION_THRESHOLD) {
      const compacted = await summarizeHistory({ router, model, tenant, requestId, messages });
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
    finalUsage,
    allSteps,
  };
}
