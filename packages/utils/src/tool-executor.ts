/**
 * Tool execution functions for DMR-X.
 * Handles both regular and generator tool execution with context.
 *
 * Ported from OpenRouter SDK's tool-executor.ts with adaptations for DMR-X.
 * Uses Zod-agnostic schema types - tools receive arguments directly without
 * intermediate validation wrappers.
 */

import type {
  Tool,
  ParsedToolCall,
  ToolExecutionResult,
  TurnContext,
  ToolExecuteContext,
} from './tool-types.js';

import {
  hasExecuteFunction,
  isGeneratorTool,
  isRegularExecuteTool,
  ToolContextStore,
  buildToolExecuteContext,
} from './tool-types.js';

import type { ContextSchema } from './tool-context.js';

// ---------------------------------------------------------------------------
// Schema utilities (Zod-agnostic)
// ---------------------------------------------------------------------------

/**
 * Recursively remove keys prefixed with ~ from an object.
 * These are metadata properties (like ~standard from Standard Schema)
 * that should not be sent to downstream providers.
 * @see https://github.com/OpenRouterTeam/typescript-sdk/issues/131
 *
 * When given a Record<string, unknown>, returns Record<string, unknown>.
 * When given unknown, returns unknown (preserves primitives, null, etc).
 */
export function sanitizeJsonSchema(obj: Record<string, unknown>): Record<string, unknown>;
export function sanitizeJsonSchema(obj: unknown): unknown;
export function sanitizeJsonSchema(obj: unknown): unknown {
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

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('~')) {
      result[key] = sanitizeJsonSchema((obj as Record<string, unknown>)[key]);
    }
  }
  return result;
}

/**
 * Check if a value is a Zod schema (has _zod property).
 * This is a type guard for Zod v4 schemas.
 */
function isZodSchema(value: unknown): value is { _zod: object } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('_zod' in value)) {
    return false;
  }
  return typeof (value as any)._zod === 'object';
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
export function convertZodToJsonSchema(zodSchema: unknown): Record<string, unknown> {
  if (isZodSchema(zodSchema)) {
    // Zod schema detected but z4 module not available
    // TODO: Import zod/v4 and use z4.toJSONSchema()
    console.warn(
      'Zod schema detected but z4 module not available. ' +
      'Add zod as a dependency to enable proper schema conversion.',
    );
    return { type: 'object', properties: {} };
  }

  // If it's already a plain object, assume it's JSON Schema
  if (typeof zodSchema === 'object' && zodSchema !== null && !Array.isArray(zodSchema)) {
    return sanitizeJsonSchema(zodSchema as Record<string, unknown>);
  }

  // Fallback
  return { type: 'object', properties: {} };
}

/**
 * Convert tools to OpenRouter API format.
 * Accepts readonly arrays for better type compatibility.
 */
export function convertToolsToAPIFormat(tools: readonly Tool[]): APITool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.function.name,
    description: tool.function.description || null,
    strict: null,
    parameters: convertZodToJsonSchema(tool.function.inputSchema),
  }));
}

// Import APITool from tool-types for the return type
import type { APITool } from './tool-types.js';

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
export function parseToolCallArguments(argumentsString: string): unknown {
  const trimmed = argumentsString.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Failed to parse tool call arguments: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

/**
 * Build a ToolExecuteContext for a tool from a TurnContext and optional context store.
 * Uses the existing buildToolExecuteContext from tool-context.ts.
 */
function buildExecuteCtx(
  tool: Tool,
  turnContext: TurnContext,
  contextStore?: ToolContextStore,
): ToolExecuteContext {
  return buildToolExecuteContext(
    turnContext,
    contextStore,
    tool.function.name,
    tool.function.contextSchema as ContextSchema | undefined,
  );
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Execute a regular (non-generator) tool.
 */
export async function executeRegularTool(
  tool: Tool,
  toolCall: ParsedToolCall,
  context: TurnContext,
  contextStore?: ToolContextStore,
): Promise<ToolExecutionResult> {
  if (!isRegularExecuteTool(tool)) {
    throw new Error(
      `Tool "${toolCall.name}" is not a regular execute tool or has no execute function`,
    );
  }

  try {
    const executeContext = buildExecuteCtx(tool, context, contextStore);

    // Execute tool with context
    const result = await Promise.resolve(tool.function.execute!(toolCall.arguments, executeContext));

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
    };
  } catch (error) {
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
export async function executeGeneratorTool(
  tool: Tool,
  toolCall: ParsedToolCall,
  context: TurnContext,
  onPreliminaryResult?: (toolCallId: string, result: unknown) => void,
  contextStore?: ToolContextStore,
): Promise<ToolExecutionResult> {
  if (!isGeneratorTool(tool)) {
    throw new Error(`Tool "${toolCall.name}" is not a generator tool`);
  }

  try {
    const executeContext = buildExecuteCtx(tool, context, contextStore);

    const preliminaryResults: unknown[] = [];
    let finalResult: unknown;
    let hasFinalResult = false;
    let lastEmittedValue: unknown;
    let hasEmittedValue = false;

    const iterator = tool.function.execute!(toolCall.arguments, executeContext);
    let iterResult = await iterator.next();

    while (!iterResult.done) {
      const event = iterResult.value;
      lastEmittedValue = event;
      hasEmittedValue = true;

      // Treat the last emitted value as the final result if no explicit output follows
      if (!hasFinalResult) {
        finalResult = event;
        hasFinalResult = true;
      } else {
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
        throw new Error(
          `Generator tool "${toolCall.name}" completed without emitting any values or returning a result`,
        );
      }
      finalResult = lastEmittedValue;
    }

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: finalResult,
      preliminaryResults,
    };
  } catch (error) {
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
export async function executeTool(
  tool: Tool,
  toolCall: ParsedToolCall,
  context: TurnContext,
  onPreliminaryResult?: (toolCallId: string, result: unknown) => void,
  contextStore?: ToolContextStore,
): Promise<ToolExecutionResult> {
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
export function findToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find((tool) => tool.function.name === name);
}

/**
 * Format tool execution result as a string for sending to the model.
 */
export function formatToolResultForModel(result: ToolExecutionResult): string {
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
export function formatToolExecutionError(error: Error, toolCall: ParsedToolCall): string {
  return `Tool "${toolCall.name}" execution error: ${error.message}`;
}
