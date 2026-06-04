/**
 * Conversation state management for multi-turn agentic loops.
 *
 * Provides utilities for creating, updating, and querying conversation state,
 * including tool approval flow helpers and response extraction.
 *
 * Ported from OpenRouter SDK's conversation-state.ts with adaptations for DMR-X.
 */
// ---------------------------------------------------------------------------
// Local utility (replaces import from ./turn-context.js)
// ---------------------------------------------------------------------------
/** Normalize input to an array. */
function normalizeInputToArray(input) {
    return Array.isArray(input) ? input : [input];
}
// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------
/**
 * Type guard to verify an object is a valid UnsentToolResult.
 */
function isValidUnsentToolResult(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    return ('callId' in obj &&
        typeof obj.callId === 'string' &&
        'name' in obj &&
        typeof obj.name === 'string' &&
        'output' in obj);
}
/**
 * Type guard to verify an object is a valid ParsedToolCall.
 */
function isValidParsedToolCall(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    return ('id' in obj &&
        typeof obj.id === 'string' &&
        'name' in obj &&
        typeof obj.name === 'string' &&
        'arguments' in obj);
}
// ---------------------------------------------------------------------------
// Conversation state management
// ---------------------------------------------------------------------------
/**
 * Generate a unique ID for a conversation.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
export function generateConversationId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `conv_${crypto.randomUUID()}`;
    }
    // Fallback for environments without crypto.randomUUID
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
/**
 * Create an initial conversation state.
 * @param id - Optional custom ID, generates one if not provided.
 */
export function createInitialState(id) {
    const now = Date.now();
    return {
        id: id ?? generateConversationId(),
        messages: [],
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
    };
}
/**
 * Update a conversation state with new values.
 * Automatically updates the updatedAt timestamp.
 */
export function updateState(state, updates) {
    return {
        ...state,
        ...updates,
        updatedAt: Date.now(),
    };
}
/**
 * Append new items to the message history.
 */
export function appendToMessages(current, newItems) {
    const currentArray = normalizeInputToArray(current);
    return [...currentArray, ...newItems];
}
// ---------------------------------------------------------------------------
// Tool approval flow
// ---------------------------------------------------------------------------
/**
 * Check if a tool call requires approval.
 * @param toolCall - The tool call to check.
 * @param tools - Available tools.
 * @param context - Turn context for the approval check.
 * @param callLevelCheck - Optional call-level approval function (overrides tool-level), can be async.
 */
export async function toolRequiresApproval(toolCall, tools, context, callLevelCheck) {
    // Call-level check takes precedence
    if (callLevelCheck) {
        return callLevelCheck(toolCall, context);
    }
    // Fall back to tool-level setting
    const tool = tools.find((t) => t.function.name === toolCall.name);
    if (!tool)
        return false;
    const requireApproval = tool.function.requireApproval;
    // If it's a function, call it with the tool's arguments and context
    if (typeof requireApproval === 'function') {
        return requireApproval(toolCall.arguments, context);
    }
    // Otherwise treat as boolean
    return requireApproval ?? false;
}
/**
 * Partition tool calls into those requiring approval and those that can auto-execute.
 * @param toolCalls - Tool calls to partition.
 * @param tools - Available tools.
 * @param context - Turn context for the approval check.
 * @param callLevelCheck - Optional call-level approval function (overrides tool-level), can be async.
 */
export async function partitionToolCalls(toolCalls, tools, context, callLevelCheck) {
    const requiresApproval = [];
    const autoExecute = [];
    for (const tc of toolCalls) {
        if (await toolRequiresApproval(tc, tools, context, callLevelCheck)) {
            requiresApproval.push(tc);
        }
        else {
            autoExecute.push(tc);
        }
    }
    return { requiresApproval, autoExecute };
}
// ---------------------------------------------------------------------------
// Tool result creation
// ---------------------------------------------------------------------------
/**
 * Create an unsent tool result from a successful execution.
 */
export function createUnsentResult(callId, name, output) {
    const result = { callId, name, output };
    if (!isValidUnsentToolResult(result)) {
        throw new Error('Invalid UnsentToolResult structure');
    }
    return result;
}
/**
 * Create an unsent tool result from a rejection.
 */
export function createRejectedResult(callId, name, reason) {
    const result = {
        callId,
        name,
        output: null,
        error: reason ?? 'Tool call rejected by user',
    };
    if (!isValidUnsentToolResult(result)) {
        throw new Error('Invalid UnsentToolResult structure');
    }
    return result;
}
/**
 * Convert unsent tool results to API format for sending to the model.
 */
export function unsentResultsToAPIFormat(results) {
    return results.map((r) => ({
        type: 'function_call_output',
        id: `output_${r.callId}`,
        callId: r.callId,
        output: r.error
            ? JSON.stringify({ error: r.error })
            : JSON.stringify(r.output),
    }));
}
// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------
/**
 * Extract text content from a response.
 */
export function extractTextFromResponse(response) {
    if (!response.output) {
        return '';
    }
    const outputs = Array.isArray(response.output) ? response.output : [response.output];
    const textParts = [];
    for (const item of outputs) {
        if (item.type === 'message' && 'content' in item && item.content) {
            for (const content of item.content) {
                if (content.type === 'output_text' && 'text' in content && content.text) {
                    textParts.push(content.text);
                }
            }
        }
    }
    return textParts.join('');
}
/**
 * Extract tool calls from a response.
 */
export function extractToolCallsFromResponse(response) {
    if (!response.output) {
        return [];
    }
    const outputs = Array.isArray(response.output) ? response.output : [response.output];
    const toolCalls = [];
    for (const item of outputs) {
        if (item.type !== 'function_call' || !('arguments' in item)) {
            continue;
        }
        let parsedArguments;
        if (typeof item.arguments === 'string') {
            try {
                parsedArguments = JSON.parse(item.arguments);
            }
            catch (error) {
                // Log warning and skip malformed tool call
                console.warn(`Failed to parse arguments for tool call "${'name' in item ? item.name : 'unknown'}": ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        else {
            parsedArguments = item.arguments;
        }
        const toolCall = {
            id: ('callId' in item ? item.callId : undefined) ?? item.id ?? '',
            name: ('name' in item ? item.name : undefined) ?? '',
            arguments: parsedArguments,
        };
        if (!isValidParsedToolCall(toolCall)) {
            throw new Error(`Invalid tool call structure for tool: ${toolCall.name ?? 'unknown'}`);
        }
        toolCalls.push(toolCall);
    }
    return toolCalls;
}
//# sourceMappingURL=conversation-state.js.map