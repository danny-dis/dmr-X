/**
 * Turn context builder for DMR-X tool execution.
 * Builds context objects for each tool execution turn in the orchestration loop.
 *
 * Ported from OpenRouter SDK's turn-context.ts with adaptations for DMR-X.
 */

import type {
  TurnContext,
  FunctionCallItem,
  InputsUnion,
  EasyInputMessage,
} from './tool-types.js';

import type { NextTurnRequest } from './next-turn-params.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for building a turn context.
 */
export interface BuildTurnContextOptions {
  /** Number of turns so far (1-indexed for tool execution, 0 for initial request) */
  numberOfTurns: number;
  /** The specific tool call being executed (optional for initial/async resolution contexts) */
  toolCall?: FunctionCallItem;
  /** The full request being sent to the API (optional for initial/async resolution contexts) */
  turnRequest?: NextTurnRequest;
}

// ---------------------------------------------------------------------------
// Turn context builder
// ---------------------------------------------------------------------------

/**
 * Build a turn context for tool execution or async parameter resolution.
 *
 * @param options - Options for building the context
 * @returns A TurnContext object
 *
 * @example
 * ```typescript
 * // For tool execution with full context
 * const context = buildTurnContext({
 *   numberOfTurns: 1,
 *   toolCall: rawToolCall,
 *   turnRequest: currentRequest,
 * });
 *
 * // For async parameter resolution (partial context)
 * const context = buildTurnContext({
 *   numberOfTurns: 0,
 * });
 * ```
 */
export function buildTurnContext(
  options: BuildTurnContextOptions,
): TurnContext {
  const context: TurnContext = {
    numberOfTurns: options.numberOfTurns,
  };

  if (options.toolCall !== undefined) {
    context.toolCall = options.toolCall as NonNullable<TurnContext['toolCall']>;
  }

  if (options.turnRequest !== undefined) {
    context.turnRequest = options.turnRequest;
  }

  return context;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/**
 * Normalize InputsUnion to an array format.
 * Converts string input to array with single user message.
 *
 * @param input - The input to normalize
 * @returns Array format of the input
 *
 * @example
 * ```typescript
 * const arrayInput = normalizeInputToArray("Hello!");
 * // Returns: [{ role: "user", content: "Hello!" }]
 * ```
 */
export function normalizeInputToArray(
  input: InputsUnion,
): Array<Record<string, unknown>> {
  if (typeof input === 'string') {
    // Construct object with required fields
    const message: EasyInputMessage = {
      role: 'user',
      content: input,
    };
    return [message as unknown as Record<string, unknown>];
  }
  return input as unknown as Array<Record<string, unknown>>;
}
