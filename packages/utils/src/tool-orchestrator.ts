/**
 * Tool orchestration loop for DMR-X.
 * Manages multi-turn tool execution: request -> extract tool calls -> execute
 * in parallel -> send results -> repeat until model stops calling tools.
 *
 * Ported from OpenRouter SDK's tool-orchestrator.ts with adaptations for DMR-X.
 */

import type {
  Tool,
  APITool,
  ToolExecutionResult,
  OpenResponsesResult,
  OutputFunctionCallItem,
  InputsUnion,
  ParsedToolCall,
} from './tool-types.js';

import type {
  NextTurnRequest,
} from './tool-types.js';

import {
  extractToolCallsFromResponse,
  responseHasToolCalls,
} from './stream-transformers.js';

import { isFunctionCallItem } from './stream-type-guards.js';

import { executeTool, findToolByName } from './tool-executor.js';
import { hasExecuteFunction } from './tool-types.js';
import { buildTurnContext } from './turn-context.js';
import {
  executeNextTurnParamsFunctions,
  applyNextTurnParamsToRequest,
} from './next-turn-params.js';

import type { ToolDefinition } from './next-turn-params.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for tool execution.
 */
export interface ToolExecutionOptions {
  /** Callback for preliminary results from generator tools */
  onPreliminaryResult?: (toolCallId: string, result: unknown) => void;
}

/**
 * Result of the tool execution loop.
 */
export interface ToolOrchestrationResult {
  /** The final response (after all tool calls are resolved) */
  finalResponse: OpenResponsesResult;
  /** All responses from each turn of the conversation */
  allResponses: OpenResponsesResult[];
  /** Results from all tool executions */
  toolExecutionResults: ToolExecutionResult[];
  /** The final conversation input state */
  conversationInput: InputsUnion;
}

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
export async function executeToolLoop(
  sendRequest: (
    input: InputsUnion,
    tools: APITool[],
  ) => Promise<OpenResponsesResult>,
  initialInput: InputsUnion,
  initialRequest: NextTurnRequest,
  tools: Tool[],
  apiTools: APITool[],
  options: ToolExecutionOptions = {},
): Promise<ToolOrchestrationResult> {
  const onPreliminaryResult = options.onPreliminaryResult;

  const allResponses: OpenResponsesResult[] = [];
  const toolExecutionResults: ToolExecutionResult[] = [];
  let conversationInput: InputsUnion = initialInput;
  let currentRequest: NextTurnRequest = { ...initialRequest };

  let currentRound = 0;
  let currentResponse: OpenResponsesResult;

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
        } as ToolExecutionResult;
      }

      if (!hasExecuteFunction(tool)) {
        // Tool has no execute function - return null to filter out
        return null;
      }

      // Find the raw tool call from the response output
      const rawToolCall = currentResponse.output.find(
        (item): item is OutputFunctionCallItem =>
          isFunctionCallItem(item) && item.callId === toolCall.id,
      );

      if (!rawToolCall) {
        throw new Error(`Could not find raw tool call for ${toolCall.id}`);
      }

      // Convert to FunctionCallItem format
      const openResponsesToolCall = {
        type: 'function_call' as const,
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
    const roundResults: ToolExecutionResult[] = [];
    settledResults.forEach((settled, i) => {
      const toolCall = toolCalls[i];
      if (!toolCall) return;

      if (settled.status === 'fulfilled') {
        if (settled.value !== null) {
          roundResults.push(settled.value);
        }
      } else {
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
    const toolDefinitions = tools as unknown as ToolDefinition[];
    const computedParams = await executeNextTurnParamsFunctions(
      toolCalls,
      toolDefinitions,
      currentRequest,
    );

    // Apply computed parameters to request
    if (Object.keys(computedParams).length > 0) {
      currentRequest = applyNextTurnParamsToRequest(currentRequest, computedParams);
      conversationInput = (currentRequest.input as InputsUnion) ?? conversationInput;
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
export function toolResultsToMap(results: ToolExecutionResult[]): Map<
  string,
  {
    result: unknown;
    preliminaryResults?: unknown[];
  }
> {
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
export function summarizeToolExecutions(results: ToolExecutionResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (result.error) {
      lines.push(`[ERROR] ${result.toolName} (${result.toolCallId}): ${result.error.message}`);
    } else {
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
export function hasToolExecutionErrors(results: ToolExecutionResult[]): boolean {
  return results.some((result) => result.error !== undefined);
}

/**
 * Get all tool execution errors.
 */
export function getToolExecutionErrors(results: ToolExecutionResult[]): Error[] {
  return results
    .filter((result): result is ToolExecutionResult & { error: Error } =>
      result.error !== undefined,
    )
    .map((result) => result.error);
}
