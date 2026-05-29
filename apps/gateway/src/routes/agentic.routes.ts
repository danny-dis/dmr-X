import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError, type UnifiedRequest, type ToolCall } from '@dmr-x/core';
import {
  generateRequestId,
  stepCountIs,
  hasToolCall,
  isStopConditionMet,
  createInitialState,
  updateState,
  type StopCondition,
  type StepResult,
  type ConversationState,
} from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';
import { executeToolCall } from './tools.routes.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.any())]).nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
});

const ToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

const StopConditionSchema = z.object({
  type: z.enum(['step_count', 'tool_call', 'text_match']),
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
  stopWhen: z.array(StopConditionSchema).optional(),
  approvalRequired: z.boolean().optional().default(false),
  approvalDecisions: z.array(ApprovalDecisionSchema).optional(),
  conversationId: z.string().optional(),
  max_steps: z.number().int().positive().max(50).optional().default(10),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stream: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// In-memory conversation state store (for approval flow persistence)
// Uses SDK ConversationState from @dmr-x/utils
// ---------------------------------------------------------------------------

const conversations = new Map<string, ConversationState>();

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
// Helper: write SSE event
// ---------------------------------------------------------------------------

function writeSSE(reply: { raw: { write: (data: string) => void } }, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Stop condition evaluation (uses SDK composable stop conditions)
// ---------------------------------------------------------------------------

function buildStopConditions(
  conditions: Array<{ type: string; value: number | string }>,
  getResponseText: () => string,
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
    const maxSteps = body.max_steps;
    const stopConditions = body.stopWhen ?? [];

    // Load or create conversation state (uses SDK ConversationState)
    let conversation: ConversationState;
    if (body.conversationId && conversations.has(body.conversationId)) {
      conversation = conversations.get(body.conversationId)!;
      conversation = updateState(conversation, {
        messages: [...conversation.messages, ...body.messages],
      });
    } else {
      conversation = createInitialState(body.conversationId ?? requestId);
      conversation.messages = [...body.messages];
      conversations.set(conversation.id, conversation);
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
    let messages = [...conversation.messages] as any[];
    let lastResponseText = '';
    const allStepResults: StepResult[] = [];
    const sdkStopConditions = buildStopConditions(stopConditions, () => lastResponseText);
    const allSteps: Array<{
      turn: number;
      message: any;
      tool_calls: any[];
      tool_results: any[];
    }> = [];

    if (body.stream) {
      // Streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        for (let turn = 0; turn < maxSteps; turn++) {
          const unifiedRequest = toUnifiedRequest(
            {
              model: body.model,
              messages,
              tools: body.tools,
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

          const { response } = await router.route(unifiedRequest, {
            path: '/v1/agentic/chat',
            qualityTarget: 'balanced',
          });

          const toolCalls = response.message?.tool_calls ?? [];
          const responseText =
            typeof response.message?.content === 'string'
              ? response.message.content
              : '';
          lastResponseText = responseText;

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

          if (
            toolCalls.length === 0 ||
            await isStopConditionMet({ stopConditions: sdkStopConditions, steps: allStepResults })
          ) {
            // Update conversation state
            messages.push(response.message!);
            conversation = updateState(conversation, {
              messages,
              status: 'completed',
            });
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
            messages.push(response.message!);
            conversation = updateState(conversation, { messages });

            // Stream approval required event
            writeSSE(reply, 'approval_required', {
              conversationId: conversation.id,
              pending_tool_calls: toolCalls.map((tc: ToolCall) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments),
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
        const message = error instanceof Error ? error.message : String(error);
        writeSSE(reply, 'error', { error: { message } });
      }

      writeSSE(reply, 'done', { status: 'completed', conversationId: conversation.id });
      reply.raw.end();
      return reply;
    }

    // Non-streaming response
    const nonStreamingStepResults: StepResult[] = [];
    let nonStreamingLastResponseText = '';
    const nonStreamingStopConditions = buildStopConditions(stopConditions, () => nonStreamingLastResponseText);

    for (let turn = 0; turn < maxSteps; turn++) {
        const unifiedRequest = toUnifiedRequest(
          {
            model: body.model,
            messages,
            tools: body.tools,
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

        const { response } = await router.route(unifiedRequest, {
          path: '/v1/agentic/chat',
          qualityTarget: 'balanced',
        });

        const toolCalls = response.message?.tool_calls ?? [];
        const responseText =
          typeof response.message?.content === 'string'
            ? response.message.content
            : '';
        nonStreamingLastResponseText = responseText;

        // Check stop conditions using SDK composable conditions
        const stepResult: StepResult = {
          toolCalls: toolCalls.map((tc: ToolCall) => ({ name: tc.function.name })),
          usage: response.usage ? { totalTokens: response.usage.total_tokens, cost: undefined } : undefined,
          finishReason: response.finishReason ?? undefined,
        };
        nonStreamingStepResults.push(stepResult);

        if (
          toolCalls.length === 0 ||
          await isStopConditionMet({ stopConditions: nonStreamingStopConditions, steps: nonStreamingStepResults })
        ) {
          messages.push(response.message!);
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

          messages.push(response.message!);
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
              arguments: JSON.parse(tc.function.arguments),
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
  });
}
