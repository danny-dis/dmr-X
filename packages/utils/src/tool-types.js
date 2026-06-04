/**
 * Central type hub for the DMR-X tool execution system.
 * Re-exports types from existing modules and defines new types
 * needed by tool-executor, turn-context, and tool-orchestrator.
 *
 * Ported from OpenRouter SDK's tool-types.ts with adaptations for DMR-X.
 */
export { ToolContextStore, buildToolExecuteContext } from './tool-context.js';
export { executeNextTurnParamsFunctions, applyNextTurnParamsToRequest, } from './next-turn-params.js';
// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------
/**
 * Check if a tool has an execute function defined.
 */
export function hasExecuteFunction(tool) {
    return typeof tool.function.execute === 'function';
}
/**
 * Check if a tool is a generator tool (has eventSchema for intermediate yields).
 */
export function isGeneratorTool(tool) {
    return hasExecuteFunction(tool) && tool.function.eventSchema !== undefined;
}
/**
 * Check if a tool is a regular (non-generator) execute tool.
 */
export function isRegularExecuteTool(tool) {
    return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}
//# sourceMappingURL=tool-types.js.map