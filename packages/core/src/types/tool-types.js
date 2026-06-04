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
// ---------------------------------------------------------------------------
// Core tool type system
// ---------------------------------------------------------------------------
/**
 * Tool type enum for enhanced tools.
 */
export var ToolType;
(function (ToolType) {
    ToolType["Function"] = "function";
})(ToolType || (ToolType = {}));
/**
 * Reserved key in the context store for shared context data.
 * The tool name 'shared' is forbidden -- it's reserved for this purpose.
 */
export const SHARED_CONTEXT_KEY = 'shared';
// ---------------------------------------------------------------------------
// Tool type guards
// ---------------------------------------------------------------------------
/**
 * Type guard to check if a tool has an execute function.
 */
export function hasExecuteFunction(tool) {
    return 'execute' in tool.function && typeof tool.function.execute === 'function';
}
/**
 * Type guard to check if a tool uses a generator (has eventSchema).
 */
export function isGeneratorTool(tool) {
    return 'eventSchema' in tool.function;
}
/**
 * Type guard to check if a tool is a regular execution tool (not generator).
 */
export function isRegularExecuteTool(tool) {
    return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}
/**
 * Type guard to check if a tool is a manual tool (no execute function).
 */
export function isManualTool(tool) {
    return !('execute' in tool.function);
}
/**
 * Type guard to check if an event is a tool preliminary result event.
 */
export function isToolPreliminaryResultEvent(event) {
    return event.type === 'tool.preliminary_result';
}
/**
 * Type guard to check if an event is a tool result event.
 */
export function isToolResultEvent(event) {
    return event.type === 'tool.result';
}
/**
 * Type guard to check if an event is a tool call output event.
 */
export function isToolCallOutputEvent(event) {
    return event.type === 'tool.call_output';
}
/**
 * Type guard to check if an event is a turn start event.
 */
export function isTurnStartEvent(event) {
    return event.type === 'turn.start';
}
/**
 * Type guard to check if an event is a turn end event.
 */
export function isTurnEndEvent(event) {
    return event.type === 'turn.end';
}
/**
 * Type guard to check if a tool has approval configured at runtime.
 */
export function toolHasApprovalConfigured(tool) {
    const requireApproval = tool.function.requireApproval;
    return requireApproval === true || typeof requireApproval === 'function';
}
/**
 * Type guard to check if any tools in array have approval configured at runtime.
 */
export function hasApprovalRequiredTools(tools) {
    return tools.some(toolHasApprovalConfigured);
}
//# sourceMappingURL=tool-types.js.map