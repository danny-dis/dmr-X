import type { ToolCall, UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { updateState, type ConversationState, logger } from '@dmr-x/utils';
import type { AgentRuntimeService, AgentExecutionContext, AgentDefinition } from '@dmr-x/agent-runtime';

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
  conversationId?: string;
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
  /** Conversation id for durable session linkage. */
  conversationId: string;
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

  const messages = [...conversation.messages] as any[];
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
      conversationId,
    });
  }

  for (let turn = 0; turn < maxSteps; turn++) {
    messages[0] = { role: 'system', content: await buildSystemPrompt(turn) };

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

    let response: { plan: any; response: any };

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
        { requestId, conversationId, reason: decision.reason, fallback: decision.fallback },
        'agent_run_retry',
      );

      if (stream) {
        onStreamEvent('model_retry', {
          conversationId,
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
          conversationId,
          max_cost_budget: body.max_cost_budget,
          totalCost,
        });
      }
      break;
    }

    if (stream) {
      onStreamEvent('turn', {
        turn,
        conversationId,
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
  }

  try {
    if (conversationId && allSteps.length > 0) {
      const sessionSteps = allSteps.map((step) => ({
        turn: step.turn,
        status: 'completed' as const,
        budgetStatus: budgetExceeded ? 'exceeded' : 'within',
        allowedToolCallNames: step.tool_calls.map((tc) => tc.function?.name ?? tc.name),
        blockedToolCallNames: [] as string[],
        toolResults: step.tool_results,
        tokenDelta: (step.message as any)?.usage?.total_tokens ?? 0,
        costDelta: (step.message as any)?.usage?.cost ?? (step.message as any)?.usage?.total_cost ?? 0,
      }));

      try {
        runtime.persistRunSteps?.(conversationId, sessionSteps, { reset: true });
      } catch (telemetryError) {
        logger.warn({ conversationId, error: telemetryError }, 'failed_to_persist_run_steps');
      }
    }

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

        try {
          await runtime.createEvaluation?.({
            agentInstanceId: context.instanceId,
            executionId,
            toolSuccessRate: evaluation.toolSuccessRate,
            budgetAdherence: evaluation.budgetAdherence,
            turnEfficiency: evaluation.turnEfficiency,
            score: evaluation.score,
            breakdown: evaluation.breakdown,
            status: budgetExceeded ? 'budget_exceeded' : 'completed',
          });
        } catch (evalError) {
          logger.warn({ executionId, error: evalError }, 'failed_to_create_evaluation');
        }
      } catch (evaluationError) {
        logger.warn({ executionId, error: evaluationError }, 'failed_to_evaluate_execution');
      }
    }
  } catch (persistenceError) {
    logger.warn({ conversationId, executionId, error: persistenceError }, 'failed_to_persist_telemetry');
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
