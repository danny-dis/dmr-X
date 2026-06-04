/**
 * Turn context builder for DMR-X tool execution.
 * Builds context objects for each tool execution turn in the orchestration loop.
 *
 * Ported from OpenRouter SDK's turn-context.ts with adaptations for DMR-X.
 */
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
export function buildTurnContext(options) {
    const context = {
        numberOfTurns: options.numberOfTurns,
    };
    if (options.toolCall !== undefined) {
        context.toolCall = options.toolCall;
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
export function normalizeInputToArray(input) {
    if (typeof input === 'string') {
        // Construct object with required fields
        const message = {
            role: 'user',
            content: input,
        };
        return [message];
    }
    return input;
}
//# sourceMappingURL=turn-context.js.map