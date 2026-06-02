/**
 * Ported from OpenRouter SDK's async-params.ts with adaptations for DMR-X.
 *
 * Provides `resolveAsyncFunctions()` — evaluates all function-valued fields
 * in a `CallModelInput`, returning a `ResolvedCallModelInput`.
 * Also provides `hasAsyncFunctions()` and related types for async parameter resolution.
 */

// ---------------------------------------------------------------------------
// Imports from sibling modules
// ---------------------------------------------------------------------------

import type { ParsedToolCall } from './tool-types.js';
import type { TurnContext, ContextInput } from './tool-context.js';
import type { OpenResponsesResult } from './stream-type-guards.js';
import type { StopCondition, Tool } from './stop-conditions.js';

// ---------------------------------------------------------------------------
// Local type stubs (replaces ../models/index.js imports)
// ---------------------------------------------------------------------------

/**
 * Minimal Responses API request shape.
 * Mirrors the structure from packages/core/src/types/tool-types.ts.
 * Extend as DMR-X Responses API support matures.
 */
interface ResponsesRequest {
  /** The model to use */
  model?: string;
  /** Input items (messages, function calls, etc.) */
  input?: unknown;
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
  tools?: unknown[];
  /** Additional request fields */
  [key: string]: unknown;
}

/**
 * State accessor for multi-turn persistence and approval gates.
 * Provides read/write access to conversation state across turns.
 */
export interface StateAccessor<TTools extends readonly Tool[] = readonly Tool[]> {
  /** Get the current conversation state */
  get(): unknown;
  /** Update the conversation state */
  set(state: unknown): void;
  /** Get approved tool call IDs */
  getApprovedToolCalls(): string[];
  /** Get rejected tool call IDs */
  getRejectedToolCalls(): string[];
}

/**
 * Maps each tool to its typed context shape, plus an optional `shared` key
 * for cross-tool context data.
 */
export type ToolContextMapWithShared<
  TTools extends readonly Tool[] = readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> = {
  [K in TTools[number] as K extends { function: { name: infer N } } ? N extends string ? N : never : never]?: Record<string, unknown>;
} & { shared?: TShared };

/**
 * Stop condition type alias — a single predicate or array of predicates
 * that determine when the agentic loop should terminate.
 */
export type StopWhen<TTools extends readonly Tool[] = readonly Tool[]> =
  | StopCondition<TTools>
  | ReadonlyArray<StopCondition<TTools>>;

// Re-export Tool type for convenience
export type { Tool } from './tool-types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard to check if a value is a parameter function.
 * Parameter functions take TurnContext and return a value or promise.
 */
function isParameterFunction(
  value: unknown,
): value is (context: TurnContext) => unknown | Promise<unknown> {
  return typeof value === 'function';
}

/**
 * Build a resolved request object from entries.
 * This validates the structure matches the expected ResolvedCallModelInput shape.
 */
function buildResolvedRequest(
  entries: ReadonlyArray<readonly [string, unknown]>,
): ResolvedCallModelInput {
  const obj = Object.fromEntries(entries);
  return obj satisfies ResolvedCallModelInput;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * A field can be either a value of type T or a function that computes T.
 * Functions receive TurnContext for access to turn number and other state.
 */
export type FieldOrAsyncFunction<T> = T | ((context: TurnContext) => T | Promise<T>);

/**
 * Base input type for callModel without approval-related fields.
 * Each field can independently be a static value or a function that computes the value.
 */
type BaseCallModelInput<
  TTools extends readonly Tool[] = readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> = {
  [K in keyof Omit<ResponsesRequest, 'stream' | 'tools'>]?: FieldOrAsyncFunction<
    ResponsesRequest[K]
  >;
} & {
  tools?: TTools;
  stopWhen?: StopWhen<TTools>;
  /** Typed context data passed to tools via contextSchema. Includes optional `shared` key. */
  context?: ContextInput<ToolContextMapWithShared<TTools, TShared>>;
  /**
   * Call-level approval check — overrides tool-level requireApproval setting.
   * Receives the tool call and turn context, can be sync or async.
   */
  requireApproval?: (
    toolCall: ParsedToolCall,
    context: TurnContext,
  ) => boolean | Promise<boolean>;
  /**
   * Callback invoked at the start of each tool execution turn.
   * Receives the turn context with the current turn number.
   */
  onTurnStart?: (context: TurnContext) => void | Promise<void>;
  /**
   * Callback invoked at the end of each tool execution turn.
   * Receives the turn context and the completed response for that turn.
   */
  onTurnEnd?: (context: TurnContext, response: OpenResponsesResult) => void | Promise<void>;
};

/**
 * Approval params when state is provided (allows approve/reject).
 */
type ApprovalParamsWithState<TTools extends readonly Tool[] = readonly Tool[]> = {
  /** State accessor for multi-turn persistence and approval gates */
  state: StateAccessor<TTools>;
  /** Tool call IDs to approve (for resuming from awaiting_approval status) */
  approveToolCalls?: string[];
  /** Tool call IDs to reject (for resuming from awaiting_approval status) */
  rejectToolCalls?: string[];
};

/**
 * Approval params when state is NOT provided (forbids approve/reject).
 */
type ApprovalParamsWithoutState = {
  /** State accessor for multi-turn persistence and approval gates */
  state?: undefined;
  /** Not allowed without state — will cause type error */
  approveToolCalls?: never;
  /** Not allowed without state — will cause type error */
  rejectToolCalls?: never;
};

/**
 * Input type for callModel function.
 * Each field can independently be a static value or a function that computes the value.
 * Generic over TTools to enable proper type inference for stopWhen conditions.
 *
 * Type enforcement:
 * - `approveToolCalls` and `rejectToolCalls` are only valid when `state` is provided
 * - Using these without `state` will cause a TypeScript error
 */
export type CallModelInput<
  TTools extends readonly Tool[] = readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> = BaseCallModelInput<TTools, TShared> &
  (ApprovalParamsWithState<TTools> | ApprovalParamsWithoutState);

/**
 * CallModelInput variant that requires state — use when approval workflows are needed.
 */
export type CallModelInputWithState<
  TTools extends readonly Tool[] = readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> = BaseCallModelInput<TTools, TShared> & ApprovalParamsWithState<TTools>;

/**
 * Resolved CallModelInput (all functions evaluated to values).
 * This is the type after all async functions have been resolved to their values.
 */
export type ResolvedCallModelInput = Omit<ResponsesRequest, 'stream' | 'tools'> & {
  tools?: never;
};

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Resolve all async functions in CallModelInput to their values.
 *
 * @param input - Input with possible functions
 * @param context - Turn context for function execution
 * @returns Resolved input with all values (no functions)
 *
 * @example
 * ```typescript
 * const resolved = await resolveAsyncFunctions(
 *   {
 *     model: 'gpt-4',
 *     temperature: (ctx) => ctx.numberOfTurns * 0.1,
 *     input: 'Hello',
 *   },
 *   { numberOfTurns: 2 }
 * );
 * // resolved.temperature === 0.2
 * ```
 */
export async function resolveAsyncFunctions<TTools extends readonly Tool[] = readonly Tool[]>(
  input: CallModelInput<TTools>,
  context: TurnContext,
): Promise<ResolvedCallModelInput> {
  // Build array of resolved entries
  const resolvedEntries: Array<readonly [string, unknown]> = [];

  // Fields that should not be sent to the API (client-side only)
  const clientOnlyFields = new Set([
    'stopWhen',            // Handled separately in ModelResult
    'state',               // Client-side state management
    'requireApproval',     // Client-side approval check function
    'approveToolCalls',    // Client-side approval decisions
    'rejectToolCalls',     // Client-side rejection decisions
    'context',             // Passed through via GetResponseOptions, not sent to API
    'sharedContextSchema', // Client-side schema for shared context validation
    'onTurnStart',         // Client-side turn start callback
    'onTurnEnd',           // Client-side turn end callback
  ]);

  // Iterate over all keys in the input
  for (const [key, value] of Object.entries(input)) {
    // Skip client-only fields — they're handled separately and shouldn't be sent to the API.
    // Note: tools are already in API format at this point (converted in callModel()),
    // so we include them.
    if (clientOnlyFields.has(key)) {
      continue;
    }

    if (isParameterFunction(value)) {
      try {
        // Execute the function with context and store the result
        const result = await Promise.resolve(value(context));
        resolvedEntries.push([key, result] as const);
      } catch (error) {
        // Wrap errors with context about which field failed
        throw new Error(
          `Failed to resolve async function for field "${key}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      // Not a function, use as-is
      resolvedEntries.push([key, value] as const);
    }
  }

  return buildResolvedRequest(resolvedEntries);
}

/**
 * Check if input has any async functions that need resolution.
 *
 * @param input - Input to check
 * @returns True if any field is a function
 */
export function hasAsyncFunctions(input: unknown): boolean {
  if (!input || typeof input !== 'object') {
    return false;
  }
  return Object.values(input).some((value) => typeof value === 'function');
}
