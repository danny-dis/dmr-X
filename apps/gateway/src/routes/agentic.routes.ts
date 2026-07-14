import { ValidationError, type UnifiedRequest, type ToolCall } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
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
// In-memory conversation state store (for approval flow persistence)
// Uses SDK ConversationState from @dmr-x/utils
// ---------------------------------------------------------------------------

const conversations = new Map<string, ConversationState>();
const conversationLocks = new Map<string, Promise<void>>();
const conversationAbortControllers = new Map<string, AbortController>();
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const conversationTimestamps = new Map<string, number>();

// Periodic cleanup of expired conversations
const conversationCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of conversationTimestamps) {
    // Don't clean up conversations that are currently locked (being processed)
    if (conversationLocks.has(id)) continue;
    if (now - ts > CONVERSATION_TTL_MS) {
      conversations.delete(id);
      conversationTimestamps.delete(id);
      toolNarrowCache.delete(id);
    }
  }
}, 60_000);
if (conversationCleanupTimer.unref) conversationCleanupTimer.unref();

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
// localhost:8011 round-trip every turn. Cleared on conversation eviction above.
const toolNarrowCache = new Map<string, { tools: any[]; ts: number }>();
const TOOL_NARROW_TTL_MS = 10 * 60 * 1000;

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
): Promise<{ response: any }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TURN_TIMEOUT_MS);
  try {
    return await router.route(
      { ...unifiedRequest, signal: ac.signal } as UnifiedRequest,
      { path: '/v1/agentic/chat', qualityTarget },
    );
  } finally {
    clearTimeout(timer);
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
): UnifiedRequest {
  return {
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
    metadata: { requestId, tenant },
  };
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
    const maxSteps = body.max_steps;
    const stopConditions = body.stopWhen ?? [];

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

    try {

    // Load or create conversation state (uses SDK ConversationState)
    let conversation: ConversationState;
    if (body.conversationId && conversations.has(body.conversationId)) {
      conversation = conversations.get(body.conversationId)!;
      conversation = updateState(conversation, {
        messages: [...conversation.messages, ...body.messages],
      });
      conversationTimestamps.set(conversation.id, Date.now());
    } else {
      conversation = createInitialState(body.conversationId ?? requestId);
      conversation.messages = [...body.messages];
      conversations.set(conversation.id, conversation);
      conversationTimestamps.set(conversation.id, Date.now());
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

    if (body.stream) {
      // Register abort controller for this conversation
      const abortController = new AbortController();
      conversationAbortControllers.set(convId, abortController);
      let consecutiveErrors = 0;

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
            writeSSE(reply, 'error', { error: { message: 'Conversation aborted' } });
            break;
          }

          const unifiedRequest = toUnifiedRequest(
            {
              model: body.model,
              messages,
              tools: resolveTools(convId, body.tools, lastUserText(messages)),
              tool_choice: body.tool_choice,
              temperature: body.temperature,
              max_tokens: body.max_tokens,
              top_p: body.top_p,
              frequency_penalty: body.frequency_penalty,
              presence_penalty: body.presence_penalty,
              stream: body.stream,
            },
            requestId,
            tenant,
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
          try {
            ({ response } = await routeWithTimeout(router, unifiedRequest, qualityTarget));
          } catch (err) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
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
            // Cost tracking: extract from usage if available
            const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
            totalCost += stepCost;
          }

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
        }
      } catch (error) {
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

      writeSSE(reply, 'done', { status: 'completed', conversationId: conversation.id });
      reply.raw.end();
      return reply;
    }

    // Non-streaming response
    const nonStreamingStepResults: StepResult[] = [];
    let nonStreamingLastResponseText = '';
    let nonStreamingTotalTokens = 0;
    let nonStreamingTotalCost = 0;
    let nonStreamingConsecutiveErrors = 0;
    const nonStreamingStopConditions = buildStopConditions(
      stopConditions,
      () => nonStreamingLastResponseText,
      () => nonStreamingTotalTokens,
      () => nonStreamingTotalCost,
    );

    for (let turn = 0; turn < maxSteps; turn++) {
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
            max_tokens: body.max_tokens,
            top_p: body.top_p,
            frequency_penalty: body.frequency_penalty,
            presence_penalty: body.presence_penalty,
            stream: false,
          },
          requestId,
          tenant,
        );

        let response: any;
        try {
          ({ response } = await routeWithTimeout(router, unifiedRequest, qualityTarget));
        } catch (err) {
          nonStreamingConsecutiveErrors++;
          if (nonStreamingConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
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
          const stepCost = (response.usage as any).cost ?? (response.usage as any).total_cost ?? 0;
          nonStreamingTotalCost += stepCost;
        }

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
          if (response.message) messages.push(response.message);
          conversation = updateState(conversation, {
            messages,
            status: 'completed',
          });

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
    }

      // Exhausted all steps
      conversation = updateState(conversation, { messages, status: 'completed' });

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
      conversationAbortControllers.delete(convId);
    }
  });

  /**
   * POST /agentic/chat/:conversationId/cancel
   *
   * Cancel a running conversation by aborting its execution.
   */
  server.post('/agentic/chat/:conversationId/cancel', async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const abortController = conversationAbortControllers.get(conversationId);

    if (!abortController) {
      return reply.status(404).send({ error: 'Conversation not found or already completed' });
    }

    abortController.abort();
    conversationAbortControllers.delete(conversationId);

    return { status: 'cancelled', conversationId };
  });
}
