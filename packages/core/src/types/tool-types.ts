/**
 * Ported from OpenRouter SDK's tool-types.ts with adaptations for DMR-X.
 *
 * Defines the comprehensive type system for tool calling: Tool, ToolWithExecute,
 * ToolWithGenerator, ManualTool, ParsedToolCall, ToolExecutionResult, StepResult,
 * StopCondition, ConversationState, StateAccessor, APITool, TurnContext,
 * ToolExecuteContext, approval types, stream event types, and type guards.
 *
 * Original used Zod v4 types ($ZodObject, $ZodShape, $ZodType, zodInfer).
 * Replaced with `unknown` + JSDoc placeholders so the file compiles without Zod.
 * When Zod v4 (or compatible) is added to DMR-X, restore the schema type
 * parameters for full type-safe inference.
 */

import type { StreamChunk } from './stream.js';


// ---------------------------------------------------------------------------
// Local model type stubs
// The original OpenRouter SDK imports these from ../models/index.js.
// DMR-X has no models/ sub-package yet, so we define minimal equivalents.
// ---------------------------------------------------------------------------

/**
 * A single function-call item emitted by the model during a Responses turn.
 */
export interface FunctionCallItem {
  /** Unique ID for this tool call */
  id: string;
  /** Type discriminator */
  type: 'function_call';
  /** The function name the model wants to invoke */
  name: string;
  /** JSON-encoded arguments string */
  callId: string;
  /** JSON-encoded arguments */
  arguments: string;
}

/**
 * A function-call output item sent back to the model.
 */
export interface FunctionCallOutputItem {
  /** Type discriminator */
  type: 'function_call_output';
  /** The call ID this output responds to */
  callId: string;
  /** The output content (stringified) */
  output: string;
}

/**
 * Union of all possible input types for a Responses-style request.
 * In the original SDK this covers text inputs, function call items, etc.
 */
export type InputsUnion = Array<
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | FunctionCallItem
  | FunctionCallOutputItem
>;

/**
 * Usage statistics for a single API response.
 */
export interface Usage {
  /** Number of prompt (input) tokens used */
  input_tokens: number;
  /** Number of completion (output) tokens generated */
  output_tokens: number;
  /** Total tokens (input + output) */
  total_tokens?: number;
  /** Tokens used for internal reasoning / chain-of-thought */
  reasoning_tokens?: number;
}

/**
 * Result object returned by a Responses-style API call.
 * Simplified from OpenRouter SDK's OpenResponsesResult.
 */
export interface OpenResponsesResult {
  /** Unique response ID */
  id: string;
  /** The model that generated this response */
  model: string;
  /** Output items (text, function calls, etc.) */
  output: Array<
    | { type: 'message'; role: 'assistant'; content: Array<{ type: 'output_text'; text: string }> }
    | FunctionCallItem
    | { type: string; [k: string]: unknown }
  >;
  /** Token usage for this response */
  usage?: Usage | null;
  /** Status of the response */
  status?: 'completed' | 'failed' | 'in_progress';
  /** Whether the response is incomplete (e.g., hit max_tokens) */
  incomplete_details?: { reason: string } | null;
}

/**
 * A Responses-style request body.
 * Simplified from OpenRouter SDK's ResponsesRequest.
 */
export interface ResponsesRequest {
  /** The model to use */
  model: string;
  /** Input items (messages, function calls, etc.) */
  input: InputsUnion;
  /** System instructions */
  instructions?: string | null;
  /** Maximum output tokens */
  max_output_tokens?: number | null;
  /** Whether to stream the response */
  stream?: boolean;
  /** Temperature for sampling */
  temperature?: number | null;
  /** Top-p nucleus sampling */
  top_p?: number | null;
  /** Top-k sampling */
  top_k?: number | null;
  /** Tools available to the model */
  tools?: APITool[];
}

/**
 * Stream event union type.
 * In the original SDK this covers all possible SSE events from the Responses API.
 * We define a minimal version; extend as DMR-X stream handling matures.
 */
export type StreamEvents = StreamChunk & { [k: string]: unknown };

// ---------------------------------------------------------------------------
// Schema type alias (Zod replacement)
// ---------------------------------------------------------------------------

/**
 * Represents any Zod schema object. Replace with `$ZodObject<$ZodShape>` from
 * `zod/v4/core` when Zod v4 is available for full type inference.
 */
type ZodSchema = unknown;

/**
 * Infer the runtime type from a Zod schema. When Zod is available, replace
 * with `zodInfer<S>` from `zod/v4/core`.
 */
type InferSchema<S> = S extends { _type: infer T } ? T : unknown;

// ---------------------------------------------------------------------------
// Core tool type system
// ---------------------------------------------------------------------------

/**
 * Tool type enum for enhanced tools.
 */
export enum ToolType {
  Function = 'function',
}

/**
 * Turn context passed to tool execute functions and async parameter resolution.
 * Contains information about the current conversation state.
 */
export interface TurnContext {
  /** The specific tool call being executed (only available during tool execution) */
  toolCall?: FunctionCallItem;
  /** Number of tool execution turns so far (1-indexed: first turn = 1, 0 = initial request) */
  numberOfTurns: number;
  /** The full request being sent to the API (only available during tool execution) */
  turnRequest?: ResponsesRequest;
}

// ---------------------------------------------------------------------------
// Context Types
// ---------------------------------------------------------------------------

/**
 * Extract context schema type from a tool definition.
 * Returns the inferred type of the tool's contextSchema, or empty object if none.
 *
 * @remarks When Zod is available, the conditional branch checks for `$ZodType`.
 */
export type InferToolContext<T> = T extends { function: { contextSchema: infer S } }
  ? S extends ZodSchema ? InferSchema<S> : Record<string, never>
  : Record<string, never>;

/**
 * Extract tool name from a tool definition.
 */
type InferToolName<T> = T extends { function: { name: infer N extends string } } ? N : string;

/**
 * Flat execute context passed as the second argument to tool execute functions.
 * Merges TurnContext fields with a `local` getter (own tool context) and `setContext()`.
 *
 * @template TName - The tool's literal name string
 * @template TContext - The shape of the tool's contextSchema
 * @template TShared - The shape of the sharedContextSchema
 */
export type ToolExecuteContext<
  TName extends string = string,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TShared extends Record<string, unknown> = Record<string, unknown>,
> = TurnContext & {
  /** The tool's name (type-level only, for generic inference) */
  readonly _toolName?: TName;
  /** This tool's own context (reads from the store, frozen snapshot) */
  local: Readonly<TContext>;
  /** Mutate this tool's context in the shared store (persists across turns) */
  setContext(partial: Partial<TContext>): void;
  /** Shared context visible to all tools */
  shared: Readonly<TShared>;
  /** Mutate the shared context in the store (persists across turns) */
  setSharedContext(partial: Partial<TShared>): void;
};

/**
 * Context map keyed by tool name for callModel's `context` option.
 * Each key is a tool's name, each value is that tool's inferred context type.
 */
export type ToolContextMap<T extends readonly ToolDefinition[]> = {
  [K in T[number] as InferToolName<K>]: InferToolContext<K>;
};

/**
 * Context map with an optional `shared` key for shared context.
 * When TShared is provided (non-empty), a `shared` key is added to the map.
 */
export type ToolContextMapWithShared<
  T extends readonly ToolDefinition[],
  TShared extends Record<string, unknown> = Record<string, never>,
> = ToolContextMap<T> &
  (TShared extends Record<string, never> ? {} : { shared: TShared });

/**
 * Reserved key in the context store for shared context data.
 * The tool name 'shared' is forbidden -- it's reserved for this purpose.
 */
export const SHARED_CONTEXT_KEY = 'shared' as const;

/**
 * Context passed to nextTurnParams functions.
 * Contains current request state for parameter computation.
 * Allows modification of key request parameters between turns.
 */
export type NextTurnParamsContext = {
  /** Current input (messages) */
  input: InputsUnion;
  /** Current model selection */
  model: string;
  /** Current models array */
  models: string[];
  /** Current temperature */
  temperature: number | null;
  /** Current maxOutputTokens */
  maxOutputTokens: number | null;
  /** Current topP */
  topP: number | null;
  /** Current topK */
  topK?: number | undefined;
  /** Current instructions */
  instructions: string | null;
};

/**
 * Functions to compute next turn parameters.
 * Each function receives the tool's input params and current request context.
 */
export type NextTurnParamsFunctions<TInput> = {
  [K in keyof NextTurnParamsContext]?: (
    params: TInput,
    context: NextTurnParamsContext,
  ) => NextTurnParamsContext[K] | Promise<NextTurnParamsContext[K]>;
};

/**
 * Tool-level approval check function type.
 * Receives the tool's input params and turn context.
 * Returns true if approval is required, false otherwise.
 */
export type ToolApprovalCheck<TInput> = (
  params: TInput,
  context: TurnContext,
) => boolean | Promise<boolean>;

/**
 * Base tool function interface with inputSchema.
 *
 * @template TInput - Zod schema type for tool input (use `unknown` without Zod)
 */
export interface BaseToolFunction<TInput extends ZodSchema> {
  name: string;
  description?: string;
  /**
   * Zod schema (or JSON Schema) describing the tool's input parameters.
   * When Zod v4 is available, constrain to `$ZodObject<$ZodShape>`.
   */
  inputSchema: TInput;
  /**
   * Zod schema declaring the context data this tool needs.
   * When Zod v4 is available, constrain to `$ZodObject<$ZodShape>`.
   */
  contextSchema?: ZodSchema;
  nextTurnParams?: NextTurnParamsFunctions<InferSchema<TInput>>;
  /**
   * Whether this tool requires human approval before execution.
   * Can be a boolean or an async function that receives the tool's input params and context.
   */
  requireApproval?: boolean | ToolApprovalCheck<InferSchema<TInput>>;
}

/**
 * Regular tool with synchronous or asynchronous execute function and optional outputSchema.
 *
 * @template TInput - Zod schema type for tool input
 * @template TOutput - Zod schema type for tool output
 * @template TContext - Shape of the tool's context (inferred from contextSchema)
 * @template TName - The tool's literal name string
 */
export interface ToolFunctionWithExecute<
  TInput extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> extends BaseToolFunction<TInput> {
  /** Zod schema for validating the tool's output. */
  outputSchema?: TOutput;
  execute: (
    params: InferSchema<TInput>,
    context?: ToolExecuteContext<TName, TContext>,
  ) => Promise<InferSchema<TOutput>> | InferSchema<TOutput>;
}

/**
 * Generator-based tool with async generator execute function.
 * Emits preliminary events (validated by eventSchema) during execution
 * and a final output (validated by outputSchema) as the last emission.
 *
 * The generator can yield both events and the final output.
 * All yields are validated against eventSchema (which should be a union of event and output types),
 * and the last yield is additionally validated against outputSchema.
 *
 * @example
 * ```typescript
 * {
 *   eventSchema: z.object({ status: z.string() }),  // For progress events
 *   outputSchema: z.object({ result: z.number() }), // For final output
 *   execute: async function* (params) {
 *     yield { status: "processing..." };  // Event
 *     yield { status: "almost done..." }; // Event
 *     yield { result: 42 };               // Final output (must be last)
 *   }
 * }
 * ```
 */
export interface ToolFunctionWithGenerator<
  TInput extends ZodSchema = ZodSchema,
  TEvent extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> extends BaseToolFunction<TInput> {
  /** Zod schema for validating yielded events. */
  eventSchema: TEvent;
  /** Zod schema for validating the final output. */
  outputSchema: TOutput;
  execute: (
    params: InferSchema<TInput>,
    context?: ToolExecuteContext<TName, TContext>,
  ) => AsyncGenerator<InferSchema<TEvent> | InferSchema<TOutput>, InferSchema<TOutput> | void>;
}

/**
 * Manual tool without execute function -- requires manual handling by developer.
 */
export interface ManualToolFunction<
  TInput extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
> extends BaseToolFunction<TInput> {
  /** Zod schema for validating the tool's output. */
  outputSchema?: TOutput;
}

/**
 * Tool with execute function (regular or generator).
 */
export type ToolWithExecute<
  TInput extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
  TContext extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: ToolType.Function;
  function: ToolFunctionWithExecute<TInput, TOutput, TContext>;
};

/**
 * Tool with generator execute function.
 */
export type ToolWithGenerator<
  TInput extends ZodSchema = ZodSchema,
  TEvent extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
  TContext extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: ToolType.Function;
  function: ToolFunctionWithGenerator<TInput, TEvent, TOutput, TContext>;
};

/**
 * Tool without execute function (manual handling).
 */
export type ManualTool<
  TInput extends ZodSchema = ZodSchema,
  TOutput extends ZodSchema = ZodSchema,
> = {
  type: ToolType.Function;
  function: ManualToolFunction<TInput, TOutput>;
};

/**
 * Union type of all enhanced tool types.
 *
 * Named `ToolDefinition` (not `Tool`) to avoid collision with the simpler
 * `Tool` type from `./request.ts` which represents the basic OpenAI
 * function-calling format.
 *
 * Use this for the enhanced tool system with execution, generators,
 * approval, and context support.
 */
export type ToolDefinition =
  | ToolWithExecute<ZodSchema, ZodSchema>
  | ToolWithGenerator<ZodSchema, ZodSchema, ZodSchema>
  | ManualTool<ZodSchema, ZodSchema>;

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the input type from a tool definition.
 */
export type InferToolInput<T> = T extends { function: { inputSchema: infer S } }
  ? S extends ZodSchema
    ? InferSchema<S>
    : unknown
  : unknown;

/**
 * Extracts the output type from a tool definition.
 */
export type InferToolOutput<T> = T extends { function: { outputSchema: infer S } }
  ? S extends ZodSchema
    ? InferSchema<S>
    : unknown
  : unknown;

/**
 * A tool call with typed arguments based on the tool's inputSchema.
 */
export type TypedToolCall<T extends ToolDefinition> = {
  id: string;
  name: T extends { function: { name: infer N } } ? N : string;
  arguments: InferToolInput<T>;
};

/**
 * Union of typed tool calls for a tuple of tools.
 */
export type TypedToolCallUnion<T extends readonly ToolDefinition[]> = {
  [K in keyof T]: T[K] extends ToolDefinition ? TypedToolCall<T[K]> : never;
}[number];

/**
 * Union of typed tool execution results for a tuple of tools.
 */
export type ToolExecutionResultUnion<T extends readonly ToolDefinition[]> = {
  [K in keyof T]: T[K] extends ToolDefinition ? ToolExecutionResult<T[K]> : never;
}[number];

/**
 * Union of output types for all tools in a tuple.
 * Used for typing tool result events.
 */
export type InferToolOutputsUnion<T extends readonly ToolDefinition[]> = {
  [K in keyof T]: T[K] extends ToolDefinition ? InferToolOutput<T[K]> : never;
}[number];

/**
 * Extracts the event type from a generator tool definition.
 * Returns `never` for non-generator tools.
 */
export type InferToolEvent<T> = T extends { function: { eventSchema: infer S } }
  ? S extends ZodSchema
    ? InferSchema<S>
    : never
  : never;

/**
 * Union of event types for all generator tools in a tuple.
 * Filters out non-generator tools (which return `never`).
 */
export type InferToolEventsUnion<T extends readonly ToolDefinition[]> = {
  [K in keyof T]: T[K] extends ToolDefinition ? InferToolEvent<T[K]> : never;
}[number];

// ---------------------------------------------------------------------------
// Tool type guards
// ---------------------------------------------------------------------------

/**
 * Type guard to check if a tool has an execute function.
 */
export function hasExecuteFunction(
  tool: ToolDefinition,
): tool is ToolWithExecute | ToolWithGenerator {
  return 'execute' in tool.function && typeof tool.function.execute === 'function';
}

/**
 * Type guard to check if a tool uses a generator (has eventSchema).
 */
export function isGeneratorTool(tool: ToolDefinition): tool is ToolWithGenerator {
  return 'eventSchema' in tool.function;
}

/**
 * Type guard to check if a tool is a regular execution tool (not generator).
 */
export function isRegularExecuteTool(tool: ToolDefinition): tool is ToolWithExecute {
  return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}

/**
 * Type guard to check if a tool is a manual tool (no execute function).
 */
export function isManualTool(tool: ToolDefinition): tool is ManualTool {
  return !('execute' in tool.function);
}

// ---------------------------------------------------------------------------
// Parsed tool calls and execution results
// ---------------------------------------------------------------------------

/**
 * Parsed tool call from API response.
 * @template T - The tool type to infer argument types from
 */
export interface ParsedToolCall<T extends ToolDefinition> {
  id: string;
  name: T extends { function: { name: infer N } } ? N : string;
  arguments: InferToolInput<T>;
}

/**
 * Result of tool execution.
 * @template T - The tool type to infer result types from
 */
export interface ToolExecutionResult<T extends ToolDefinition> {
  toolCallId: string;
  toolName: string;
  /**
   * Final result (sent to model).
   * Inferred from the tool's outputSchema.
   */
  result: T extends ToolWithExecute<ZodSchema, infer O> | ToolWithGenerator<ZodSchema, ZodSchema, infer O>
    ? InferSchema<O>
    : unknown;
  /**
   * All yielded values from generator tools.
   * `undefined` for regular (non-generator) tools.
   */
  preliminaryResults?: T extends ToolWithGenerator<ZodSchema, infer E>
    ? Array<InferSchema<E>>
    : undefined;
  error?: Error;
}

// ---------------------------------------------------------------------------
// Step results and stop conditions
// ---------------------------------------------------------------------------

/**
 * Warning from step execution.
 */
export interface Warning {
  type: string;
  message: string;
}

/**
 * Result of a single step in the tool execution loop.
 * Compatible with Vercel AI SDK pattern.
 */
export interface StepResult<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  readonly stepType: 'initial' | 'continue';
  readonly text: string;
  readonly toolCalls: TypedToolCallUnion<TTools>[];
  readonly toolResults: ToolExecutionResultUnion<TTools>[];
  readonly response: OpenResponsesResult;
  readonly usage?: Usage | null | undefined;
  readonly finishReason?: string | undefined;
  readonly warnings?: Warning[] | undefined;
  readonly experimental_providerMetadata?: Record<string, unknown> | undefined;
}

/**
 * A condition function that determines whether to stop tool execution.
 * Returns true to STOP execution, false to CONTINUE.
 * (Matches Vercel AI SDK semantics.)
 */
export type StopCondition<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> = (
  options: {
    readonly steps: ReadonlyArray<StepResult<TTools>>;
  },
) => boolean | Promise<boolean>;

/**
 * Stop condition configuration.
 * Can be a single condition or array of conditions.
 */
export type StopWhen<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> =
  | StopCondition<TTools>
  | ReadonlyArray<StopCondition<TTools>>;

/**
 * Result of executeTools operation.
 */
export interface ExecuteToolsResult<TTools extends readonly ToolDefinition[]> {
  finalResponse: ModelResult<TTools>;
  allResponses: ModelResult<TTools>[];
  toolResults: Map<
    string,
    {
      result: unknown;
      preliminaryResults?: unknown[];
    }
  >;
}

// ---------------------------------------------------------------------------
// API tool format
// ---------------------------------------------------------------------------

/**
 * Standard tool format for OpenRouter API (JSON Schema based).
 * Matches ResponsesRequestToolFunction structure.
 */
export interface APITool {
  type: 'function';
  name: string;
  description?: string | null;
  strict?: boolean | null;
  parameters: {
    [k: string]: unknown;
  } | null;
}

// ---------------------------------------------------------------------------
// ModelResult (defined locally; not available in DMR-X yet)
// ---------------------------------------------------------------------------

/**
 * Result of a model call within the tool execution loop.
 * Returned by each turn in a multi-turn tool conversation.
 *
 * @template TTools - The tools array type for proper type inference
 */
export interface ModelResult<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  /** The raw API response from this turn */
  response: OpenResponsesResult;
  /** Token usage for this turn */
  usage?: Usage | null;
  /** Tool calls the model requested in this turn */
  toolCalls?: Array<ParsedToolCall<TTools[number]>>;
  /** Text content of the model's response */
  text?: string;
  /** Whether the model indicated it was done (no more tool calls) */
  done: boolean;
}

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

/**
 * Tool preliminary result event emitted during generator tool execution.
 * @template TEvent - The event type from the tool's eventSchema
 */
export type ToolPreliminaryResultEvent<TEvent = unknown> = {
  type: 'tool.preliminary_result';
  toolCallId: string;
  result: TEvent;
  timestamp: number;
};

/**
 * Tool result event emitted when a tool execution completes.
 * Contains the final result and any preliminary results that were emitted.
 * @template TResult - The result type from the tool's outputSchema
 * @template TPreliminaryResults - The event type from generator tools' eventSchema
 */
export type ToolResultEvent<TResult = unknown, TPreliminaryResults = unknown> = {
  type: 'tool.result';
  toolCallId: string;
  result: TResult;
  timestamp: number;
  preliminaryResults?: TPreliminaryResults[];
};

/**
 * Tool call output event carrying the fully-formed FunctionCallOutputItem.
 * Broadcast by executeToolRound so passive consumers (getItemsStream) can yield
 * tool results in real-time without owning tool execution.
 */
export type ToolCallOutputEvent = {
  type: 'tool.call_output';
  output: FunctionCallOutputItem;
  timestamp: number;
};

/**
 * Turn start event emitted at the beginning of each API turn.
 * Turn 0 is the initial request, subsequent turns follow tool execution.
 */
export type TurnStartEvent = {
  type: 'turn.start';
  turnNumber: number;
  timestamp: number;
};

/**
 * Turn end event emitted at the end of each API turn.
 */
export type TurnEndEvent = {
  type: 'turn.end';
  turnNumber: number;
  timestamp: number;
};

/**
 * Enhanced stream event types for getFullResponsesStream.
 * Extends StreamEvents with tool preliminary results, tool results,
 * and turn delimiter events for multi-turn streaming.
 *
 * @template TEvent - The event type from generator tools
 * @template TResult - The result type from tool execution
 */
export type ResponseStreamEvent<TEvent = unknown, TResult = unknown> =
  | StreamEvents
  | ToolPreliminaryResultEvent<TEvent>
  | ToolResultEvent<TResult, TEvent>
  | ToolCallOutputEvent
  | TurnStartEvent
  | TurnEndEvent;

/**
 * Type guard to check if an event is a tool preliminary result event.
 */
export function isToolPreliminaryResultEvent<TEvent = unknown>(
  event: ResponseStreamEvent<TEvent>,
): event is ToolPreliminaryResultEvent<TEvent> {
  return event.type === 'tool.preliminary_result';
}

/**
 * Type guard to check if an event is a tool result event.
 */
export function isToolResultEvent<TResult = unknown, TPreliminaryResults = unknown>(
  event: ResponseStreamEvent<TPreliminaryResults, TResult>,
): event is ToolResultEvent<TResult, TPreliminaryResults> {
  return event.type === 'tool.result';
}

/**
 * Type guard to check if an event is a tool call output event.
 */
export function isToolCallOutputEvent(
  event: ResponseStreamEvent,
): event is ToolCallOutputEvent {
  return event.type === 'tool.call_output';
}

/**
 * Type guard to check if an event is a turn start event.
 */
export function isTurnStartEvent(
  event: ResponseStreamEvent,
): event is TurnStartEvent {
  return event.type === 'turn.start';
}

/**
 * Type guard to check if an event is a turn end event.
 */
export function isTurnEndEvent(
  event: ResponseStreamEvent,
): event is TurnEndEvent {
  return event.type === 'turn.end';
}

/**
 * Tool stream event types for getToolStream.
 * Includes both argument deltas and preliminary results.
 * @template TEvent - The event type from generator tools
 */
export type ToolStreamEvent<TEvent = unknown> =
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'preliminary_result';
      toolCallId: string;
      result: TEvent;
    };

/**
 * Chat stream event types for getFullChatStream.
 * Includes content deltas, completion events, and tool preliminary results.
 * @template TEvent - The event type from generator tools
 */
export type ChatStreamEvent<TEvent = unknown> =
  | {
      type: 'content.delta';
      delta: string;
    }
  | {
      type: 'message.complete';
      response: OpenResponsesResult;
    }
  | {
      type: 'tool.preliminary_result';
      toolCallId: string;
      result: TEvent;
    }
  | {
      type: string;
      event: StreamEvents;
    }; // Pass-through for other events

// ---------------------------------------------------------------------------
// Conversation state and approval
// ---------------------------------------------------------------------------

/**
 * Result of a tool execution that hasn't been sent to the model yet.
 * Used for interrupted or awaiting approval states.
 * @template TTools - The tools array type for proper type inference
 */
export interface UnsentToolResult<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  /** The ID of the tool call this result is for */
  callId: string;
  /** The name of the tool that was executed */
  name: TTools[number]['function']['name'];
  /** The output of the tool execution */
  output: unknown;
  /** Error message if the tool call was rejected or failed */
  error?: string;
}

/**
 * Partial response captured during interruption.
 * @template TTools - The tools array type for proper type inference
 */
export interface PartialResponse<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  /** Partial text response accumulated before interruption */
  text?: string;
  /** Tool calls that were in progress when interrupted */
  toolCalls?: Array<ParsedToolCall<TTools[number]>>;
}

/**
 * Status of a conversation state.
 */
export type ConversationStatus =
  | 'complete'
  | 'interrupted'
  | 'awaiting_approval'
  | 'in_progress';

/**
 * State for multi-turn conversations with persistence and approval gates.
 * @template TTools - The tools array type for proper type inference
 */
export interface ConversationState<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  /** Unique identifier for this conversation */
  id: string;
  /** Full message history */
  messages: InputsUnion;
  /** Previous response ID for chaining (OpenRouter server-side optimization) */
  previousResponseId?: string;
  /** Tool calls awaiting human approval */
  pendingToolCalls?: Array<ParsedToolCall<TTools[number]>>;
  /** Tool results executed but not yet sent to the model */
  unsentToolResults?: Array<UnsentToolResult<TTools>>;
  /** Partial response data captured during interruption */
  partialResponse?: PartialResponse<TTools>;
  /** Signal from a new request to interrupt this conversation */
  interruptedBy?: string;
  /** Current status of the conversation */
  status: ConversationStatus;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Last update timestamp (Unix ms) */
  updatedAt: number;
}

/**
 * State accessor for loading and saving conversation state.
 * Enables any storage backend (memory, Redis, database, etc.).
 * @template TTools - The tools array type for proper type inference
 */
export interface StateAccessor<TTools extends readonly ToolDefinition[] = readonly ToolDefinition[]> {
  /** Load the current conversation state, or null if none exists */
  load: () => Promise<ConversationState<TTools> | null>;
  /** Save the conversation state */
  save: (state: ConversationState<TTools>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Approval type-level checks
// ---------------------------------------------------------------------------

/**
 * Check if a single tool has approval configured (non-false, non-undefined).
 * Returns true if the tool definitely requires approval,
 * false if it definitely doesn't, or boolean if it's uncertain.
 */
export type ToolHasApproval<T extends ToolDefinition> =
  T extends { function: { requireApproval: true | ToolApprovalCheck<unknown> } }
    ? true
    : T extends { function: { requireApproval: false } }
      ? false
      : T extends { function: { requireApproval: undefined } }
        ? false
        : boolean; // Could be either (optional property)

/**
 * Check if ANY tool in an array has approval configured.
 * Returns true if at least one tool might require approval.
 */
export type HasApprovalTools<TTools extends readonly ToolDefinition[]> =
  TTools extends readonly [infer First extends ToolDefinition, ...infer Rest extends ToolDefinition[]]
    ? ToolHasApproval<First> extends true
      ? true
      : HasApprovalTools<Rest>
    : false;

/**
 * Type guard to check if a tool has approval configured at runtime.
 */
export function toolHasApprovalConfigured(tool: ToolDefinition): boolean {
  const requireApproval = tool.function.requireApproval;
  return requireApproval === true || typeof requireApproval === 'function';
}

/**
 * Type guard to check if any tools in array have approval configured at runtime.
 */
export function hasApprovalRequiredTools(tools: readonly ToolDefinition[]): boolean {
  return tools.some(toolHasApprovalConfigured);
}
