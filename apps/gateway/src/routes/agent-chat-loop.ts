import type { ToolCall, UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { updateState, type ConversationState } from '@dmr-x/utils';
import type { AgentRuntimeService } from '@dmr-x/agent-runtime';

import { executeToolCall } from './tools.routes.js';

// ---------------------------------------------------------------------------
// Shared agentic loop engine for the /agents/:instanceId/chat route.
//
// `agent-chat` previously duplicated this loop verbatim for its streaming and
// non-streaming responses. The only divergence was the I/O sink (SSE events vs
// a collected payload), so the loop is extracted here and the sink is injected
// via `onStreamEvent`. Behavior is preserved 1:1 with the prior two copies.
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
  context: Awaited<ReturnType<AgentRuntimeService['loadContext']>>;
  stream: boolean;
  onStreamEvent: (event: string, data: unknown) => void;
  /** Rebuilds the system prompt for a given turn (skill-capture nudge support). */
  buildSystemPrompt: (turn: number) => Promise<string>;
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
      conversationId: conversation.id,
    });
  }

  for (let turn = 0; turn < maxSteps; turn++) {
    // Rebuild the system prompt each turn so the skill-capture nudge can
    // become actionable on hard turn-counter multiples of the interval.
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

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/agents/chat',
    });

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
          conversationId: conversation.id,
          max_cost_budget: body.max_cost_budget,
          totalCost,
        });
      }
      break;
    }

    if (stream) {
      onStreamEvent('turn', {
        turn,
        conversationId: conversation.id,
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
      executeToolCall(tc, { requestId, tenant }),
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
