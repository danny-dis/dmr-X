/**
 * Tool orchestration loop for DMR-X.
 * Manages multi-turn tool execution: request -> extract tool calls -> execute
 * in parallel -> send results -> repeat until model stops calling tools.
 *
 * Ported from OpenRouter SDK's tool-orchestrator.ts with adaptations for DMR-X.
 */
import { extractToolCallsFromResponse, responseHasToolCalls, } from './stream-transformers.js';
import { isFunctionCallItem } from './stream-type-guards.js';
import { executeTool, findToolByName } from './tool-executor.js';
import { hasExecuteFunction } from './tool-types.js';
import { buildTurnContext } from './turn-context.js';
import { executeNextTurnParamsFunctions, applyNextTurnParamsToRequest, } from './next-turn-params.js';
// ---------------------------------------------------------------------------
// Main orchestration loop
// ---------------------------------------------------------------------------
/**
 * Execute tool calls and manage multi-turn conversations.
 * This orchestrates the loop of: request -> tool calls -> execute -> send results -> repeat.
 *
 * @param sendRequest - Function to send a request and get a response
 * @param initialInput - Starting input for the conversation
 * @param initialRequest - Full initial request with all parameters
 * @param tools - Enhanced tools with schemas and execute functions
 * @param apiTools - Converted tools in API format (JSON Schema)
 * @param options - Execution options
 * @returns Result containing final response and all execution data
 */
export async function executeToolLoop(sendRequest, initialInput, initialRequest, tools, apiTools, options = {}) {
    const onPreliminaryResult = options.onPreliminaryResult;
    const allResponses = [];
    const toolExecutionResults = [];
    let conversationInput = initialInput;
    let currentRequest = { ...initialRequest };
    let currentRound = 0;
    let currentResponse;
    // Initial request
    currentResponse = await sendRequest(conversationInput, apiTools);
    allResponses.push(currentResponse);
    // Loop until no more tool calls (model decides when to stop)
    while (responseHasToolCalls(currentResponse)) {
        currentRound++;
        // Extract tool calls from response
        const toolCalls = extractToolCallsFromResponse(currentResponse);
        if (toolCalls.length === 0) {
            break;
        }
        // Check if any tools have execute functions
        const hasExecutableTools = toolCalls.some((toolCall) => {
            const tool = findToolByName(tools, toolCall.name);
            return tool && hasExecuteFunction(tool);
        });
        // If no executable tools, return (manual execution mode)
        if (!hasExecutableTools) {
            break;
        }
        // Execute all tool calls in parallel (parallel tool calling)
        const toolCallPromises = toolCalls.map(async (toolCall) => {
            const tool = findToolByName(tools, toolCall.name);
            if (!tool) {
                // Tool not found in definitions
                return {
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    result: null,
                    error: new Error(`Tool "${toolCall.name}" not found in tool definitions`),
                };
            }
            if (!hasExecuteFunction(tool)) {
                // Tool has no execute function - return null to filter out
                return null;
            }
            // Find the raw tool call from the response output
            const rawToolCall = currentResponse.output.find((item) => isFunctionCallItem(item) && item.callId === toolCall.id);
            if (!rawToolCall) {
                throw new Error(`Could not find raw tool call for ${toolCall.id}`);
            }
            // Convert to FunctionCallItem format
            const openResponsesToolCall = {
                type: 'function_call',
                callId: rawToolCall.callId,
                name: rawToolCall.name,
                arguments: rawToolCall.arguments,
                id: rawToolCall.callId,
                status: rawToolCall.status,
            };
            // Build turn context with full information
            const turnContext = buildTurnContext({
                numberOfTurns: currentRound,
                toolCall: openResponsesToolCall,
                turnRequest: currentRequest,
            });
            // Execute the tool
            return executeTool(tool, toolCall, turnContext, onPreliminaryResult);
        });
        // Wait for all tool executions to complete in parallel
        const settledResults = await Promise.allSettled(toolCallPromises);
        // Process settled results, handling both fulfilled and rejected promises
        const roundResults = [];
        settledResults.forEach((settled, i) => {
            const toolCall = toolCalls[i];
            if (!toolCall)
                return;
            if (settled.status === 'fulfilled') {
                if (settled.value !== null) {
                    roundResults.push(settled.value);
                }
            }
            else {
                // Promise rejected - create error result
                roundResults.push({
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    result: null,
                    error: settled.reason instanceof Error
                        ? settled.reason
                        : new Error(String(settled.reason)),
                });
            }
        });
        toolExecutionResults.push(...roundResults);
        // Execute nextTurnParams functions for tools that were called
        // Cast tools to ToolDefinition[] for compatibility with next-turn-params
        const toolDefinitions = tools;
        const computedParams = await executeNextTurnParamsFunctions(toolCalls, toolDefinitions, currentRequest);
        // Apply computed parameters to request
        if (Object.keys(computedParams).length > 0) {
            currentRequest = applyNextTurnParamsToRequest(currentRequest, computedParams);
            conversationInput = currentRequest.input ?? conversationInput;
        }
        // Build array input with all output from previous response plus tool results
        // The API expects continuation via previousResponseId, not by including outputs
        // For now, we'll keep the conversation going via previousResponseId
        // conversationInput is updated above if nextTurnParams modified it
        // Note: The OpenRouter Responses API uses previousResponseId for continuation
        // Tool results are automatically associated with the previous response's tool calls
        // Send updated conversation to API - this should use previousResponseId
        currentResponse = await sendRequest(conversationInput, apiTools);
        allResponses.push(currentResponse);
    }
    return {
        finalResponse: currentResponse,
        allResponses,
        toolExecutionResults,
        conversationInput,
    };
}
// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
/**
 * Convert tool execution results to a map for easy lookup.
 */
export function toolResultsToMap(results) {
    const map = new Map();
    for (const result of results) {
        map.set(result.toolCallId, {
            result: result.result,
            preliminaryResults: result.preliminaryResults,
        });
    }
    return map;
}
/**
 * Build a summary of tool executions for debugging/logging.
 */
export function summarizeToolExecutions(results) {
    const lines = [];
    for (const result of results) {
        if (result.error) {
            lines.push(`[ERROR] ${result.toolName} (${result.toolCallId}): ${result.error.message}`);
        }
        else {
            const prelimCount = result.preliminaryResults?.length ?? 0;
            const prelimInfo = prelimCount > 0 ? ` (${prelimCount} preliminary results)` : '';
            lines.push(`[OK] ${result.toolName} (${result.toolCallId}): SUCCESS${prelimInfo}`);
        }
    }
    return lines.join('\n');
}
/**
 * Check if any tool executions had errors.
 */
export function hasToolExecutionErrors(results) {
    return results.some((result) => result.error !== undefined);
}
/**
 * Get all tool execution errors.
 */
export function getToolExecutionErrors(results) {
    return results
        .filter((result) => result.error !== undefined)
        .map((result) => result.error);
}
//# sourceMappingURL=tool-orchestrator.js.map