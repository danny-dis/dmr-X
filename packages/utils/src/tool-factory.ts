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

import type { ToolExecuteContext } from './tool-context.js';

// ---------------------------------------------------------------------------
// Local type definitions
// These types exist in packages/core/src/types/tool-types.ts but are defined
// locally here to avoid a cross-package dependency. Keep in sync with core.
// ---------------------------------------------------------------------------

/**
 * Tool type enum for enhanced tools.
 */
export enum ToolType {
  Function = 'function',
}

/**
 * Reserved key in the context store for shared context data.
 * The tool name 'shared' is forbidden -- it's reserved for this purpose.
 */
export const SHARED_CONTEXT_KEY = 'shared' as const;

/**
 * Functions to compute next turn parameters.
 * Each function receives the tool's input params and current request context.
 *
 * @template TInput - The inferred input type (Zod schema infer when available)
 *
 * TODO: When Zod is available, replace `Record<string, unknown>` with proper
 * NextTurnParamsFunctions<zodInfer<TInput>> from packages/core/src/types/tool-types.ts.
 */
export type NextTurnParamsFunctions<TInput = Record<string, unknown>> = {
  [key: string]:
    | ((params: TInput, context: Record<string, unknown>) => unknown)
    | ((params: TInput, context: Record<string, unknown>) => Promise<unknown>)
    | undefined;
};

/**
 * Tool-level approval check function type.
 * Receives the tool's input params and turn context.
 * Returns true if approval is required, false otherwise.
 *
 * @template TInput - The inferred input type (Zod schema infer when available)
 *
 * TODO: When Zod is available, replace with proper ToolApprovalCheck<zodInfer<TInput>>
 * from packages/core/src/types/tool-types.ts.
 */
export type ToolApprovalCheck<TInput = Record<string, unknown>> = (
  params: TInput,
  context: Record<string, unknown>,
) => boolean | Promise<boolean>;

/**
 * Tool with execute function (regular or generator).
 *
 * @template TInput - Zod schema type for tool input (use `unknown` without Zod)
 * @template TOutput - Zod schema type for tool output (use `unknown` without Zod)
 * @template TContext - The shape of the tool's contextSchema
 *
 * TODO: When Zod v4 is available, restore generic schema constraints:
 * TInput extends $ZodObject<$ZodShape>, TOutput extends $ZodType, etc.
 */
export type ToolWithExecute<
  TInput = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: ToolType.Function;
  function: {
    name: string;
    description?: string;
    /** Zod schema (or JSON Schema) for input validation */
    inputSchema: TInput;
    /** Zod schema for output validation (optional) */
    outputSchema?: TOutput;
    /** Zod schema for the tool's context */
    contextSchema?: unknown;
    nextTurnParams?: NextTurnParamsFunctions;
    requireApproval?: boolean | ToolApprovalCheck;
    execute: (
      params: unknown,
      context?: ToolExecuteContext<string, TContext>,
    ) => Promise<unknown> | unknown;
  };
};

/**
 * Tool with generator execute function.
 *
 * @template TInput - Zod schema type for tool input (use `unknown` without Zod)
 * @template TEvent - Zod schema type for yielded events (use `unknown` without Zod)
 * @template TOutput - Zod schema type for final output (use `unknown` without Zod)
 * @template TContext - The shape of the tool's contextSchema
 *
 * TODO: When Zod v4 is available, restore generic schema constraints.
 */
export type ToolWithGenerator<
  TInput = unknown,
  TEvent = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: ToolType.Function;
  function: {
    name: string;
    description?: string;
    inputSchema: TInput;
    /** Zod schema for validating yielded events */
    eventSchema: TEvent;
    /** Zod schema for validating the final output */
    outputSchema: TOutput;
    contextSchema?: unknown;
    nextTurnParams?: NextTurnParamsFunctions;
    requireApproval?: boolean | ToolApprovalCheck;
    execute: (
      params: unknown,
      context?: ToolExecuteContext<string, TContext>,
    ) => AsyncGenerator<unknown>;
  };
};

/**
 * Tool without execute function (manual handling by developer).
 *
 * @template TInput - Zod schema type for tool input (use `unknown` without Zod)
 *
 * TODO: When Zod v4 is available, restore generic schema constraints.
 */
export type ManualTool<TInput = unknown> = {
  type: ToolType.Function;
  function: {
    name: string;
    description?: string;
    inputSchema: TInput;
    outputSchema?: unknown;
    contextSchema?: unknown;
    nextTurnParams?: NextTurnParamsFunctions;
    requireApproval?: boolean | ToolApprovalCheck;
    // No execute property for manual tools
  };
};

/**
 * Union type of all enhanced tool types.
 */
export type Tool =
  | ToolWithExecute
  | ToolWithGenerator
  | ManualTool;

// ---------------------------------------------------------------------------
// Config Types
// ---------------------------------------------------------------------------

/**
 * Configuration for a regular tool with outputSchema.
 *
 * @template TInput - Zod schema type for input (use `unknown` without Zod)
 * @template TOutput - Zod schema type for output (use `unknown` without Zod)
 * @template TContext - The shape of the tool's contextSchema
 * @template TName - The tool's literal name string
 *
 * TODO: When Zod v4 is available, replace `unknown` with `$ZodObject<$ZodShape>`
 * and `$ZodType` for full type inference.
 */
type RegularToolConfigWithOutput<
  TInput = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> = {
  name: TName;
  description?: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  eventSchema?: undefined;
  /** Zod schema declaring the context data this tool needs */
  contextSchema?: unknown;
  nextTurnParams?: NextTurnParamsFunctions;
  requireApproval?: boolean | ToolApprovalCheck;
  execute: (
    params: unknown,
    context?: ToolExecuteContext<TName, TContext>,
  ) => Promise<unknown> | unknown;
};

/**
 * Configuration for a regular tool without outputSchema (infers return type from execute).
 *
 * @template TInput - Zod schema type for input (use `unknown` without Zod)
 * @template TReturn - The return type of the execute function
 * @template TContext - The shape of the tool's contextSchema
 * @template TName - The tool's literal name string
 *
 * TODO: When Zod v4 is available, replace `unknown` with `$ZodObject<$ZodShape>`.
 */
type RegularToolConfigWithoutOutput<
  TInput = unknown,
  TReturn = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> = {
  name: TName;
  description?: string;
  inputSchema: TInput;
  outputSchema?: undefined;
  eventSchema?: undefined;
  /** Zod schema declaring the context data this tool needs */
  contextSchema?: unknown;
  nextTurnParams?: NextTurnParamsFunctions;
  requireApproval?: boolean | ToolApprovalCheck;
  execute: (
    params: unknown,
    context?: ToolExecuteContext<TName, TContext>,
  ) => Promise<TReturn> | TReturn;
};

/**
 * Configuration for a generator tool (with eventSchema).
 *
 * @template TInput - Zod schema type for input (use `unknown` without Zod)
 * @template TEvent - Zod schema type for events (use `unknown` without Zod)
 * @template TOutput - Zod schema type for output (use `unknown` without Zod)
 * @template TContext - The shape of the tool's contextSchema
 * @template TName - The tool's literal name string
 *
 * TODO: When Zod v4 is available, replace `unknown` with `$ZodObject<$ZodShape>`
 * and `$ZodType` for full type inference.
 */
type GeneratorToolConfig<
  TInput = unknown,
  TEvent = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> = {
  name: TName;
  description?: string;
  inputSchema: TInput;
  eventSchema: TEvent;
  outputSchema: TOutput;
  /** Zod schema declaring the context data this tool needs */
  contextSchema?: unknown;
  nextTurnParams?: NextTurnParamsFunctions;
  requireApproval?: boolean | ToolApprovalCheck;
  execute: (
    params: unknown,
    context?: ToolExecuteContext<TName, TContext>,
  ) => AsyncGenerator<unknown>;
};

/**
 * Configuration for a manual tool (execute: false, no eventSchema or outputSchema).
 *
 * @template TInput - Zod schema type for input (use `unknown` without Zod)
 *
 * TODO: When Zod v4 is available, replace `unknown` with `$ZodObject<$ZodShape>`.
 */
type ManualToolConfig<TInput = unknown> = {
  name: string; // Manual tools don't use TName since they have no execute
  description?: string;
  inputSchema: TInput;
  /** Zod schema declaring the context data this tool needs */
  contextSchema?: unknown;
  nextTurnParams?: NextTurnParamsFunctions;
  requireApproval?: boolean | ToolApprovalCheck;
  execute: false;
};

/**
 * Loose config type for the `tool<TShared>()` overload.
 * Accepts any valid tool config while typing `ctx.shared` from TShared.
 *
 * @template TShared - The shape of the shared context
 */
type ToolConfigWithSharedContext<TShared extends Record<string, unknown>> = {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  eventSchema?: unknown;
  contextSchema?: unknown;
  nextTurnParams?: NextTurnParamsFunctions<Record<string, unknown>>;
  requireApproval?: boolean | ToolApprovalCheck<Record<string, unknown>>;
  execute:
    | ((
        params: Record<string, unknown>,
        context?: ToolExecuteContext<string, Record<string, unknown>, TShared>,
      ) => unknown)
    | ((
        params: Record<string, unknown>,
        context?: ToolExecuteContext<string, Record<string, unknown>, TShared>,
      ) => AsyncGenerator<unknown>)
    | false;
};

// ---------------------------------------------------------------------------
// Union Config Type
// ---------------------------------------------------------------------------

/**
 * Union type for all regular tool configs.
 */
type RegularToolConfig<
  TInput = unknown,
  TOutput = unknown,
  TReturn = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
> =
  | RegularToolConfigWithOutput<TInput, TOutput, TContext, TName>
  | RegularToolConfigWithoutOutput<TInput, TReturn, TContext, TName>;

// ---------------------------------------------------------------------------
// tool() Factory
// ---------------------------------------------------------------------------

/**
 * Creates a tool with type inference from schemas.
 *
 * The tool type is automatically determined based on the configuration:
 * - **Generator tool**: When `eventSchema` is provided
 * - **Regular tool**: When `execute` is a function (no `eventSchema`)
 * - **Manual tool**: When `execute: false` is set
 *
 * Shared context typing: Pass a type parameter to type `ctx.shared`
 * in the execute callback. Runtime validation happens at callModel
 * via `sharedContextSchema`.
 *
 * @example Regular tool:
 * ```typescript
 * const execTool = tool({
 *   name: "sandbox_exec",
 *   inputSchema: z.object({ command: z.string() }),
 *   execute: async (params, ctx) => {
 *     return { output: '...' };
 *   },
 * });
 * ```
 *
 * @example Generator tool:
 * ```typescript
 * const genTool = tool({
 *   name: "streaming_tool",
 *   inputSchema: z.object({ query: z.string() }),
 *   eventSchema: z.object({ status: z.string() }),
 *   outputSchema: z.object({ result: z.number() }),
 *   execute: async function* (params) {
 *     yield { status: "processing..." };
 *     yield { result: 42 };
 *   },
 * });
 * ```
 *
 * @example Manual tool:
 * ```typescript
 * const manualTool = tool({
 *   name: "human_review",
 *   inputSchema: z.object({ text: z.string() }),
 *   execute: false,
 * });
 * ```
 */
// Overload 1: Generator tool (when eventSchema is provided)
export function tool<
  TInput = unknown,
  TEvent = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
>(
  config: GeneratorToolConfig<TInput, TEvent, TOutput, TContext, TName>,
): ToolWithGenerator<TInput, TEvent, TOutput, TContext>;

// Overload 2: Manual tool (execute: false)
export function tool<TInput = unknown>(
  config: ManualToolConfig<TInput>,
): ManualTool<TInput>;

// Overload 3: Regular tool with outputSchema
export function tool<
  TInput = unknown,
  TOutput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
>(
  config: RegularToolConfigWithOutput<TInput, TOutput, TContext, TName>,
): ToolWithExecute<TInput, TOutput, TContext>;

// Overload 4: Regular tool without outputSchema (infers return type)
export function tool<
  TInput = unknown,
  TReturn = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TName extends string = string,
>(
  config: RegularToolConfigWithoutOutput<TInput, TReturn, TContext, TName>,
): ToolWithExecute<TInput, unknown, TContext>;

// Overload 5: Shared context overload (tool<SharedContext>({...}))
// When a non-Record type is provided as the first generic,
// the specific overloads above won't match (constraint mismatch),
// so TypeScript falls through to this catch-all.
export function tool<TShared extends Record<string, unknown>>(
  config: ToolConfigWithSharedContext<TShared>,
): Tool;

// Implementation
export function tool(
  config:
    | GeneratorToolConfig
    | RegularToolConfig
    | ManualToolConfig
    | ToolConfigWithSharedContext<Record<string, unknown>>,
): Tool {
  // 'shared' is reserved for shared context -- forbid it as a tool name
  if (config.name === SHARED_CONTEXT_KEY) {
    throw new Error(
      `Tool name "${SHARED_CONTEXT_KEY}" is reserved for shared context. Choose a different name.`,
    );
  }

  // Branch 1: Manual tool (execute === false)
  if (config.execute === false) {
    const fn: ManualTool['function'] = {
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
    } as ToolWithGenerator['function'];

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
    execute: (config as RegularToolConfigWithoutOutput).execute,
    ...(config.description !== undefined && { description: config.description }),
    ...((config as RegularToolConfigWithOutput).outputSchema !== undefined && {
      outputSchema: (config as RegularToolConfigWithOutput).outputSchema,
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
