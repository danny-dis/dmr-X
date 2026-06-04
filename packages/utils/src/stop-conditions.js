/**
 * Composable stop condition factories for agentic loops.
 *
 * Provides factory functions that create `StopCondition` predicates evaluated
 * after each step in a multi-turn tool-use loop. Conditions are composable
 * via `isStopConditionMet` (OR logic).
 *
 * Ported from OpenRouter SDK's stop-conditions.ts with adaptations for DMR-X.
 */
// ---------------------------------------------------------------------------
// Stop condition factories
// ---------------------------------------------------------------------------
/**
 * Stop condition that checks if step count equals or exceeds a specific number.
 * @param stepCount - The number of steps to allow before stopping.
 * @returns StopCondition that returns true when steps.length >= stepCount.
 *
 * @example
 * ```typescript
 * stopWhen: stepCountIs(5) // Stop after 5 steps
 * ```
 */
export function stepCountIs(stepCount) {
    return ({ steps }) => steps.length >= stepCount;
}
/**
 * Stop condition that checks if any step contains a tool call with the given name.
 * @param toolName - The name of the tool to check for.
 * @returns StopCondition that returns true if the tool was called in any step.
 *
 * @example
 * ```typescript
 * stopWhen: hasToolCall('search') // Stop when search tool is called
 * ```
 */
export function hasToolCall(toolName) {
    return ({ steps }) => {
        return steps.some((step) => step.toolCalls.some((call) => call.name === toolName));
    };
}
/**
 * Evaluates an array of stop conditions.
 * Returns true if ANY condition returns true (OR logic).
 * @param options - Object containing stopConditions and steps.
 * @returns Promise<boolean> indicating if execution should stop.
 *
 * @example
 * ```typescript
 * const shouldStop = await isStopConditionMet({
 *   stopConditions: [stepCountIs(5), hasToolCall('search')],
 *   steps: allSteps
 * });
 * ```
 */
export async function isStopConditionMet(options) {
    const { stopConditions, steps } = options;
    // Evaluate all conditions in parallel
    const results = await Promise.all(stopConditions.map((condition) => Promise.resolve(condition({
        steps,
    }))));
    // Return true if ANY condition is true (OR logic)
    return results.some((result) => result === true);
}
/**
 * Stop when total token usage exceeds a threshold.
 *
 * @param maxTokens - Maximum total tokens to allow.
 * @returns StopCondition that returns true when token usage exceeds threshold.
 *
 * @example
 * ```typescript
 * stopWhen: maxTokensUsed(10000) // Stop when total tokens exceed 10,000
 * ```
 */
export function maxTokensUsed(maxTokens) {
    return ({ steps }) => {
        const totalTokens = steps.reduce((sum, step) => sum + (step.usage?.totalTokens ?? 0), 0);
        return totalTokens >= maxTokens;
    };
}
/**
 * Stop when total cost exceeds a threshold.
 *
 * @param maxCostInDollars - Maximum cost in dollars to allow.
 * @returns StopCondition that returns true when cost exceeds threshold.
 *
 * @example
 * ```typescript
 * stopWhen: maxCost(0.50) // Stop when total cost exceeds $0.50
 * ```
 */
export function maxCost(maxCostInDollars) {
    return ({ steps }) => {
        const totalCost = steps.reduce((sum, step) => sum + (step.usage?.cost ?? 0), 0);
        return totalCost >= maxCostInDollars;
    };
}
/**
 * Stop when a specific finish reason is encountered.
 *
 * @param reason - The finish reason to check for.
 * @returns StopCondition that returns true when finish reason matches.
 *
 * @example
 * ```typescript
 * stopWhen: finishReasonIs('length') // Stop when context length limit is hit
 * ```
 */
export function finishReasonIs(reason) {
    return ({ steps }) => {
        return steps.some((step) => step.finishReason === reason);
    };
}
//# sourceMappingURL=stop-conditions.js.map