/**
 * Ported from OpenRouter SDK's async-params.ts with adaptations for DMR-X.
 *
 * Provides `resolveAsyncFunctions()` — evaluates all function-valued fields
 * in a `CallModelInput`, returning a `ResolvedCallModelInput`.
 * Also provides `hasAsyncFunctions()` and related types for async parameter resolution.
 */
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Type guard to check if a value is a parameter function.
 * Parameter functions take TurnContext and return a value or promise.
 */
function isParameterFunction(value) {
    return typeof value === 'function';
}
/**
 * Build a resolved request object from entries.
 * This validates the structure matches the expected ResolvedCallModelInput shape.
 */
function buildResolvedRequest(entries) {
    const obj = Object.fromEntries(entries);
    return obj;
}
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
export async function resolveAsyncFunctions(input, context) {
    // Build array of resolved entries
    const resolvedEntries = [];
    // Fields that should not be sent to the API (client-side only)
    const clientOnlyFields = new Set([
        'stopWhen', // Handled separately in ModelResult
        'state', // Client-side state management
        'requireApproval', // Client-side approval check function
        'approveToolCalls', // Client-side approval decisions
        'rejectToolCalls', // Client-side rejection decisions
        'context', // Passed through via GetResponseOptions, not sent to API
        'sharedContextSchema', // Client-side schema for shared context validation
        'onTurnStart', // Client-side turn start callback
        'onTurnEnd', // Client-side turn end callback
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
                resolvedEntries.push([key, result]);
            }
            catch (error) {
                // Wrap errors with context about which field failed
                throw new Error(`Failed to resolve async function for field "${key}": ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else {
            // Not a function, use as-is
            resolvedEntries.push([key, value]);
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
export function hasAsyncFunctions(input) {
    if (!input || typeof input !== 'object') {
        return false;
    }
    return Object.values(input).some((value) => typeof value === 'function');
}
//# sourceMappingURL=async-params.js.map