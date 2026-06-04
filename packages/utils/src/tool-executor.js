/**
 * Tool execution functions for DMR-X.
 * Handles both regular and generator tool execution with context.
 *
 * Ported from OpenRouter SDK's tool-executor.ts with adaptations for DMR-X.
 * Uses Zod-agnostic schema types - tools receive arguments directly without
 * intermediate validation wrappers.
 */
import { hasExecuteFunction, isGeneratorTool, isRegularExecuteTool, buildToolExecuteContext, } from './tool-types.js';
export function sanitizeJsonSchema(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sanitizeJsonSchema);
    }
    // At this point, obj is a non-null, non-array object
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    const result = {};
    for (const key of Object.keys(obj)) {
        if (!key.startsWith('~')) {
            result[key] = sanitizeJsonSchema(obj[key]);
        }
    }
    return result;
}
/**
 * Check if a value is a Zod schema (has _zod property).
 * This is a type guard for Zod v4 schemas.
 */
function isZodSchema(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('_zod' in value)) {
        return false;
    }
    return typeof value._zod === 'object';
}
/**
 * Convert a Zod schema to JSON Schema.
 * When Zod is available, uses z4.toJSONSchema(). Otherwise, returns a basic
 * object schema placeholder.
 *
 * TODO: Add Zod as a dependency and implement proper conversion:
 *   import * as z4 from 'zod/v4';
 *   const jsonSchema = z4.toJSONSchema(zodSchema, { target: 'draft-7' });
 *   return sanitizeJsonSchema(jsonSchema);
 */
export function convertZodToJsonSchema(zodSchema) {
    if (isZodSchema(zodSchema)) {
        // Zod schema detected but z4 module not available
        // TODO: Import zod/v4 and use z4.toJSONSchema()
        console.warn('Zod schema detected but z4 module not available. ' +
            'Add zod as a dependency to enable proper schema conversion.');
        return { type: 'object', properties: {} };
    }
    // If it's already a plain object, assume it's JSON Schema
    if (typeof zodSchema === 'object' && zodSchema !== null && !Array.isArray(zodSchema)) {
        return sanitizeJsonSchema(zodSchema);
    }
    // Fallback
    return { type: 'object', properties: {} };
}
/**
 * Convert tools to OpenRouter API format.
 * Accepts readonly arrays for better type compatibility.
 */
export function convertToolsToAPIFormat(tools) {
    return tools.map((tool) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description || null,
        strict: null,
        parameters: convertZodToJsonSchema(tool.function.inputSchema),
    }));
}
// ---------------------------------------------------------------------------
// Schema utilities (Zod-agnostic)
// ---------------------------------------------------------------------------
// NOTE: validateToolInput, validateToolOutput, and tryValidate were removed.
// They were no-op pass-through stubs with no Zod dependency available.
// Callers now use arguments/results directly without validation wrappers.
/**
 * Parse tool call arguments from JSON string.
 * Treats empty/whitespace-only strings as an empty object -- some providers
 * return `arguments: ""` for tools that take no parameters.
 */
export function parseToolCallArguments(argumentsString) {
    const trimmed = argumentsString.trim();
    if (!trimmed) {
        return {};
    }
    try {
        return JSON.parse(trimmed);
    }
    catch (error) {
        throw new Error(`Failed to parse tool call arguments: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------
/**
 * Build a ToolExecuteContext for a tool from a TurnContext and optional context store.
 * Uses the existing buildToolExecuteContext from tool-context.ts.
 */
function buildExecuteCtx(tool, turnContext, contextStore) {
    return buildToolExecuteContext(turnContext, contextStore, tool.function.name, tool.function.contextSchema);
}
// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
/**
 * Execute a regular (non-generator) tool.
 */
export async function executeRegularTool(tool, toolCall, context, contextStore) {
    if (!isRegularExecuteTool(tool)) {
        throw new Error(`Tool "${toolCall.name}" is not a regular execute tool or has no execute function`);
    }
    try {
        const executeContext = buildExecuteCtx(tool, context, contextStore);
        // Execute tool with context
        const result = await Promise.resolve(tool.function.execute(toolCall.arguments, executeContext));
        return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result,
        };
    }
    catch (error) {
        return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
/**
 * Execute a generator tool and collect preliminary and final results.
 * - Intermediate yields are validated against eventSchema (preliminary events)
 * - Last yield is validated against outputSchema (final result sent to model)
 * - Generator must emit at least one value
 */
export async function executeGeneratorTool(tool, toolCall, context, onPreliminaryResult, contextStore) {
    if (!isGeneratorTool(tool)) {
        throw new Error(`Tool "${toolCall.name}" is not a generator tool`);
    }
    try {
        const executeContext = buildExecuteCtx(tool, context, contextStore);
        const preliminaryResults = [];
        let finalResult;
        let hasFinalResult = false;
        let lastEmittedValue;
        let hasEmittedValue = false;
        const iterator = tool.function.execute(toolCall.arguments, executeContext);
        let iterResult = await iterator.next();
        while (!iterResult.done) {
            const event = iterResult.value;
            lastEmittedValue = event;
            hasEmittedValue = true;
            // Treat the last emitted value as the final result if no explicit output follows
            if (!hasFinalResult) {
                finalResult = event;
                hasFinalResult = true;
            }
            else {
                preliminaryResults.push(event);
                if (onPreliminaryResult) {
                    onPreliminaryResult(toolCall.id, event);
                }
            }
            iterResult = await iterator.next();
        }
        if (iterResult.value !== undefined) {
            finalResult = iterResult.value;
            hasFinalResult = true;
        }
        if (!hasFinalResult) {
            if (!hasEmittedValue) {
                throw new Error(`Generator tool "${toolCall.name}" completed without emitting any values or returning a result`);
            }
            finalResult = lastEmittedValue;
        }
        return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: finalResult,
            preliminaryResults,
        };
    }
    catch (error) {
        return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
/**
 * Execute a tool call.
 * Automatically detects if it's a regular or generator tool.
 */
export async function executeTool(tool, toolCall, context, onPreliminaryResult, contextStore) {
    if (!hasExecuteFunction(tool)) {
        throw new Error(`Tool "${toolCall.name}" has no execute function. Use manual tool execution.`);
    }
    if (isGeneratorTool(tool)) {
        return executeGeneratorTool(tool, toolCall, context, onPreliminaryResult, contextStore);
    }
    return executeRegularTool(tool, toolCall, context, contextStore);
}
/**
 * Find a tool by name in the tools array.
 */
export function findToolByName(tools, name) {
    return tools.find((tool) => tool.function.name === name);
}
/**
 * Format tool execution result as a string for sending to the model.
 */
export function formatToolResultForModel(result) {
    if (result.error) {
        return JSON.stringify({
            error: result.error.message,
            toolName: result.toolName,
        });
    }
    return JSON.stringify(result.result);
}
/**
 * Create a user-friendly error message for tool execution errors.
 */
export function formatToolExecutionError(error, toolCall) {
    return `Tool "${toolCall.name}" execution error: ${error.message}`;
}
//# sourceMappingURL=tool-executor.js.map