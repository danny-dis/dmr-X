/**
 * Ported from OpenRouter SDK's tool.ts with adaptations for DMR-X.
 *
 * Provides the `tool()` factory function with 5 overloads for defining tools:
 * 1. Generator tool (with eventSchema) -> returns `ToolWithGenerator`
 * 2. Manual tool (execute: false) -> returns `ManualTool`
 * 3. Regular tool with outputSchema -> returns `ToolWithExecute`
 * 4. Regular tool without outputSchema -> returns `ToolWithExecute`
 * 5. Shared context overload -> returns `Tool`
 *
 * Original used Zod v4 types ($ZodObject, $ZodShape, $ZodType, zodInfer).
 * Replaced with `unknown` + JSDoc TODO placeholders so the file compiles without Zod.
 * When Zod v4 (or compatible) is added to DMR-X, restore the schema type
 * parameters for full type-safe inference.
 */
// ---------------------------------------------------------------------------
// Local type definitions
// These types exist in packages/core/src/types/tool-types.ts but are defined
// locally here to avoid a cross-package dependency. Keep in sync with core.
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
// Implementation
export function tool(config) {
    // 'shared' is reserved for shared context -- forbid it as a tool name
    if (config.name === SHARED_CONTEXT_KEY) {
        throw new Error(`Tool name "${SHARED_CONTEXT_KEY}" is reserved for shared context. Choose a different name.`);
    }
    // Branch 1: Manual tool (execute === false)
    if (config.execute === false) {
        const fn = {
            name: config.name,
            inputSchema: config.inputSchema,
        };
        if (config.description !== undefined) {
            fn.description = config.description;
        }
        if (config.contextSchema !== undefined) {
            fn.contextSchema = config.contextSchema;
        }
        if (config.nextTurnParams !== undefined) {
            fn.nextTurnParams = config.nextTurnParams;
        }
        if (config.requireApproval !== undefined) {
            fn.requireApproval = config.requireApproval;
        }
        return {
            type: ToolType.Function,
            function: fn,
        };
    }
    // Branch 2: Generator tool (has eventSchema)
    if ('eventSchema' in config && config.eventSchema !== undefined) {
        const fn = {
            name: config.name,
            inputSchema: config.inputSchema,
            eventSchema: config.eventSchema,
            outputSchema: config.outputSchema,
            execute: config.execute,
        };
        if (config.description !== undefined) {
            fn.description = config.description;
        }
        if (config.contextSchema !== undefined) {
            fn.contextSchema = config.contextSchema;
        }
        if (config.nextTurnParams !== undefined) {
            fn.nextTurnParams = config.nextTurnParams;
        }
        if (config.requireApproval !== undefined) {
            fn.requireApproval = config.requireApproval;
        }
        return {
            type: ToolType.Function,
            function: fn,
        };
    }
    // Branch 3: Regular tool (has execute function, no eventSchema)
    const functionObj = {
        name: config.name,
        inputSchema: config.inputSchema,
        execute: config.execute,
        ...(config.description !== undefined && { description: config.description }),
        ...(config.outputSchema !== undefined && {
            outputSchema: config.outputSchema,
        }),
        ...(config.contextSchema !== undefined && { contextSchema: config.contextSchema }),
        ...(config.nextTurnParams !== undefined && { nextTurnParams: config.nextTurnParams }),
        ...(config.requireApproval !== undefined && { requireApproval: config.requireApproval }),
    };
    return {
        type: ToolType.Function,
        function: functionObj,
    };
}
//# sourceMappingURL=tool-factory.js.map