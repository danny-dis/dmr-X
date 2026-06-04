import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId, executeTool, findToolByName, logger, } from '@dmr-x/utils';
import { ChatMessageSchema, ToolSchema, ToolCallSchema } from './shared-schemas.js';
const toolHandlers = new Map();
export function registerToolHandler(name, handler) {
    toolHandlers.set(name, handler);
}
/** Convert registered tool handlers to SDK Tool objects */
function getRegisteredSDKTools() {
    const tools = [];
    for (const [name, handler] of toolHandlers) {
        tools.push({
            function: {
                name,
                execute: async (args, context) => {
                    return handler(args, context);
                },
            },
        });
    }
    return tools;
}
/** Execute a tool call using the SDK executor with fallback to direct handler lookup */
async function executeToolCall(tc, context) {
    const tools = getRegisteredSDKTools();
    const parsedCall = {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
    };
    const tool = findToolByName(tools, tc.function.name);
    if (!tool) {
        return {
            tool_call_id: tc.id,
            tool_name: tc.function.name,
            result: null,
            error: { message: `No handler registered for tool "${tc.function.name}"` },
        };
    }
    try {
        const result = await executeTool(tool, parsedCall, { ...context, numberOfTurns: 0 });
        return {
            tool_call_id: tc.id,
            tool_name: tc.function.name,
            result: result.result,
            error: result.error ? { message: String(result.error) } : undefined,
        };
    }
    catch (error) {
        logger.error({ err: error, tool: tc.function.name }, 'Tool execution error');
        return {
            tool_call_id: tc.id,
            tool_name: tc.function.name,
            result: null,
            error: { message: 'Tool execution failed' },
        };
    }
}
export { executeToolCall };
// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
// POST /v1/tools/execute
const ToolExecuteRequestSchema = z.object({
    model: z.string(),
    messages: z.array(ChatMessageSchema).min(1),
    tools: z.array(ToolSchema).min(1),
    tool_choice: z.any().optional(),
    tool_call: ToolCallSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    stream: z.boolean().optional().default(false),
});
// POST /v1/tools/loop
const ToolLoopRequestSchema = z.object({
    model: z.string(),
    messages: z.array(ChatMessageSchema).min(1),
    tools: z.array(ToolSchema).min(1),
    tool_choice: z.any().optional(),
    max_steps: z.number().int().positive().max(50).optional().default(10),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    stream: z.boolean().optional().default(false),
});
// ---------------------------------------------------------------------------
// Helper: convert to UnifiedRequest
// ---------------------------------------------------------------------------
function toUnifiedRequest(body, requestId, tenant) {
    return {
        modality: 'llm',
        model: body.model,
        messages: body.messages,
        tools: body.tools,
        tool_choice: body.tool_choice,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        stream: body.stream ?? false,
        metadata: { requestId, tenant },
    };
}
// ---------------------------------------------------------------------------
// Helper: write SSE event to reply.raw
// ---------------------------------------------------------------------------
function writeSSE(reply, event, data) {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export async function toolsRoutes(server) {
    /**
     * POST /tools/execute
     *
     * Executes a single tool call. Two modes:
     * 1. With tool_call: Executes the specific tool call against registered handlers.
     * 2. Without tool_call: Sends request to the model via the router, which may
     *    return tool_calls. If it does, executes them via registered handlers.
     *
     * Returns the model message and any tool execution results.
     * Supports streaming via SSE.
     */
    server.post('/tools/execute', async (request, reply) => {
        const parsed = ToolExecuteRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const tenant = request.tenant;
        // Mode 1: Direct tool call execution
        if (body.tool_call) {
            const toolCall = body.tool_call;
            const handler = toolHandlers.get(toolCall.function.name);
            if (!handler) {
                reply.status(404);
                return {
                    error: {
                        message: `No handler registered for tool "${toolCall.function.name}"`,
                        type: 'tool_not_found',
                        code: 'tool_not_found',
                    },
                };
            }
            try {
                const args = JSON.parse(toolCall.function.arguments);
                const result = await handler(args, { requestId, tenant });
                return {
                    id: requestId,
                    object: 'tool.result',
                    tool_call_id: toolCall.id,
                    tool_name: toolCall.function.name,
                    result,
                };
            }
            catch (error) {
                logger.error({ err: error, requestId, tool: toolCall.function.name }, 'Tool execution failed');
                reply.status(500);
                return {
                    id: requestId,
                    tool_call_id: toolCall.id,
                    tool_name: toolCall.function.name,
                    error: { message: 'Tool execution failed' },
                };
            }
        }
        // Mode 2: Model request with tool support
        const unifiedRequest = toUnifiedRequest(body, requestId, tenant);
        const { response } = await router.route(unifiedRequest, {
            path: '/v1/tools/execute',
            qualityTarget: 'balanced',
        });
        // Check if the model returned tool_calls
        const toolCalls = response.message?.tool_calls ?? [];
        const toolResults = [];
        if (toolCalls.length > 0) {
            // Execute tool calls using SDK executor
            const executionPromises = toolCalls.map((tc) => executeToolCall(tc, { requestId, tenant }));
            const settled = await Promise.allSettled(executionPromises);
            for (const s of settled) {
                if (s.status === 'fulfilled') {
                    toolResults.push(s.value);
                }
                else {
                    logger.error({ err: s.reason, requestId }, 'Tool execution rejected');
                    toolResults.push({
                        tool_call_id: 'unknown',
                        tool_name: 'unknown',
                        result: null,
                        error: { message: 'Tool execution failed' },
                    });
                }
            }
        }
        if (body.stream) {
            // Streaming response
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            // Stream the model response
            writeSSE(reply, 'message', {
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
            });
            // Stream tool results if any
            if (toolResults.length > 0) {
                writeSSE(reply, 'tool_results', {
                    id: requestId,
                    object: 'tool.results',
                    results: toolResults,
                });
            }
            writeSSE(reply, 'done', '[DONE]');
            reply.raw.end();
            return reply;
        }
        // Non-streaming response
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
            tool_results: toolResults.length > 0 ? toolResults : undefined,
        };
    });
    /**
     * POST /tools/loop
     *
     * Runs a multi-turn tool execution loop:
     *   request -> extract tool calls -> execute -> send results -> repeat
     *
     * The loop continues until:
     * - The model stops calling tools
     * - max_steps is reached
     * - All tool calls have no registered handlers
     *
     * Supports streaming via SSE with tool_execution events for each step.
     */
    server.post('/tools/loop', async (request, reply) => {
        const parsed = ToolLoopRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const tenant = request.tenant;
        const maxSteps = body.max_steps;
        // Build message history that we'll accumulate across turns
        let messages = [...body.messages];
        const allToolResults = [];
        if (body.stream) {
            // Streaming response
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            try {
                for (let step = 0; step < maxSteps; step++) {
                    const unifiedRequest = toUnifiedRequest({ ...body, messages, stream: false }, requestId, tenant);
                    const { response } = await router.route(unifiedRequest, {
                        path: '/v1/tools/loop',
                        qualityTarget: 'balanced',
                    });
                    const toolCalls = response.message?.tool_calls ?? [];
                    // Stream the model response for this step
                    writeSSE(reply, 'step', {
                        step,
                        object: 'chat.completion',
                        id: requestId,
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
                    });
                    // If no tool calls, we're done
                    if (toolCalls.length === 0) {
                        break;
                    }
                    // Execute tool calls using SDK executor
                    const executionPromises = toolCalls.map((tc) => executeToolCall(tc, { requestId, tenant }));
                    const settled = await Promise.allSettled(executionPromises);
                    const stepResults = settled
                        .filter((s) => s.status === 'fulfilled')
                        .map((s) => s.value);
                    allToolResults.push({ step, tool_calls: toolCalls, results: stepResults });
                    // Log tool execution errors
                    const errorResults = stepResults.filter(r => r.error);
                    if (errorResults.length > 0) {
                        logger.warn({ count: errorResults.length, total: stepResults.length }, 'Some tool executions had errors');
                    }
                    // Stream tool execution results
                    writeSSE(reply, 'tool_results', {
                        step,
                        results: stepResults,
                    });
                    // Build tool result messages for the next turn
                    const assistantMessage = { ...response.message };
                    messages.push(assistantMessage);
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
            }
            catch (error) {
                logger.error({ err: error, requestId }, 'Agentic streaming error');
                writeSSE(reply, 'error', { error: { message: 'Stream failed' } });
            }
            writeSSE(reply, 'done', '[DONE]');
            reply.raw.end();
            return reply;
        }
        // Non-streaming response
        for (let step = 0; step < maxSteps; step++) {
            const unifiedRequest = toUnifiedRequest({ ...body, messages, stream: false }, requestId, tenant);
            const { response } = await router.route(unifiedRequest, {
                path: '/v1/tools/loop',
                qualityTarget: 'balanced',
            });
            const toolCalls = response.message?.tool_calls ?? [];
            // If no tool calls, we're done
            if (toolCalls.length === 0) {
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
                    steps_completed: step + 1,
                    all_tool_results: allToolResults,
                };
            }
            // Execute tool calls using SDK executor
            const executionPromises = toolCalls.map((tc) => executeToolCall(tc, { requestId, tenant }));
            const settled = await Promise.allSettled(executionPromises);
            const stepResults = settled
                .filter((s) => s.status === 'fulfilled')
                .map((s) => s.value);
            allToolResults.push({ step, tool_calls: toolCalls, results: stepResults });
            // Log tool execution errors using SDK orchestrator helpers
            const nonStreamingErrors = stepResults.filter(r => r.error);
            if (nonStreamingErrors.length > 0) {
                logger.warn({ count: nonStreamingErrors.length, total: stepResults.length }, 'Some tool executions had errors');
            }
            // Build tool result messages for the next turn
            const assistantMessage = { ...response.message };
            messages.push(assistantMessage);
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
        // If we exhausted all steps
        return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content: 'Tool loop reached maximum steps.' },
                    finish_reason: 'length',
                },
            ],
            steps_completed: maxSteps,
            all_tool_results: allToolResults,
        };
    });
}
//# sourceMappingURL=tools.routes.js.map