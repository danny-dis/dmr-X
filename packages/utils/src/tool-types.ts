/**
 * Central type hub for the DMR-X tool execution system.
 * Re-exports types from existing modules and defines new types
 * needed by tool-executor, turn-context, and tool-orchestrator.
 *
 * Ported from OpenRouter SDK's tool-types.ts with adaptations for DMR-X.
 */

// ---------------------------------------------------------------------------
// Re-export types from existing modules
// ---------------------------------------------------------------------------

// Turn context and execute context from tool-context.ts
import type { ContextSchema } from './tool-context.js';

export type {
  TurnContext,
  ToolExecuteContext,
  ContextSchema,
} from './tool-context.js';

export { ToolContextStore, buildToolExecuteContext } from './tool-context.js';

// FunctionCallItem, InputsUnion, EasyInputMessage from anthropic-compat.ts
export type {
  FunctionCallItem,
  InputsUnion,
  EasyInputMessage,
} from './anthropic-compat.js';

// ParsedToolCall from stream-transformers.ts (canonical source)
export type { ParsedToolCall } from './stream-transformers.js';

// OpenResponsesResult, OutputFunctionCallItem from stream-type-guards.ts
export type {
  OpenResponsesResult,
  OutputFunctionCallItem,
} from './stream-type-guards.js';

// Next-turn params from next-turn-params.ts
export type {
  NextTurnParamsContext,
  NextTurnRequest,
} from './next-turn-params.js';

export {
  executeNextTurnParamsFunctions,
  applyNextTurnParamsToRequest,
} from './next-turn-params.js';

// ---------------------------------------------------------------------------
// New types for the tool execution system
// ---------------------------------------------------------------------------

/**
 * Tool function definition with execute capability.
 * Extends the basic tool definition with schema types and execution logic.
 */
export interface ToolFunction {
  /** Tool name used in API calls */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Input validation schema (Zod type when available) */
  inputSchema?: unknown;
  /** Parameters schema (JSON Schema format, alternative to inputSchema) */
  parameters?: Record<string, unknown>;
  /** Output validation schema (Zod type when available, optional) */
  outputSchema?: unknown;
  /** Event schema for generator tools (Zod type when available) */
  eventSchema?: unknown;
  /** Context schema for shared tool context */
  contextSchema?: ContextSchema;
  /** Tool execution function */
  execute?: (...args: any[]) => any;
}

/**
 * Tool definition with function metadata and execution logic.
 * Compatible with the OpenRouter SDK Tool type.
 */
export interface Tool {
  function: ToolFunction;
}

/**
 * Tool in API format (JSON Schema) for sending to providers.
 */
export interface APITool {
  type: 'function';
  name: string;
  description: string | null;
  strict: null;
  parameters: Record<string, unknown>;
}

/**
 * Result of executing a tool call.
 */
export interface ToolExecutionResult {
  /** The tool call ID from the API response */
  toolCallId: string;
  /** The tool name */
  toolName: string;
  /** The execution result (null if error) */
  result: unknown;
  /** Preliminary results from generator tools (intermediate yields) */
  preliminaryResults?: unknown[];
  /** Error if execution failed */
  error?: Error;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Check if a tool has an execute function defined.
 */
export function hasExecuteFunction(tool: Tool): boolean {
  return typeof tool.function.execute === 'function';
}

/**
 * Check if a tool is a generator tool (has eventSchema for intermediate yields).
 */
export function isGeneratorTool(tool: Tool): boolean {
  return hasExecuteFunction(tool) && tool.function.eventSchema !== undefined;
}

/**
 * Check if a tool is a regular (non-generator) execute tool.
 */
export function isRegularExecuteTool(tool: Tool): boolean {
  return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}
