/**
 * Ported from OpenRouter SDK's next-turn-params.ts with adaptations for DMR-X.
 *
 * Provides executeNextTurnParamsFunctions() and applyNextTurnParamsToRequest()
 * for modifying request parameters between tool execution turns.
 */
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Type guard to check if a value is a Record<string, unknown>
 */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Type guard to check if a string is a valid NextTurnParamsContext key
 */
function isValidNextTurnParamKey(key) {
    const validKeys = new Set([
        "input",
        "model",
        "models",
        "temperature",
        "maxOutputTokens",
        "topP",
        "topK",
        "instructions",
    ]);
    return validKeys.has(key);
}
/**
 * Type-safe setter for NextTurnParamsContext
 */
function setNextTurnParam(target, key, value) {
    target[key] = value;
}
/**
 * Process nextTurnParams for a single tool call with full type safety
 */
async function processNextTurnParamsForCall(nextParams, params, workingContext, result, toolName) {
    for (const paramKey of Object.keys(nextParams)) {
        const fn = nextParams[paramKey];
        if (typeof fn !== "function") {
            continue;
        }
        if (!isValidNextTurnParamKey(paramKey)) {
            if (process.env["NODE_ENV"] !== "production") {
                console.warn(`Invalid nextTurnParams key "${paramKey}" in tool "${toolName}". ` +
                    `Valid keys: input, model, models, temperature, maxOutputTokens, topP, topK, instructions`);
            }
            continue;
        }
        const newValue = await Promise.resolve(fn(params, workingContext));
        setNextTurnParam(result, paramKey, newValue);
        setNextTurnParam(workingContext, paramKey, newValue);
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Build a NextTurnParamsContext from the current request.
 * Extracts relevant fields that can be modified by nextTurnParams functions.
 *
 * @param request - The current request
 * @returns Context object with current parameter values
 */
export function buildNextTurnParamsContext(request) {
    return {
        input: request.input ?? [],
        model: request.model ?? "",
        models: request.models ?? [],
        temperature: request.temperature ?? null,
        maxOutputTokens: request.maxOutputTokens ?? null,
        topP: request.topP ?? null,
        topK: request.topK,
        instructions: request.instructions ?? null,
    };
}
/**
 * Execute nextTurnParams functions for all called tools.
 * Composes functions when multiple tools modify the same parameter.
 *
 * @param toolCalls - Tool calls that were executed in this turn
 * @param tools - All available tools
 * @param currentRequest - The current request
 * @returns Object with computed parameter values
 */
export async function executeNextTurnParamsFunctions(toolCalls, tools, currentRequest) {
    const context = buildNextTurnParamsContext(currentRequest);
    const result = {};
    const workingContext = { ...context };
    for (const tool of tools) {
        if (!tool.function.nextTurnParams) {
            continue;
        }
        const callsForTool = toolCalls.filter((tc) => tc.name === tool.function.name);
        for (const call of callsForTool) {
            const nextParams = tool.function.nextTurnParams;
            if (!isRecord(call.arguments)) {
                const typeStr = Array.isArray(call.arguments)
                    ? "array"
                    : typeof call.arguments;
                throw new Error(`Tool call arguments for ${tool.function.name} must be an object, got ${typeStr}`);
            }
            await processNextTurnParamsForCall(nextParams, call.arguments, workingContext, result, tool.function.name);
        }
    }
    return result;
}
/**
 * Apply computed nextTurnParams to the current request.
 * Returns a new request object with updated parameters.
 *
 * @param request - The current request
 * @param computedParams - Computed parameter values from nextTurnParams functions
 * @returns New request with updated parameters
 */
export function applyNextTurnParamsToRequest(request, computedParams) {
    const sanitized = {};
    for (const [key, value] of Object.entries(computedParams)) {
        sanitized[key] = value === null ? undefined : value;
    }
    return {
        ...request,
        ...sanitized,
    };
}
//# sourceMappingURL=next-turn-params.js.map