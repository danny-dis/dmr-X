/**
 * Ported from OpenRouter SDK's tool-context.ts with adaptations for DMR-X.
 *
 * Provides a shared context store for tools across turns, including
 * reading/writing tool-local and shared context, and building
 * ToolExecuteContext for individual tool executions.
 */
// ---------------------------------------------------------------------------
// Local type definitions (replaces ./tool-types.js imports)
// ---------------------------------------------------------------------------
/**
 * Reserved key in the context store for shared context data.
 * The tool name 'shared' is forbidden -- it's reserved for this purpose.
 */
export const SHARED_CONTEXT_KEY = "shared";
// ---------------------------------------------------------------------------
// ToolContextStore
// ---------------------------------------------------------------------------
/**
 * Mutable context store shared across all tool executions within a callModel invocation.
 * Stores context keyed by tool name: `{ get_weather: { apiKey: '...' }, db_query: { dbUrl: '...' } }`.
 * Notifies listeners on changes.
 */
export class ToolContextStore {
    store;
    listeners = new Set();
    constructor(initialValues = {}) {
        this.store = {};
        for (const [key, value] of Object.entries(initialValues)) {
            this.store[key] = { ...value };
        }
    }
    /** Subscribe to context changes. Returns an unsubscribe function. */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Get a deep-shallow copy of the full context (all tools) */
    getSnapshot() {
        const snapshot = {};
        for (const [key, value] of Object.entries(this.store)) {
            snapshot[key] = { ...value };
        }
        return snapshot;
    }
    /** Get a shallow copy of context for a specific tool */
    getToolContext(toolName) {
        const data = this.store[toolName];
        if (!data) {
            return {};
        }
        return { ...data };
    }
    /** Set context for a specific tool and notify listeners */
    setToolContext(toolName, values) {
        this.store[toolName] = { ...values };
        this.notifyListeners();
    }
    /** Merge partial values into a specific tool's context and notify listeners */
    mergeToolContext(toolName, partial) {
        const existing = this.store[toolName] ?? {};
        this.store[toolName] = { ...existing, ...partial };
        this.notifyListeners();
    }
    notifyListeners() {
        const snapshot = {};
        for (const [key, value] of Object.entries(this.store)) {
            snapshot[key] = { ...value };
        }
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
}
// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
/**
 * Validate a partial update against a schema's shape, filtering to known keys
 * and validating each key individually. Returns the filtered partial.
 * Falls back to passing through all keys if the schema has no shape.
 */
function validatePartialAgainstSchema(partial, schema) {
    // If schema has a shape, filter and validate against known keys
    if (schema.shape) {
        const schemaKeys = Object.keys(schema.shape);
        const filteredPartial = {};
        for (const [key, value] of Object.entries(partial)) {
            if (schemaKeys.includes(key)) {
                filteredPartial[key] = value;
            }
        }
        for (const [key, value] of Object.entries(filteredPartial)) {
            const keySchema = schema.shape[key];
            if (keySchema) {
                keySchema.parse(value);
            }
        }
        return filteredPartial;
    }
    // No shape available -- validate the whole partial through the schema
    schema.parse(partial);
    return partial;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Build a flat ToolExecuteContext for a specific tool.
 * Returns a merged object with TurnContext fields, a `local` getter
 * (reads from the store on each access), `shared` getter, and mutation methods.
 *
 * The `local` and `shared` getters are live -- calling `setContext()` or
 * `setSharedContext()` and then reading the property reflects updated values immediately.
 *
 * @param turnContext - The current turn context
 * @param store - The shared context store (keyed by tool name)
 * @param toolName - The tool's name
 * @param schema - The tool's contextSchema (for validation)
 * @param sharedSchema - The shared contextSchema (for validation)
 * @returns A flat ToolExecuteContext
 */
export function buildToolExecuteContext(turnContext, store, toolName, schema, sharedSchema) {
    // Validate initial context eagerly (throws on bad data)
    if (store && schema) {
        extractToolContext(store, toolName, schema);
    }
    if (store && sharedSchema) {
        extractToolContext(store, SHARED_CONTEXT_KEY, sharedSchema);
    }
    const ctx = {
        ...turnContext,
        get local() {
            const data = store ? store.getToolContext(toolName) : {};
            return Object.freeze(data);
        },
        setContext(partial) {
            if (!store || !schema) {
                return;
            }
            const filteredPartial = validatePartialAgainstSchema(partial, schema);
            store.mergeToolContext(toolName, filteredPartial);
        },
        get shared() {
            const data = store
                ? store.getToolContext(SHARED_CONTEXT_KEY)
                : {};
            return Object.freeze(data);
        },
        setSharedContext(partial) {
            if (!store || !sharedSchema) {
                return;
            }
            const filteredPartial = validatePartialAgainstSchema(partial, sharedSchema);
            store.mergeToolContext(SHARED_CONTEXT_KEY, filteredPartial);
        },
    };
    return ctx;
}
/**
 * Resolve a context input (static value, sync function, or async function) to a plain object.
 *
 * @param contextInput - The context value or function from callModel
 * @param turnContext - The current turn context for function resolution
 * @returns The resolved context object (keyed by tool name)
 */
export async function resolveContext(contextInput, turnContext) {
    if (contextInput === undefined) {
        return {};
    }
    if (typeof contextInput === "function") {
        return Promise.resolve(contextInput(turnContext));
    }
    return contextInput;
}
/**
 * Extract and validate context values for a specific tool from the context store.
 * Returns a shallow copy so the caller cannot mutate the store directly.
 *
 * @param store - The shared context store (keyed by tool name)
 * @param toolName - The tool's name
 * @param schema - The tool's contextSchema
 * @returns A shallow copy of the validated context values for this tool
 */
export function extractToolContext(store, toolName, schema) {
    if (!schema) {
        return {};
    }
    const toolData = store.getToolContext(toolName);
    // Validate the extracted values against the schema
    schema.parse(toolData);
    // getToolContext already returns a shallow copy
    return toolData;
}
//# sourceMappingURL=tool-context.js.map