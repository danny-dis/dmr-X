/**
 * ModelResult class -- the central user-facing orchestrator for DMR-X.
 *
 * Manages stream initialization and lifecycle, multi-turn tool execution loops
 * with parallel tool calling, approval gates, state persistence via
 * ConversationState, turn broadcasting via ToolEventBroadcaster, async parameter
 * resolution, cancellation, and a rich public API for consuming responses.
 *
 * Ported from OpenRouter SDK's model-result.ts with adaptations for DMR-X.
 */

import type { ParsedToolCall } from './stream-transformers.js';
import type { Tool } from './stop-conditions.js';
import type { TurnContext } from './tool-context.js';
import type { ConversationState, UnsentToolResult } from './conversation-state.js';

import { hasExecuteFunction } from './tool-types.js';

import { ToolEventBroadcaster } from './tool-event-broadcaster.js';
import { ToolContextStore, resolveContext } from './tool-context.js';
import type { ContextInput } from './tool-context.js';

import {
  appendToMessages,
  createInitialState,
  createRejectedResult,
  createUnsentResult,
  extractTextFromResponse as extractTextFromResponseState,
  partitionToolCalls,
  unsentResultsToAPIFormat,
  updateState,
} from './conversation-state.js';

import { ReusableReadableStream } from './reusable-stream.js';

import {
  buildItemsStream,
  buildResponsesMessageStream,
  buildToolCallStream,
  consumeStreamForCompletion,
  extractReasoningDeltas,
  extractResponsesMessageFromResponse,
  extractTextDeltas,
  extractTextFromResponse,
  extractToolCallsFromResponse,
  extractToolDeltas,
  itemsStreamHandlers,
  streamTerminationEvents,
} from './stream-transformers.js';
import type {
  ItemInProgress,
  StreamableOutputItem,
} from './stream-transformers.js';

import { executeTool } from './tool-executor.js';
import { executeNextTurnParamsFunctions, applyNextTurnParamsToRequest } from './next-turn-params.js';
import type { NextTurnRequest } from './next-turn-params.js';

import { isStopConditionMet, stepCountIs } from './stop-conditions.js';
import type { StopCondition } from './stop-conditions.js';

import {
  isFunctionCallItem,
  isResponseCompletedEvent,
  isResponseFailedEvent,
  isResponseIncompleteEvent,
  isOutputTextDeltaEvent,
  isReasoningDeltaEvent,
} from './stream-type-guards.js';
import type {
  OpenResponsesResult,
  OutputFunctionCallItem,
  OutputMessage,
  StreamEvents,
  OutputTextDeltaEvent,
  ReasoningDeltaEvent,
  FunctionCallOutputItem,
} from './stream-type-guards.js';

import { EventStream } from './event-stream.js';

// Re-use types from the existing async-params module where they match
import type {
  CallModelInput as AsyncCallModelInput,
  ToolContextMapWithShared,
} from './async-params.js';
import { hasAsyncFunctions, resolveAsyncFunctions } from './async-params.js';

/** Resolved (non-function) request fields. Matches the SDK's ResolvedCallModelInput. */
type ResolvedCallModelInput = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Stubbed / locally-defined types (replacing OpenRouter SDK-specific imports)
// ---------------------------------------------------------------------------

/**
 * Minimal API client interface.
 * Replaces the full OpenRouterCore class -- implementors just need to be
 * passable to betaResponsesSend.
 */
export interface ApiClient {
  /** Client-level metadata (base URL, headers, etc.) */
  readonly [key: string]: unknown;
}

/**
 * Request object sent to the Responses API.
 * Replaces models.ResponsesRequest from the OpenRouter SDK.
 */
export interface ResponsesRequest {
  input?: InputsUnion;
  model?: string;
  models?: string[];
  stream?: boolean;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  topP?: number | null;
  topK?: number;
  instructions?: string | null;
  previousResponseId?: string;
  [key: string]: unknown;
}

/**
 * Options for HTTP requests to the API.
 * Replaces RequestOptions from the OpenRouter SDK.
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  [key: string]: unknown;
}

/**
 * Result of a betaResponsesSend call.
 * Replaces the full Result type from the SDK.
 */
export type BetaResponsesResult =
  | { ok: true; value: EventStream<StreamEvents> | OpenResponsesResult }
  | { ok: false; error: Error };

/**
 * Function signature for sending a responses request.
 * This replaces the direct betaResponsesSend import.
 */
export type BetaResponsesSendFn = (
  client: ApiClient,
  params: { responsesRequest: ResponsesRequest },
  options?: RequestOptions,
) => Promise<BetaResponsesResult>;

/**
 * Accessor for persisting and loading conversation state.
 * Note: This uses load/save semantics (async) which differs from the
 * StateAccessor in async-params.ts (get/set, synchronous).
 * The model-result module needs async persistence for multi-turn conversations.
 */
export interface ModelStateAccessor<TTools extends readonly Tool[] = readonly Tool[]> {
  /** Load conversation state from persistence. Returns null if no state exists. */
  load(): Promise<ConversationState<TTools> | null>;
  /** Save conversation state to persistence. */
  save(state: ConversationState<TTools>): Promise<void>;
}

/**
 * Stop condition type -- a single predicate or array of predicates (OR logic).
 * Re-exported for convenience.
 */
export type StopWhen<TTools extends readonly Tool[] = readonly Tool[]> =
  | StopCondition<TTools>
  | ReadonlyArray<StopCondition<TTools>>;

/**
 * Union of all stream events across turns.
 * Simplified from the SDK's deeply generic version.
 */
export type ResponseStreamEvent<
  TEvent = unknown,
  TOutput = unknown,
> =
  | StreamEvents
  | TurnStartEvent
  | TurnEndEvent
  | ToolResultEvent<TOutput>
  | ToolPreliminaryResultEvent<TEvent>
  | ToolCallOutputEvent;

/** Event emitted at the start of a tool execution turn. */
export interface TurnStartEvent {
  type: 'turn.start';
  turnNumber: number;
  timestamp: number;
}

/** Event emitted at the end of a tool execution turn. */
export interface TurnEndEvent {
  type: 'turn.end';
  turnNumber: number;
  timestamp: number;
}

/** Event emitted when a tool produces a final result. */
export interface ToolResultEvent<TOutput = unknown> {
  type: 'tool.result';
  toolCallId: string;
  result: TOutput;
  timestamp: number;
  preliminaryResults?: unknown[];
}

/** Event emitted when a generator tool yields a preliminary result. */
export interface ToolPreliminaryResultEvent<TEvent = unknown> {
  type: 'tool.preliminary_result';
  toolCallId: string;
  result: TEvent;
  timestamp: number;
}

/** Event emitted for tool call outputs (function_call_output items). */
export interface ToolCallOutputEvent {
  type: 'tool.call_output';
  output: FunctionCallOutputItem;
  timestamp: number;
}

/**
 * Events yielded by getToolStream().
 */
export type ToolStreamEvent<TEvent = unknown> =
  | { type: 'delta'; content: string }
  | { type: 'preliminary_result'; toolCallId: string; result: TEvent };

// ---------------------------------------------------------------------------
// Input types (replacing models.InputsUnion / models.BaseInputsUnion)
// ---------------------------------------------------------------------------

/** A single input item (message or output). */
export type BaseInputsUnion = Record<string, unknown>;

/** Input can be a single item or an array of items. */
export type InputsUnion = BaseInputsUnion | BaseInputsUnion[];

// ---------------------------------------------------------------------------
// Zod stubs (TODO: replace with actual Zod types when Zod is a dependency)
// ---------------------------------------------------------------------------

/** @todo Replace with zod's $ZodObject when Zod v4 is added as a dependency. */
type ZodObjectStub = unknown;

/** @todo Replace with zod's $ZodShape when Zod v4 is added as a dependency. */
type ZodShapeStub = unknown;

// ---------------------------------------------------------------------------
// Local type guard (replaces hasTypeProperty from SDK's stream-type-guards)
// ---------------------------------------------------------------------------

/** Check if a value has a `type` property (string). */
function hasTypeProperty(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && 'type' in value &&
    typeof (value as { type: unknown }).type === 'string';
}

// ---------------------------------------------------------------------------
// Local isToolCallOutputEvent (replaces import from tool-types.js in SDK)
// ---------------------------------------------------------------------------

/** Type guard: check if a stream event is a tool.call_output event. */
function isToolCallOutputEvent(
  event: unknown,
): event is ToolCallOutputEvent {
  return hasTypeProperty(event) && event.type === 'tool.call_output';
}

// ---------------------------------------------------------------------------
// isEventStream helper (replaces the one from the SDK)
// ---------------------------------------------------------------------------

/** Type guard: check if a value is an EventStream (has a toReadableStream-like interface). */
function isEventStream(value: unknown): value is EventStream<StreamEvents> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  // Check constructor name for EventStream
  const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
  if (constructorName === 'EventStream') {
    return true;
  }
  // Fallback: check for pipeTo / getReader (ReadableStream methods)
  const maybeStream = value as { getReader?: unknown };
  return typeof maybeStream.getReader === 'function';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default maximum number of tool execution steps if no stopWhen is specified.
 * This prevents infinite loops in tool execution.
 */
const DEFAULT_MAX_STEPS = 5;

// ---------------------------------------------------------------------------
// GetResponseOptions
// ---------------------------------------------------------------------------

export interface GetResponseOptions<
  TTools extends readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> {
  /** Request with orchestration options (can have async functions). */
  request: AsyncCallModelInput<TTools, TShared>;
  /** The API client instance. */
  client: ApiClient;
  /** HTTP request options (headers, signal, timeout). */
  options?: RequestOptions;
  /** Tool definitions. */
  tools?: TTools;
  /** Stop condition(s) for the agentic loop. */
  stopWhen?: StopWhen<TTools>;
  /** State management for multi-turn conversations (async load/save). */
  state?: ModelStateAccessor<TTools>;
  /** Typed context data passed to tools via contextSchema. `shared` key for shared context. */
  context?: ContextInput<ToolContextMapWithShared<TTools, TShared>>;
  /** Zod schema for shared context validation. @todo Replace with $ZodObject when Zod is available. */
  sharedContextSchema?: ZodObjectStub;

  /**
   * Call-level approval check - overrides tool-level requireApproval setting.
   * Receives the tool call and turn context, can be sync or async.
   */
  requireApproval?: (
    toolCall: ParsedToolCall,
    context: TurnContext,
  ) => boolean | Promise<boolean>;
  /** Tool call IDs to auto-approve on resume. */
  approveToolCalls?: string[];
  /** Tool call IDs to auto-reject on resume. */
  rejectToolCalls?: string[];

  /** Callback invoked at the start of each tool execution turn. */
  onTurnStart?: (context: TurnContext) => void | Promise<void>;
  /** Callback invoked at the end of each tool execution turn. */
  onTurnEnd?: (context: TurnContext, response: OpenResponsesResult) => void | Promise<void>;

  /**
   * The function to send a responses request to the API.
   * This replaces the direct betaResponsesSend import.
   * Defaults to a no-op that throws -- callers MUST provide this.
   */
  betaResponsesSend?: BetaResponsesSendFn;
}

// ---------------------------------------------------------------------------
// ModelResult
// ---------------------------------------------------------------------------

/**
 * A wrapper around a streaming response that provides multiple consumption patterns.
 *
 * Allows consuming the response in multiple ways:
 * - `await result.getText()` - Get just the text
 * - `await result.getResponse()` - Get the full response object
 * - `for await (const delta of result.getTextStream())` - Stream text deltas
 * - `for await (const item of result.getItemsStream())` - Stream all output items
 * - `for await (const event of result.getFullResponsesStream())` - Stream all response events
 *
 * All consumption patterns can be used concurrently thanks to the underlying
 * ReusableReadableStream implementation.
 *
 * @template TTools - The tools array type to enable typed tool calls and results
 * @template TShared - The shape of the shared context (inferred from sharedContextSchema)
 */
export class ModelResult<
  TTools extends readonly Tool[],
  TShared extends Record<string, unknown> = Record<string, never>,
> {
  private reusableStream: ReusableReadableStream<StreamEvents> | null = null;
  private textPromise: Promise<string> | null = null;
  private options: GetResponseOptions<TTools, TShared>;
  private initPromise: Promise<void> | null = null;
  private toolExecutionPromise: Promise<void> | null = null;
  private finalResponse: OpenResponsesResult | null = null;
  private toolEventBroadcaster: ToolEventBroadcaster<
    | {
        type: 'preliminary_result';
        toolCallId: string;
        result: unknown;
      }
    | {
        type: 'tool_result';
        toolCallId: string;
        result: unknown;
        preliminaryResults?: unknown[];
      }
  > | null = null;
  private allToolExecutionRounds: Array<{
    round: number;
    toolCalls: ParsedToolCall[];
    response: OpenResponsesResult;
    toolResults: Array<FunctionCallOutputItem>;
  }> = [];
  // Track resolved request after async function resolution
  private resolvedRequest: ResponsesRequest | null = null;

  // State management for multi-turn conversations
  private stateAccessor: ModelStateAccessor<TTools> | null = null;
  private currentState: ConversationState<TTools> | null = null;
  private requireApprovalFn: ((toolCall: ParsedToolCall, context: TurnContext) => boolean | Promise<boolean>) | null = null;
  private approvedToolCalls: string[] = [];
  private rejectedToolCalls: string[] = [];
  private isResumingFromApproval = false;

  // Unified turn broadcaster for multi-turn streaming
  private turnBroadcaster: ToolEventBroadcaster<ResponseStreamEvent> | null = null;
  private initialStreamPipeStarted = false;
  private initialPipePromise: Promise<void> | null = null;

  // Context store for typed tool context (persists across turns)
  private contextStore: ToolContextStore | null = null;

  // Resolved betaResponsesSend function
  private sendFn: BetaResponsesSendFn;

  constructor(options: GetResponseOptions<TTools, TShared>) {
    this.options = options;

    // Resolve the send function
    this.sendFn = options.betaResponsesSend ?? (() => {
      throw new Error(
        'betaResponsesSend not provided. Pass a betaResponsesSend function in GetResponseOptions.',
      );
    });

    // Runtime validation: approval decisions require state
    const hasApprovalDecisions =
      (options.approveToolCalls && options.approveToolCalls.length > 0) ||
      (options.rejectToolCalls && options.rejectToolCalls.length > 0);

    if (hasApprovalDecisions && !options.state) {
      throw new Error(
        'approveToolCalls and rejectToolCalls require a state accessor. ' +
        'Provide a StateAccessor via the "state" parameter to persist approval decisions.',
      );
    }

    // Initialize state management
    this.stateAccessor = options.state ?? null;
    this.requireApprovalFn = options.requireApproval ?? null;
    this.approvedToolCalls = options.approveToolCalls ?? [];
    this.rejectedToolCalls = options.rejectToolCalls ?? [];
  }

  // =========================================================================
  // Turn broadcaster helpers
  // =========================================================================

  /**
   * Get or create the unified turn broadcaster (lazy initialization).
   * Broadcasts all API stream events, tool events, and turn delimiters across turns.
   */
  private ensureTurnBroadcaster(): ToolEventBroadcaster<ResponseStreamEvent> {
    if (!this.turnBroadcaster) {
      this.turnBroadcaster = new ToolEventBroadcaster();
    }
    return this.turnBroadcaster;
  }

  /**
   * Start piping the initial stream into the turn broadcaster.
   * Idempotent -- only starts once even if called multiple times.
   * Wraps the initial stream events with turn.start(0) / turn.end(0) delimiters.
   */
  private startInitialStreamPipe(): void {
    if (this.initialStreamPipeStarted) return;
    this.initialStreamPipeStarted = true;

    const broadcaster = this.ensureTurnBroadcaster();

    if (!this.reusableStream) {
      return;
    }

    const stream = this.reusableStream;

    this.initialPipePromise = (async () => {
      broadcaster.push({
        type: 'turn.start',
        turnNumber: 0,
        timestamp: Date.now(),
      } satisfies TurnStartEvent);

      const consumer = stream.createConsumer();
      for await (const event of consumer) {
        broadcaster.push(event);
      }

      broadcaster.push({
        type: 'turn.end',
        turnNumber: 0,
        timestamp: Date.now(),
      } satisfies TurnEndEvent);
    })().catch((error) => {
      broadcaster.complete(error instanceof Error ? error : new Error(String(error)));
    });
  }

  /**
   * Pipe a follow-up stream into the turn broadcaster and capture the completed response.
   * Emits turn.start / turn.end delimiters around the stream events.
   */
  private async pipeAndConsumeStream(
    stream: ReusableReadableStream<StreamEvents>,
    turnNumber: number,
  ): Promise<OpenResponsesResult> {
    const broadcaster = this.turnBroadcaster!;

    broadcaster.push({
      type: 'turn.start',
      turnNumber,
      timestamp: Date.now(),
    } satisfies TurnStartEvent);

    const consumer = stream.createConsumer();
    let completedResponse: OpenResponsesResult | null = null;

    for await (const event of consumer) {
      broadcaster.push(event);
      if (isResponseCompletedEvent(event)) {
        completedResponse = event.response;
      }
      if (isResponseFailedEvent(event)) {
        const errorMsg = 'message' in event ? String(event.message) : 'Response failed';
        throw new Error(errorMsg);
      }
      if (isResponseIncompleteEvent(event)) {
        completedResponse = event.response;
      }
    }

    broadcaster.push({
      type: 'turn.end',
      turnNumber,
      timestamp: Date.now(),
    } satisfies TurnEndEvent);

    if (!completedResponse) {
      throw new Error('Follow-up stream ended without a completed response');
    }

    return completedResponse;
  }

  /**
   * Push a tool result event to both the legacy tool event broadcaster
   * and the unified turn broadcaster.
   */
  private broadcastToolResult(
    toolCallId: string,
    result: unknown,
    preliminaryResults?: unknown[],
  ): void {
    this.toolEventBroadcaster?.push({
      type: 'tool_result' as const,
      toolCallId,
      result,
      ...(preliminaryResults?.length && { preliminaryResults }),
    });
    this.turnBroadcaster?.push({
      type: 'tool.result' as const,
      toolCallId,
      result,
      timestamp: Date.now(),
      ...(preliminaryResults?.length && { preliminaryResults }),
    } as ToolResultEvent);
  }

  /**
   * Push a preliminary result event to both the legacy tool event broadcaster
   * and the unified turn broadcaster.
   */
  private broadcastPreliminaryResult(
    toolCallId: string,
    result: unknown,
  ): void {
    this.toolEventBroadcaster?.push({
      type: 'preliminary_result' as const,
      toolCallId,
      result,
    });
    this.turnBroadcaster?.push({
      type: 'tool.preliminary_result' as const,
      toolCallId,
      result,
      timestamp: Date.now(),
    } as ToolPreliminaryResultEvent);
  }

  /**
   * Set up the turn broadcaster with tool execution and return the consumer.
   * Used by stream methods that need to iterate over all turns.
   */
  private startTurnBroadcasterExecution(): {
    consumer: AsyncIterableIterator<ResponseStreamEvent>;
    executionPromise: Promise<void>;
  } {
    const broadcaster = this.ensureTurnBroadcaster();
    this.startInitialStreamPipe();
    const consumer = broadcaster.createConsumer();
    const executionPromise = this.executeToolsIfNeeded().finally(async () => {
      // Wait for the initial stream pipe to finish pushing all events
      if (this.initialPipePromise) {
        await this.initialPipePromise;
      }
      broadcaster.complete();
    });
    return { consumer, executionPromise };
  }

  // =========================================================================
  // Non-streaming response type guard
  // =========================================================================

  /**
   * Type guard to check if a value is a non-streaming response.
   */
  private isNonStreamingResponse(value: unknown): value is OpenResponsesResult {
    return (
      value !== null &&
      typeof value === 'object' &&
      'output' in value &&
      !('getReader' in value)
    );
  }

  // =========================================================================
  // Helper Methods for executeToolsIfNeeded
  // =========================================================================

  /**
   * Get initial response from stream or cached final response.
   */
  private async getInitialResponse(): Promise<OpenResponsesResult> {
    if (this.finalResponse) {
      return this.finalResponse;
    }
    if (this.reusableStream) {
      return consumeStreamForCompletion(this.reusableStream);
    }
    throw new Error('Neither stream nor response initialized');
  }

  /**
   * Save response output to state.
   */
  private async saveResponseToState(response: OpenResponsesResult): Promise<void> {
    if (!this.stateAccessor || !this.currentState) return;

    const outputItems = Array.isArray(response.output)
      ? response.output
      : [response.output];

    await this.saveStateSafely({
      messages: appendToMessages(
        this.currentState.messages,
        outputItems as unknown as BaseInputsUnion[],
      ),
      previousResponseId: response.id,
    } as Partial<ConversationState<TTools>>);
  }

  /**
   * Mark state as complete.
   */
  private async markStateComplete(): Promise<void> {
    await this.saveStateSafely({ status: 'completed' } as Partial<ConversationState<TTools>>);
  }

  /**
   * Save tool results to state.
   */
  private async saveToolResultsToState(toolResults: FunctionCallOutputItem[]): Promise<void> {
    if (!this.currentState) return;
    await this.saveStateSafely({
      messages: appendToMessages(this.currentState.messages as unknown as InputsUnion, toolResults as unknown as BaseInputsUnion[]),
    } as Partial<ConversationState<TTools>>);
  }

  /**
   * Check if execution should be interrupted by external signal.
   */
  private async checkForInterruption(
    currentResponse: OpenResponsesResult,
  ): Promise<boolean> {
    if (!this.stateAccessor) return false;

    const freshState = await this.stateAccessor.load();
    if (!freshState?.interruptedBy) return false;

    // Save partial state
    if (this.currentState) {
      const currentToolCalls = extractToolCallsFromResponse(currentResponse);
      await this.saveStateSafely({
        status: 'interrupted',
        partialResponse: {
          text: extractTextFromResponseState(currentResponse),
          toolCalls: currentToolCalls as ParsedToolCall[],
        },
      } as Partial<ConversationState<TTools>>);
    }

    this.finalResponse = currentResponse;
    return true;
  }

  /**
   * Check if stop conditions are met.
   */
  private async shouldStopExecution(): Promise<boolean> {
    const stopWhen = this.options.stopWhen ?? stepCountIs(DEFAULT_MAX_STEPS);

    const stopConditions = Array.isArray(stopWhen)
      ? stopWhen
      : [stopWhen];

    return isStopConditionMet({
      stopConditions,
      steps: this.allToolExecutionRounds.map((round) => ({
        stepType: 'continue' as const,
        text: extractTextFromResponse(round.response),
        toolCalls: round.toolCalls,
        toolResults: round.toolResults.map((tr) => ({
          toolCallId: tr.callId,
          toolName: round.toolCalls.find((tc) => tc.id === tr.callId)?.name ?? '',
          result: typeof tr.output === 'string' ? JSON.parse(tr.output) : tr.output,
        })),
        response: round.response,
        usage: round.response.usage ? {
          totalTokens: (round.response.usage.inputTokens ?? 0) + (round.response.usage.outputTokens ?? 0),
        } : undefined,
        finishReason: undefined,
      })),
    });
  }

  /**
   * Check if any tool calls have execute functions.
   */
  private hasExecutableToolCalls(toolCalls: ParsedToolCall[]): boolean {
    return toolCalls.some((toolCall) => {
      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      return tool && hasExecuteFunction(tool);
    });
  }

  /**
   * Execute tools that can auto-execute (don't require approval) in parallel.
   */
  private async executeAutoApproveTools(
    toolCalls: ParsedToolCall[],
    turnContext: TurnContext,
  ): Promise<UnsentToolResult[]> {
    const toolCallPromises = toolCalls.map(async (tc) => {
      const tool = this.options.tools?.find((t) => t.function.name === tc.name);
      if (!tool || !hasExecuteFunction(tool)) {
        return null;
      }

      const result = await executeTool(
        tool,
        tc as ParsedToolCall,
        turnContext,
        undefined,
        this.contextStore ?? undefined,
      );

      if (result.error) {
        return createRejectedResult(tc.id, String(tc.name), result.error.message);
      }
      return createUnsentResult(tc.id, String(tc.name), result.result);
    });

    const settledResults = await Promise.allSettled(toolCallPromises);

    const results: UnsentToolResult[] = [];
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const tc = toolCalls[i];
      if (!settled || !tc) continue;

      if (settled.status === 'rejected') {
        const errorMessage = settled.reason instanceof Error
          ? settled.reason.message
          : String(settled.reason);
        results.push(createRejectedResult(tc.id, String(tc.name), errorMessage));
        continue;
      }

      if (settled.value) {
        results.push(settled.value);
      }
    }

    return results;
  }

  /**
   * Check for tools requiring approval and handle accordingly.
   */
  private async handleApprovalCheck(
    toolCalls: ParsedToolCall[],
    currentRound: number,
    currentResponse: OpenResponsesResult,
  ): Promise<boolean> {
    if (!this.options.tools) return false;

    const turnContext: TurnContext = {
      numberOfTurns: currentRound,
    };

    const { requiresApproval: needsApproval, autoExecute } = await partitionToolCalls(
      toolCalls as ParsedToolCall[],
      this.options.tools,
      turnContext,
      this.requireApprovalFn ?? undefined,
    );

    if (needsApproval.length === 0) return false;

    // Validate: approval requires state accessor
    if (!this.stateAccessor) {
      const toolNames = needsApproval.map((tc) => tc.name).join(', ');
      throw new Error(
        `Tool(s) require approval but no state accessor is configured: ${toolNames}. ` +
        'Provide a StateAccessor via the "state" parameter to enable approval workflows.',
      );
    }

    // Execute auto-approve tools
    const unsentResults = await this.executeAutoApproveTools(autoExecute, turnContext);

    // Save state with pending approvals
    const stateUpdates: Partial<ConversationState<TTools>> = {
      pendingToolCalls: needsApproval,
      status: 'awaiting_approval',
    } as Partial<ConversationState<TTools>>;
    if (unsentResults.length > 0) {
      (stateUpdates as Record<string, unknown>).unsentToolResults = unsentResults;
    }
    await this.saveStateSafely(stateUpdates);

    this.finalResponse = currentResponse;
    return true; // Pause for approval
  }

  /**
   * Execute all tools in a single round in parallel.
   */
  private async executeToolRound(
    toolCalls: ParsedToolCall[],
    turnContext: TurnContext,
  ): Promise<FunctionCallOutputItem[]> {
    const toolCallPromises = toolCalls.map(async (toolCall) => {
      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      if (!tool || !hasExecuteFunction(tool)) {
        return null;
      }

      // Check if arguments failed to parse (remained as string instead of object)
      const args: unknown = toolCall.arguments;
      if (typeof args === 'string') {
        const rawArgs = args;
        const errorMessage = `Failed to parse tool call arguments for "${toolCall.name}": The model provided invalid JSON. ` +
          `Raw arguments received: "${rawArgs}". ` +
          `Please provide valid JSON arguments for this tool call.`;

        this.broadcastToolResult(toolCall.id, { error: errorMessage });

        return {
          type: 'parse_error' as const,
          toolCall,
          output: {
            type: 'function_call_output' as const,
            id: `output_${toolCall.id}`,
            callId: toolCall.id,
            output: JSON.stringify({ error: errorMessage }),
          } as FunctionCallOutputItem,
        };
      }

      const preliminaryResultsForCall: unknown[] = [];

      const hasBroadcaster = this.toolEventBroadcaster || this.turnBroadcaster;
      const onPreliminaryResult = hasBroadcaster
        ? (callId: string, resultValue: unknown) => {
            preliminaryResultsForCall.push(resultValue);
            this.broadcastPreliminaryResult(callId, resultValue);
          }
        : undefined;

      const result = await executeTool(
        tool,
        toolCall,
        turnContext,
        onPreliminaryResult,
        this.contextStore ?? undefined,
      );

      return {
        type: 'execution' as const,
        toolCall,
        tool,
        result,
        preliminaryResultsForCall,
      };
    });

    const settledResults = await Promise.allSettled(toolCallPromises);
    const toolResults: FunctionCallOutputItem[] = [];

    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const originalToolCall = toolCalls[i];
      if (!settled || !originalToolCall) continue;

      if (settled.status === 'rejected') {
        const errorMessage = settled.reason instanceof Error
          ? settled.reason.message
          : String(settled.reason);

        this.broadcastToolResult(originalToolCall.id, { error: errorMessage });

        const rejectedOutput: FunctionCallOutputItem = {
          type: 'function_call_output' as const,
          id: `output_${originalToolCall.id}`,
          callId: originalToolCall.id,
          output: JSON.stringify({ error: errorMessage }),
        };
        toolResults.push(rejectedOutput);
        this.turnBroadcaster?.push({
          type: 'tool.call_output' as const,
          output: rejectedOutput,
          timestamp: Date.now(),
        } satisfies ToolCallOutputEvent);
        continue;
      }

      const value = settled.value;
      if (!value) continue;

      if (value.type === 'parse_error') {
        toolResults.push(value.output);
        this.turnBroadcaster?.push({
          type: 'tool.call_output' as const,
          output: value.output,
          timestamp: Date.now(),
        } satisfies ToolCallOutputEvent);
        continue;
      }

      const toolResult = value.result.error
        ? { error: value.result.error.message }
        : value.result.result;
      this.broadcastToolResult(
        value.toolCall.id,
        toolResult,
        value.preliminaryResultsForCall.length > 0 ? value.preliminaryResultsForCall : undefined,
      );

      const executedOutput: FunctionCallOutputItem = {
        type: 'function_call_output' as const,
        id: `output_${value.toolCall.id}`,
        callId: value.toolCall.id,
        output: value.result.error
          ? JSON.stringify({ error: value.result.error.message })
          : JSON.stringify(value.result.result),
      };
      toolResults.push(executedOutput);
      this.turnBroadcaster?.push({
        type: 'tool.call_output' as const,
        output: executedOutput,
        timestamp: Date.now(),
      } satisfies ToolCallOutputEvent);
    }

    return toolResults;
  }

  /**
   * Resolve async functions for the current turn.
   */
  private async resolveAsyncFunctionsForTurn(turnContext: TurnContext): Promise<void> {
    if (hasAsyncFunctions(this.options.request as unknown as Record<string, unknown>)) {
      const resolved = await resolveAsyncFunctions(
        this.options.request as unknown as Record<string, unknown>,
        turnContext,
      );
      // Preserve accumulated input from previous turns
      const preservedInput = this.resolvedRequest?.input;
      const preservedStream = this.resolvedRequest?.stream;
      this.resolvedRequest = {
        ...resolved,
        stream: preservedStream ?? true,
        ...(preservedInput !== undefined && { input: preservedInput }),
      } as ResponsesRequest;
    }
  }

  /**
   * Apply nextTurnParams from executed tools.
   */
  private async applyNextTurnParams(toolCalls: ParsedToolCall[]): Promise<void> {
    if (!this.options.tools || toolCalls.length === 0 || !this.resolvedRequest) {
      return;
    }

    const computedParams = await executeNextTurnParamsFunctions(
      toolCalls,
      this.options.tools as unknown as import('./next-turn-params.js').ToolDefinition[],
      this.resolvedRequest as unknown as NextTurnRequest,
    );

    if (Object.keys(computedParams).length > 0) {
      this.resolvedRequest = applyNextTurnParamsToRequest(
        this.resolvedRequest as unknown as NextTurnRequest,
        computedParams,
      ) as unknown as ResponsesRequest;
    }
  }

  /**
   * Make a follow-up API request with tool results.
   */
  private async makeFollowupRequest(
    currentResponse: OpenResponsesResult,
    toolResults: FunctionCallOutputItem[],
    turnNumber: number,
  ): Promise<OpenResponsesResult> {
    const originalInput = this.resolvedRequest?.input;
    const normalizedOriginalInput: BaseInputsUnion[] =
      Array.isArray(originalInput)
        ? originalInput
        : originalInput
          ? [{ role: 'user', content: originalInput }]
          : [];

    const outputAsInput: BaseInputsUnion[] = (Array.isArray(currentResponse.output)
      ? currentResponse.output
      : [currentResponse.output]) as unknown as BaseInputsUnion[];
    const newInput: InputsUnion = [
      ...normalizedOriginalInput,
      ...outputAsInput,
      ...(toolResults as unknown as BaseInputsUnion[]),
    ];

    if (!this.resolvedRequest) {
      throw new Error('Request not initialized');
    }

    // Update resolvedRequest.input with accumulated conversation for next turn
    this.resolvedRequest = {
      ...this.resolvedRequest,
      input: newInput,
    };

    const newRequest: ResponsesRequest = {
      ...this.resolvedRequest,
      stream: true,
    };

    const newResult = await this.sendFn(
      this.options.client,
      { responsesRequest: newRequest },
      this.options.options,
    );

    if (!newResult.ok) {
      throw newResult.error;
    }

    // Handle streaming or non-streaming response
    const value = newResult.value;
    if (isEventStream(value)) {
      const followUpStream = new ReusableReadableStream(value);

      if (this.turnBroadcaster) {
        return this.pipeAndConsumeStream(followUpStream, turnNumber);
      }

      return consumeStreamForCompletion(followUpStream);
    } else if (this.isNonStreamingResponse(value)) {
      return value;
    } else {
      throw new Error('Unexpected response type from API');
    }
  }

  /**
   * Validate the final response has required fields.
   */
  private validateFinalResponse(response: OpenResponsesResult): void {
    if (!response?.id || !response?.output) {
      throw new Error('Invalid final response: missing required fields');
    }
    if (!Array.isArray(response.output) || response.output.length === 0) {
      throw new Error('Invalid final response: empty or invalid output');
    }
  }

  /**
   * Resolve async functions in the request for a given turn context.
   */
  private async resolveRequestForContext(context: TurnContext): Promise<ResolvedCallModelInput> {
    if (hasAsyncFunctions(this.options.request as unknown as Record<string, unknown>)) {
      return resolveAsyncFunctions(
        this.options.request as unknown as Record<string, unknown>,
        context,
      );
    }
    // Already resolved, extract non-function fields
    const {
      stopWhen: _,
      state: _s,
      requireApproval: _r,
      approveToolCalls: _a,
      rejectToolCalls: _rj,
      context: _c,
      betaResponsesSend: _brs,
      onTurnStart: _ots,
      onTurnEnd: _ote,
      ...rest
    } = this.options.request;
    return rest as ResolvedCallModelInput;
  }

  /**
   * Safely persist state with error handling.
   */
  private async saveStateSafely(
    updates?: Partial<ConversationState<TTools>>,
  ): Promise<void> {
    if (!this.stateAccessor || !this.currentState) return;

    if (updates) {
      this.currentState = updateState(this.currentState, updates);
    }

    try {
      await this.stateAccessor.save(this.currentState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to persist conversation state: ${message}`);
    }
  }

  /**
   * Remove optional properties from state when they should be cleared.
   */
  private clearOptionalStateProperties(
    props: Array<'pendingToolCalls' | 'unsentToolResults' | 'interruptedBy' | 'partialResponse'>,
  ): void {
    if (!this.currentState) return;
    for (const prop of props) {
      delete (this.currentState as unknown as Record<string, unknown>)[prop];
    }
  }

  // =========================================================================
  // Core Methods
  // =========================================================================

  /**
   * Initialize the stream if not already started.
   * This is idempotent - multiple calls will return the same promise.
   */
  private initStream(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      // Load or create state if accessor provided
      if (this.stateAccessor) {
        const loadedState = await this.stateAccessor.load();
        if (loadedState) {
          this.currentState = loadedState;

          // Check if we're resuming from awaiting_approval with decisions
          if (loadedState.status === 'awaiting_approval' &&
              (this.approvedToolCalls.length > 0 || this.rejectedToolCalls.length > 0)) {
            // Initialize context store before resuming so tools have access
            if (this.options.context !== undefined) {
              const approvalContext: TurnContext = { numberOfTurns: 0 };
              const resolvedCtx = await resolveContext(this.options.context, approvalContext);
              this.contextStore = new ToolContextStore(resolvedCtx);
            }

            this.isResumingFromApproval = true;
            await this.processApprovalDecisions();
            return; // Skip normal initialization, we're resuming
          }

          // Check for interruption flag and handle
          if (loadedState.interruptedBy) {
            // Clear interruption flag and continue from saved state
            this.currentState = updateState(loadedState, { status: 'in_progress' } as Partial<ConversationState<TTools>>);
            this.clearOptionalStateProperties(['interruptedBy']);
            await this.saveStateSafely();
          }
        } else {
          this.currentState = createInitialState<TTools>();
        }

        // Update status to in_progress
        await this.saveStateSafely({ status: 'in_progress' } as Partial<ConversationState<TTools>>);
      }

      // Resolve async functions before initial request
      const initialContext: TurnContext = { numberOfTurns: 0 };

      // Initialize context store from the context option
      if (this.options.context !== undefined) {
        const resolvedCtx = await resolveContext(this.options.context, initialContext);
        this.contextStore = new ToolContextStore(resolvedCtx);
      }

      // Resolve any async functions first
      let baseRequest = await this.resolveRequestForContext(initialContext) as ResponsesRequest;

      // If we have state with existing messages, use those as input
      if (this.currentState && this.currentState.messages &&
          Array.isArray(this.currentState.messages) && this.currentState.messages.length > 0) {
        const newInput = baseRequest.input;
        if (newInput) {
          const inputArray = Array.isArray(newInput) ? newInput : [newInput];
          baseRequest = {
            ...baseRequest,
            input: appendToMessages(
              this.currentState.messages as unknown as InputsUnion,
              inputArray as BaseInputsUnion[],
            ),
          };
        } else {
          baseRequest = {
            ...baseRequest,
            input: this.currentState.messages as unknown as InputsUnion,
          };
        }
      }

      // Store resolved request with stream mode
      this.resolvedRequest = {
        ...baseRequest,
        stream: true as const,
      };

      // Make the API request
      const apiResult = await this.sendFn(
        this.options.client,
        { responsesRequest: this.resolvedRequest },
        this.options.options,
      );

      if (!apiResult.ok) {
        throw apiResult.error;
      }

      // Handle both streaming and non-streaming responses
      if (isEventStream(apiResult.value)) {
        this.reusableStream = new ReusableReadableStream(apiResult.value);
      } else if (this.isNonStreamingResponse(apiResult.value)) {
        this.finalResponse = apiResult.value;
      } else {
        throw new Error('Unexpected response type from API');
      }
    })();

    return this.initPromise;
  }

  /**
   * Process approval/rejection decisions and resume execution.
   */
  private async processApprovalDecisions(): Promise<void> {
    if (!this.currentState || !this.stateAccessor) {
      throw new Error('Cannot process approval decisions without state');
    }

    const pendingCalls = this.currentState.pendingToolCalls as ParsedToolCall[] ?? [];
    const unsentResults = [
      ...(this.currentState.unsentToolResults as UnsentToolResult[] ?? []),
    ];

    const turnContext: TurnContext = {
      numberOfTurns: this.allToolExecutionRounds.length + 1,
    };

    // Process approvals - execute the approved tools
    for (const callId of this.approvedToolCalls) {
      const toolCall = pendingCalls.find((tc) => tc.id === callId);
      if (!toolCall) continue;

      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      if (!tool || !hasExecuteFunction(tool)) {
        unsentResults.push(createRejectedResult(callId, String(toolCall.name), 'Tool not found or not executable'));
        continue;
      }

      const result = await executeTool(
        tool,
        toolCall as ParsedToolCall,
        turnContext,
        undefined,
        this.contextStore ?? undefined,
      );

      if (result.error) {
        unsentResults.push(createRejectedResult(callId, String(toolCall.name), result.error.message));
      } else {
        unsentResults.push(createUnsentResult(callId, String(toolCall.name), result.result));
      }
    }

    // Process rejections
    for (const callId of this.rejectedToolCalls) {
      const toolCall = pendingCalls.find((tc) => tc.id === callId);
      if (!toolCall) continue;

      unsentResults.push(createRejectedResult(callId, String(toolCall.name), 'Rejected by user'));
    }

    // Remove processed calls from pending
    const processedIds = new Set([...this.approvedToolCalls, ...this.rejectedToolCalls]);
    const remainingPending = pendingCalls.filter((tc) => !processedIds.has(tc.id));

    // Update state
    const stateUpdates: Partial<ConversationState<TTools>> = {
      status: remainingPending.length > 0 ? 'awaiting_approval' : 'in_progress',
    } as Partial<ConversationState<TTools>>;
    if (remainingPending.length > 0) {
      (stateUpdates as Record<string, unknown>).pendingToolCalls = remainingPending;
    }
    if (unsentResults.length > 0) {
      (stateUpdates as Record<string, unknown>).unsentToolResults = unsentResults;
    }
    await this.saveStateSafely(stateUpdates);

    // Clear optional properties if they should be empty
    const propsToClear: Array<'pendingToolCalls' | 'unsentToolResults'> = [];
    if (remainingPending.length === 0) propsToClear.push('pendingToolCalls');
    if (unsentResults.length === 0) propsToClear.push('unsentToolResults');
    if (propsToClear.length > 0) {
      this.clearOptionalStateProperties(propsToClear);
      await this.saveStateSafely();
    }

    // If we still have pending approvals, stop here
    if (remainingPending.length > 0) {
      return;
    }

    // Otherwise, continue with tool execution using unsent results
    await this.continueWithUnsentResults();
  }

  /**
   * Continue execution with unsent tool results.
   */
  private async continueWithUnsentResults(): Promise<void> {
    if (!this.currentState || !this.stateAccessor) return;

    const unsentResults = this.currentState.unsentToolResults as UnsentToolResult[] ?? [];
    if (unsentResults.length === 0) return;

    // Convert to API format
    const toolOutputs = unsentResultsToAPIFormat(unsentResults);

    // Build new input with tool results
    const currentMessages = this.currentState.messages;
    const newInput = appendToMessages(currentMessages, toolOutputs as unknown as BaseInputsUnion[]);

    // Clear unsent results from state
    this.currentState = updateState(this.currentState, {
      messages: newInput,
    } as Partial<ConversationState<TTools>>);
    this.clearOptionalStateProperties(['unsentToolResults']);
    await this.saveStateSafely();

    const turnContext: TurnContext = {
      numberOfTurns: this.allToolExecutionRounds.length + 1,
    };

    const baseRequest = await this.resolveRequestForContext(turnContext) as ResponsesRequest;

    // Create request with the accumulated messages
    const request: ResponsesRequest = {
      ...baseRequest,
      input: newInput,
      stream: true,
    };

    this.resolvedRequest = request;

    // Make the API request
    const apiResult = await this.sendFn(
      this.options.client,
      { responsesRequest: request },
      this.options.options,
    );

    if (!apiResult.ok) {
      throw apiResult.error;
    }

    // Handle both streaming and non-streaming responses
    if (isEventStream(apiResult.value)) {
      this.reusableStream = new ReusableReadableStream(apiResult.value);
    } else if (this.isNonStreamingResponse(apiResult.value)) {
      this.finalResponse = apiResult.value;
    } else {
      throw new Error('Unexpected response type from API');
    }
  }

  /**
   * Execute tools automatically if they are provided and have execute functions.
   * This is idempotent - multiple calls will return the same promise.
   */
  private async executeToolsIfNeeded(): Promise<void> {
    if (this.toolExecutionPromise) {
      return this.toolExecutionPromise;
    }

    this.toolExecutionPromise = (async () => {
      await this.initStream();

      // If resuming from approval and still pending, don't continue
      if (this.isResumingFromApproval && this.currentState?.status === 'awaiting_approval') {
        return;
      }

      // Get initial response
      let currentResponse = await this.getInitialResponse();

      // Save initial response to state
      await this.saveResponseToState(currentResponse);

      // Check if tools should be executed
      const hasToolCalls = currentResponse.output.some(
        (item) => hasTypeProperty(item) && item.type === 'function_call',
      );

      if (!this.options.tools?.length || !hasToolCalls) {
        this.finalResponse = currentResponse;
        await this.markStateComplete();
        return;
      }

      // Extract and check tool calls
      const toolCalls = extractToolCallsFromResponse(currentResponse);

      // Check for approval requirements
      if (await this.handleApprovalCheck(toolCalls, 0, currentResponse)) {
        return; // Paused for approval
      }

      if (!this.hasExecutableToolCalls(toolCalls)) {
        this.finalResponse = currentResponse;
        await this.markStateComplete();
        return;
      }

      // Main execution loop
      let currentRound = 0;

      while (true) {
        // Check for external interruption
        if (await this.checkForInterruption(currentResponse)) {
          return;
        }

        // Check stop conditions
        if (await this.shouldStopExecution()) {
          break;
        }

        const currentToolCalls = extractToolCallsFromResponse(currentResponse);
        if (currentToolCalls.length === 0) {
          break;
        }

        // Check for approval requirements
        if (await this.handleApprovalCheck(currentToolCalls, currentRound + 1, currentResponse)) {
          return;
        }

        if (!this.hasExecutableToolCalls(currentToolCalls)) {
          break;
        }

        // Build turn context
        const turnNumber = currentRound + 1;
        const turnContext: TurnContext = { numberOfTurns: turnNumber };

        await this.options.onTurnStart?.(turnContext);

        // Resolve async functions for this turn
        await this.resolveAsyncFunctionsForTurn(turnContext);

        // Execute tools
        const toolResults = await this.executeToolRound(currentToolCalls, turnContext);

        // Track execution round
        this.allToolExecutionRounds.push({
          round: currentRound,
          toolCalls: currentToolCalls,
          response: currentResponse,
          toolResults,
        });

        // Save tool results to state
        await this.saveToolResultsToState(toolResults);

        // Apply nextTurnParams
        await this.applyNextTurnParams(currentToolCalls);

        currentResponse = await this.makeFollowupRequest(currentResponse, toolResults, turnNumber);

        await this.options.onTurnEnd?.(turnContext, currentResponse);

        // Save new response to state
        await this.saveResponseToState(currentResponse);

        currentRound++;
      }

      // Validate and finalize
      this.validateFinalResponse(currentResponse);
      this.finalResponse = currentResponse;
      await this.markStateComplete();
    })();

    return this.toolExecutionPromise;
  }

  /**
   * Internal helper to get the text after tool execution.
   */
  private async getTextInternal(): Promise<string> {
    await this.executeToolsIfNeeded();

    if (!this.finalResponse) {
      throw new Error('Response not available');
    }

    return extractTextFromResponse(this.finalResponse);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Get just the text content from the response.
   * This will consume the stream until completion, execute any tools, and extract the text.
   */
  getText(): Promise<string> {
    if (this.textPromise) {
      return this.textPromise;
    }

    this.textPromise = this.getTextInternal();
    return this.textPromise;
  }

  /**
   * Get the complete response object including usage information.
   * This will consume the stream until completion and execute any tools.
   */
  async getResponse(): Promise<OpenResponsesResult> {
    await this.executeToolsIfNeeded();

    if (!this.finalResponse) {
      throw new Error('Response not available');
    }

    return this.finalResponse;
  }

  /**
   * Stream all response events as they arrive across all turns.
   * Multiple consumers can iterate over this stream concurrently.
   * Includes API events, tool events, and turn.start/turn.end delimiters.
   */
  getFullResponsesStream(): AsyncIterableIterator<ResponseStreamEvent> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          const consumer = this.reusableStream.createConsumer();
          for await (const event of consumer) {
            yield event;
          }
        }
        return;
      }

      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();

      for await (const event of consumer) {
        yield event;
      }

      await executionPromise;
    }.call(this);
  }

  /**
   * Stream only text deltas as they arrive from all turns.
   * This filters the full event stream to only yield text content,
   * including text from follow-up responses in multi-turn tool loops.
   */
  getTextStream(): AsyncIterableIterator<string> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* extractTextDeltas(this.reusableStream);
        }
        return;
      }

      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();

      for await (const event of consumer) {
        if (isOutputTextDeltaEvent(event as StreamEvents)) {
          yield (event as OutputTextDeltaEvent).delta;
        }
      }

      await executionPromise;
    }.call(this);
  }

  /**
   * Stream all output items cumulatively as they arrive.
   * Items are emitted with the same ID but progressively updated content as streaming progresses.
   * Also yields tool results (function_call_output) after tool execution completes.
   *
   * Item types include:
   * - message: Assistant text responses
   * - function_call: Tool calls
   * - reasoning: Model reasoning
   * - web_search_call: Web search operations
   * - file_search_call: File search operations
   * - image_generation_call: Image generation operations
   * - function_call_output: Results from executed tools
   */
  getItemsStream(): AsyncIterableIterator<StreamableOutputItem> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      // No tools -- stream single turn directly (no broadcaster needed)
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* buildItemsStream(this.reusableStream);
        }
        return;
      }

      // Use turnBroadcaster
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      const itemsInProgress = new Map<string, ItemInProgress>();

      for await (const event of consumer) {
        // Tool call outputs -> yield directly as function_call_output items
        if (isToolCallOutputEvent(event)) {
          yield event.output as StreamableOutputItem;
          continue;
        }

        // Stream termination -> reset items map for next turn
        if ('type' in event && streamTerminationEvents.has((event as { type: string }).type)) {
          itemsInProgress.clear();
        }

        // API stream events -> dispatch through item handlers
        if ('type' in event && (event as { type: string }).type in itemsStreamHandlers) {
          const handler = itemsStreamHandlers[(event as { type: string }).type];
          if (handler) {
            const result = handler(
              event as StreamEvents,
              itemsInProgress,
            );
            if (result) {
              yield result;
            }
          }
        }
      }

      await executionPromise;
    }.call(this);
  }

  /**
   * @deprecated Use `getItemsStream()` instead.
   *
   * Stream cumulative message snapshots as content is added in responses format.
   * Returns OutputMessage, FunctionCallOutputItem, or OutputFunctionCallItem.
   */
  getNewMessagesStream(): AsyncIterableIterator<
    OutputMessage | FunctionCallOutputItem | OutputFunctionCallItem
  > {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      // First yield messages from the stream in responses format
      if (this.reusableStream) {
        yield* buildResponsesMessageStream(this.reusableStream);
      }

      // Execute tools if needed
      await this.executeToolsIfNeeded();

      // Yield function calls and their outputs for each executed tool
      for (const round of this.allToolExecutionRounds) {
        for (const item of round.response.output) {
          if (isFunctionCallItem(item)) {
            yield item;
          }
        }
        for (const toolResult of round.toolResults) {
          yield toolResult;
        }
      }

      // If tools were executed, yield the final message (if there is one)
      if (this.finalResponse && this.allToolExecutionRounds.length > 0) {
        const hasMessage = this.finalResponse.output.some(
          (item: unknown) => hasTypeProperty(item) && (item as { type: string }).type === 'message',
        );
        if (hasMessage) {
          yield extractResponsesMessageFromResponse(this.finalResponse);
        }
      }
    }.call(this);
  }

  /**
   * Stream only reasoning deltas as they arrive from all turns.
   */
  getReasoningStream(): AsyncIterableIterator<string> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* extractReasoningDeltas(this.reusableStream);
        }
        return;
      }

      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();

      for await (const event of consumer) {
        if (isReasoningDeltaEvent(event as StreamEvents)) {
          yield (event as ReasoningDeltaEvent).delta;
        }
      }

      await executionPromise;
    }.call(this);
  }

  /**
   * Stream tool call argument deltas and preliminary results from all turns.
   * Preliminary results are streamed in REAL-TIME as generator tools yield.
   */
  getToolStream(): AsyncIterableIterator<ToolStreamEvent> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          for await (const delta of extractToolDeltas(this.reusableStream)) {
            yield { type: 'delta' as const, content: delta };
          }
        }
        return;
      }

      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();

      for await (const event of consumer) {
        if ('type' in event && (event as { type: string }).type === 'response.function_call_arguments.delta') {
          yield { type: 'delta' as const, content: (event as { delta: string }).delta };
          continue;
        }
        if ('type' in event && (event as { type: string }).type === 'tool.preliminary_result') {
          yield {
            type: 'preliminary_result' as const,
            toolCallId: (event as { toolCallId: string }).toolCallId,
            result: (event as { result: unknown }).result,
          };
        }
      }

      await executionPromise;
    }.call(this);
  }

  /**
   * Get all tool calls from the completed response (before auto-execution).
   * Returns structured tool calls with parsed arguments.
   */
  async getToolCalls(): Promise<ParsedToolCall[]> {
    await this.initStream();

    if (this.finalResponse) {
      return extractToolCallsFromResponse(this.finalResponse);
    }

    if (!this.reusableStream) {
      throw new Error('Stream not initialized');
    }

    const completedResponse = await consumeStreamForCompletion(this.reusableStream);
    return extractToolCallsFromResponse(completedResponse);
  }

  /**
   * Stream structured tool call objects as they're completed.
   * Each iteration yields a complete tool call with parsed arguments.
   */
  getToolCallsStream(): AsyncIterableIterator<ParsedToolCall> {
    return async function* (this: ModelResult<TTools, TShared>) {
      await this.initStream();

      if (!this.reusableStream && !this.finalResponse) {
        throw new Error('Stream not initialized');
      }

      if (this.reusableStream) {
        yield* buildToolCallStream(this.reusableStream);
      }
    }.call(this);
  }

  /**
   * Returns an async iterable that emits a full context snapshot every time
   * any tool calls ctx.update(). Can be consumed concurrently with getText(),
   * getToolStream(), etc.
   *
   * @example
   * ```typescript
   * for await (const snapshot of result.getContextUpdates()) {
   *   console.log('Context changed:', snapshot);
   * }
   * ```
   */
  async *getContextUpdates(): AsyncGenerator<Record<string, Record<string, unknown>>> {
    // Ensure stream is initialized (which creates the context store)
    await this.initStream();

    if (!this.contextStore) {
      return;
    }

    const store = this.contextStore;
    const queue: Record<string, Record<string, unknown>>[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const unsubscribe = store.subscribe((snapshot) => {
      queue.push(snapshot);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    // Signal completion when tool execution finishes
    this.executeToolsIfNeeded().then(
      () => {
        done = true;
        if (resolve) {
          resolve();
          resolve = null;
        }
      },
      () => {
        done = true;
        if (resolve) {
          resolve();
          resolve = null;
        }
      },
    );

    try {
      while (!done) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          // Wait for next update or completion
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
      // Drain any remaining queued snapshots
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Cancel the underlying stream and all consumers.
   */
  async cancel(): Promise<void> {
    if (this.reusableStream) {
      await this.reusableStream.cancel();
    }
  }

  // =========================================================================
  // Multi-Turn Conversation State Methods
  // =========================================================================

  /**
   * Check if the conversation requires human approval to continue.
   * Returns true if there are pending tool calls awaiting approval.
   */
  async requiresApproval(): Promise<boolean> {
    await this.initStream();

    if (this.currentState?.status === 'awaiting_approval') {
      return true;
    }

    return ((this.currentState as unknown as Record<string, unknown>)?.pendingToolCalls as unknown[])?.length > 0;
  }

  /**
   * Get the pending tool calls that require approval.
   * Returns empty array if no approvals needed.
   */
  async getPendingToolCalls(): Promise<ParsedToolCall[]> {
    await this.initStream();

    if (!this.isResumingFromApproval) {
      await this.executeToolsIfNeeded();
    }

    return ((this.currentState as unknown as Record<string, unknown>)?.pendingToolCalls as ParsedToolCall[] ?? []);
  }

  /**
   * Get the current conversation state.
   * Useful for inspection, debugging, or custom persistence.
   */
  async getState(): Promise<ConversationState<TTools>> {
    await this.initStream();

    if (!this.isResumingFromApproval) {
      await this.executeToolsIfNeeded();
    }

    if (!this.currentState) {
      throw new Error('State not initialized. Make sure a StateAccessor was provided to callModel.');
    }

    return this.currentState;
  }
}
