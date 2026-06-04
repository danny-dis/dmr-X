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
import { hasExecuteFunction } from './tool-types.js';
import { ToolEventBroadcaster } from './tool-event-broadcaster.js';
import { ToolContextStore, resolveContext } from './tool-context.js';
import { appendToMessages, createInitialState, createRejectedResult, createUnsentResult, extractTextFromResponse as extractTextFromResponseState, partitionToolCalls, unsentResultsToAPIFormat, updateState, } from './conversation-state.js';
import { ReusableReadableStream } from './reusable-stream.js';
import { buildItemsStream, buildResponsesMessageStream, buildToolCallStream, consumeStreamForCompletion, extractReasoningDeltas, extractResponsesMessageFromResponse, extractTextDeltas, extractTextFromResponse, extractToolCallsFromResponse, extractToolDeltas, itemsStreamHandlers, streamTerminationEvents, } from './stream-transformers.js';
import { executeTool } from './tool-executor.js';
import { executeNextTurnParamsFunctions, applyNextTurnParamsToRequest } from './next-turn-params.js';
import { isStopConditionMet, stepCountIs } from './stop-conditions.js';
import { isFunctionCallItem, isResponseCompletedEvent, isResponseFailedEvent, isResponseIncompleteEvent, isOutputTextDeltaEvent, isReasoningDeltaEvent, } from './stream-type-guards.js';
import { hasAsyncFunctions, resolveAsyncFunctions } from './async-params.js';
// ---------------------------------------------------------------------------
// Local type guard (replaces hasTypeProperty from SDK's stream-type-guards)
// ---------------------------------------------------------------------------
/** Check if a value has a `type` property (string). */
function hasTypeProperty(value) {
    return typeof value === 'object' && value !== null && 'type' in value &&
        typeof value.type === 'string';
}
// ---------------------------------------------------------------------------
// Local isToolCallOutputEvent (replaces import from tool-types.js in SDK)
// ---------------------------------------------------------------------------
/** Type guard: check if a stream event is a tool.call_output event. */
function isToolCallOutputEvent(event) {
    return hasTypeProperty(event) && event.type === 'tool.call_output';
}
// ---------------------------------------------------------------------------
// isEventStream helper (replaces the one from the SDK)
// ---------------------------------------------------------------------------
/** Type guard: check if a value is an EventStream (has a toReadableStream-like interface). */
function isEventStream(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    // Check constructor name for EventStream
    const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
    if (constructorName === 'EventStream') {
        return true;
    }
    // Fallback: check for pipeTo / getReader (ReadableStream methods)
    const maybeStream = value;
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
export class ModelResult {
    reusableStream = null;
    textPromise = null;
    options;
    initPromise = null;
    toolExecutionPromise = null;
    finalResponse = null;
    toolEventBroadcaster = null;
    allToolExecutionRounds = [];
    // Track resolved request after async function resolution
    resolvedRequest = null;
    // State management for multi-turn conversations
    stateAccessor = null;
    currentState = null;
    requireApprovalFn = null;
    approvedToolCalls = [];
    rejectedToolCalls = [];
    isResumingFromApproval = false;
    // Unified turn broadcaster for multi-turn streaming
    turnBroadcaster = null;
    initialStreamPipeStarted = false;
    initialPipePromise = null;
    // Context store for typed tool context (persists across turns)
    contextStore = null;
    // Resolved betaResponsesSend function
    sendFn;
    constructor(options) {
        this.options = options;
        // Resolve the send function
        this.sendFn = options.betaResponsesSend ?? (() => {
            throw new Error('betaResponsesSend not provided. Pass a betaResponsesSend function in GetResponseOptions.');
        });
        // Runtime validation: approval decisions require state
        const hasApprovalDecisions = (options.approveToolCalls && options.approveToolCalls.length > 0) ||
            (options.rejectToolCalls && options.rejectToolCalls.length > 0);
        if (hasApprovalDecisions && !options.state) {
            throw new Error('approveToolCalls and rejectToolCalls require a state accessor. ' +
                'Provide a StateAccessor via the "state" parameter to persist approval decisions.');
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
    ensureTurnBroadcaster() {
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
    startInitialStreamPipe() {
        if (this.initialStreamPipeStarted)
            return;
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
            });
            const consumer = stream.createConsumer();
            for await (const event of consumer) {
                broadcaster.push(event);
            }
            broadcaster.push({
                type: 'turn.end',
                turnNumber: 0,
                timestamp: Date.now(),
            });
        })().catch((error) => {
            broadcaster.complete(error instanceof Error ? error : new Error(String(error)));
        });
    }
    /**
     * Pipe a follow-up stream into the turn broadcaster and capture the completed response.
     * Emits turn.start / turn.end delimiters around the stream events.
     */
    async pipeAndConsumeStream(stream, turnNumber) {
        const broadcaster = this.turnBroadcaster;
        broadcaster.push({
            type: 'turn.start',
            turnNumber,
            timestamp: Date.now(),
        });
        const consumer = stream.createConsumer();
        let completedResponse = null;
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
        });
        if (!completedResponse) {
            throw new Error('Follow-up stream ended without a completed response');
        }
        return completedResponse;
    }
    /**
     * Push a tool result event to both the legacy tool event broadcaster
     * and the unified turn broadcaster.
     */
    broadcastToolResult(toolCallId, result, preliminaryResults) {
        this.toolEventBroadcaster?.push({
            type: 'tool_result',
            toolCallId,
            result,
            ...(preliminaryResults?.length && { preliminaryResults }),
        });
        this.turnBroadcaster?.push({
            type: 'tool.result',
            toolCallId,
            result,
            timestamp: Date.now(),
            ...(preliminaryResults?.length && { preliminaryResults }),
        });
    }
    /**
     * Push a preliminary result event to both the legacy tool event broadcaster
     * and the unified turn broadcaster.
     */
    broadcastPreliminaryResult(toolCallId, result) {
        this.toolEventBroadcaster?.push({
            type: 'preliminary_result',
            toolCallId,
            result,
        });
        this.turnBroadcaster?.push({
            type: 'tool.preliminary_result',
            toolCallId,
            result,
            timestamp: Date.now(),
        });
    }
    /**
     * Set up the turn broadcaster with tool execution and return the consumer.
     * Used by stream methods that need to iterate over all turns.
     */
    startTurnBroadcasterExecution() {
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
    isNonStreamingResponse(value) {
        return (value !== null &&
            typeof value === 'object' &&
            'output' in value &&
            !('getReader' in value));
    }
    // =========================================================================
    // Helper Methods for executeToolsIfNeeded
    // =========================================================================
    /**
     * Get initial response from stream or cached final response.
     */
    async getInitialResponse() {
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
    async saveResponseToState(response) {
        if (!this.stateAccessor || !this.currentState)
            return;
        const outputItems = Array.isArray(response.output)
            ? response.output
            : [response.output];
        await this.saveStateSafely({
            messages: appendToMessages(this.currentState.messages, outputItems),
            previousResponseId: response.id,
        });
    }
    /**
     * Mark state as complete.
     */
    async markStateComplete() {
        await this.saveStateSafely({ status: 'completed' });
    }
    /**
     * Save tool results to state.
     */
    async saveToolResultsToState(toolResults) {
        if (!this.currentState)
            return;
        await this.saveStateSafely({
            messages: appendToMessages(this.currentState.messages, toolResults),
        });
    }
    /**
     * Check if execution should be interrupted by external signal.
     */
    async checkForInterruption(currentResponse) {
        if (!this.stateAccessor)
            return false;
        const freshState = await this.stateAccessor.load();
        if (!freshState?.interruptedBy)
            return false;
        // Save partial state
        if (this.currentState) {
            const currentToolCalls = extractToolCallsFromResponse(currentResponse);
            await this.saveStateSafely({
                status: 'interrupted',
                partialResponse: {
                    text: extractTextFromResponseState(currentResponse),
                    toolCalls: currentToolCalls,
                },
            });
        }
        this.finalResponse = currentResponse;
        return true;
    }
    /**
     * Check if stop conditions are met.
     */
    async shouldStopExecution() {
        const stopWhen = this.options.stopWhen ?? stepCountIs(DEFAULT_MAX_STEPS);
        const stopConditions = Array.isArray(stopWhen)
            ? stopWhen
            : [stopWhen];
        return isStopConditionMet({
            stopConditions,
            steps: this.allToolExecutionRounds.map((round) => ({
                stepType: 'continue',
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
    hasExecutableToolCalls(toolCalls) {
        return toolCalls.some((toolCall) => {
            const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
            return tool && hasExecuteFunction(tool);
        });
    }
    /**
     * Execute tools that can auto-execute (don't require approval) in parallel.
     */
    async executeAutoApproveTools(toolCalls, turnContext) {
        const toolCallPromises = toolCalls.map(async (tc) => {
            const tool = this.options.tools?.find((t) => t.function.name === tc.name);
            if (!tool || !hasExecuteFunction(tool)) {
                return null;
            }
            const result = await executeTool(tool, tc, turnContext, undefined, this.contextStore ?? undefined);
            if (result.error) {
                return createRejectedResult(tc.id, String(tc.name), result.error.message);
            }
            return createUnsentResult(tc.id, String(tc.name), result.result);
        });
        const settledResults = await Promise.allSettled(toolCallPromises);
        const results = [];
        for (let i = 0; i < settledResults.length; i++) {
            const settled = settledResults[i];
            const tc = toolCalls[i];
            if (!settled || !tc)
                continue;
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
    async handleApprovalCheck(toolCalls, currentRound, currentResponse) {
        if (!this.options.tools)
            return false;
        const turnContext = {
            numberOfTurns: currentRound,
        };
        const { requiresApproval: needsApproval, autoExecute } = await partitionToolCalls(toolCalls, this.options.tools, turnContext, this.requireApprovalFn ?? undefined);
        if (needsApproval.length === 0)
            return false;
        // Validate: approval requires state accessor
        if (!this.stateAccessor) {
            const toolNames = needsApproval.map((tc) => tc.name).join(', ');
            throw new Error(`Tool(s) require approval but no state accessor is configured: ${toolNames}. ` +
                'Provide a StateAccessor via the "state" parameter to enable approval workflows.');
        }
        // Execute auto-approve tools
        const unsentResults = await this.executeAutoApproveTools(autoExecute, turnContext);
        // Save state with pending approvals
        const stateUpdates = {
            pendingToolCalls: needsApproval,
            status: 'awaiting_approval',
        };
        if (unsentResults.length > 0) {
            stateUpdates.unsentToolResults = unsentResults;
        }
        await this.saveStateSafely(stateUpdates);
        this.finalResponse = currentResponse;
        return true; // Pause for approval
    }
    /**
     * Execute all tools in a single round in parallel.
     */
    async executeToolRound(toolCalls, turnContext) {
        const toolCallPromises = toolCalls.map(async (toolCall) => {
            const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
            if (!tool || !hasExecuteFunction(tool)) {
                return null;
            }
            // Check if arguments failed to parse (remained as string instead of object)
            const args = toolCall.arguments;
            if (typeof args === 'string') {
                const rawArgs = args;
                const errorMessage = `Failed to parse tool call arguments for "${toolCall.name}": The model provided invalid JSON. ` +
                    `Raw arguments received: "${rawArgs}". ` +
                    `Please provide valid JSON arguments for this tool call.`;
                this.broadcastToolResult(toolCall.id, { error: errorMessage });
                return {
                    type: 'parse_error',
                    toolCall,
                    output: {
                        type: 'function_call_output',
                        id: `output_${toolCall.id}`,
                        callId: toolCall.id,
                        output: JSON.stringify({ error: errorMessage }),
                    },
                };
            }
            const preliminaryResultsForCall = [];
            const hasBroadcaster = this.toolEventBroadcaster || this.turnBroadcaster;
            const onPreliminaryResult = hasBroadcaster
                ? (callId, resultValue) => {
                    preliminaryResultsForCall.push(resultValue);
                    this.broadcastPreliminaryResult(callId, resultValue);
                }
                : undefined;
            const result = await executeTool(tool, toolCall, turnContext, onPreliminaryResult, this.contextStore ?? undefined);
            return {
                type: 'execution',
                toolCall,
                tool,
                result,
                preliminaryResultsForCall,
            };
        });
        const settledResults = await Promise.allSettled(toolCallPromises);
        const toolResults = [];
        for (let i = 0; i < settledResults.length; i++) {
            const settled = settledResults[i];
            const originalToolCall = toolCalls[i];
            if (!settled || !originalToolCall)
                continue;
            if (settled.status === 'rejected') {
                const errorMessage = settled.reason instanceof Error
                    ? settled.reason.message
                    : String(settled.reason);
                this.broadcastToolResult(originalToolCall.id, { error: errorMessage });
                const rejectedOutput = {
                    type: 'function_call_output',
                    id: `output_${originalToolCall.id}`,
                    callId: originalToolCall.id,
                    output: JSON.stringify({ error: errorMessage }),
                };
                toolResults.push(rejectedOutput);
                this.turnBroadcaster?.push({
                    type: 'tool.call_output',
                    output: rejectedOutput,
                    timestamp: Date.now(),
                });
                continue;
            }
            const value = settled.value;
            if (!value)
                continue;
            if (value.type === 'parse_error') {
                toolResults.push(value.output);
                this.turnBroadcaster?.push({
                    type: 'tool.call_output',
                    output: value.output,
                    timestamp: Date.now(),
                });
                continue;
            }
            const toolResult = value.result.error
                ? { error: value.result.error.message }
                : value.result.result;
            this.broadcastToolResult(value.toolCall.id, toolResult, value.preliminaryResultsForCall.length > 0 ? value.preliminaryResultsForCall : undefined);
            const executedOutput = {
                type: 'function_call_output',
                id: `output_${value.toolCall.id}`,
                callId: value.toolCall.id,
                output: value.result.error
                    ? JSON.stringify({ error: value.result.error.message })
                    : JSON.stringify(value.result.result),
            };
            toolResults.push(executedOutput);
            this.turnBroadcaster?.push({
                type: 'tool.call_output',
                output: executedOutput,
                timestamp: Date.now(),
            });
        }
        return toolResults;
    }
    /**
     * Resolve async functions for the current turn.
     */
    async resolveAsyncFunctionsForTurn(turnContext) {
        if (hasAsyncFunctions(this.options.request)) {
            const resolved = await resolveAsyncFunctions(this.options.request, turnContext);
            // Preserve accumulated input from previous turns
            const preservedInput = this.resolvedRequest?.input;
            const preservedStream = this.resolvedRequest?.stream;
            this.resolvedRequest = {
                ...resolved,
                stream: preservedStream ?? true,
                ...(preservedInput !== undefined && { input: preservedInput }),
            };
        }
    }
    /**
     * Apply nextTurnParams from executed tools.
     */
    async applyNextTurnParams(toolCalls) {
        if (!this.options.tools || toolCalls.length === 0 || !this.resolvedRequest) {
            return;
        }
        const computedParams = await executeNextTurnParamsFunctions(toolCalls, this.options.tools, this.resolvedRequest);
        if (Object.keys(computedParams).length > 0) {
            this.resolvedRequest = applyNextTurnParamsToRequest(this.resolvedRequest, computedParams);
        }
    }
    /**
     * Make a follow-up API request with tool results.
     */
    async makeFollowupRequest(currentResponse, toolResults, turnNumber) {
        const originalInput = this.resolvedRequest?.input;
        const normalizedOriginalInput = Array.isArray(originalInput)
            ? originalInput
            : originalInput
                ? [{ role: 'user', content: originalInput }]
                : [];
        const outputAsInput = (Array.isArray(currentResponse.output)
            ? currentResponse.output
            : [currentResponse.output]);
        const newInput = [
            ...normalizedOriginalInput,
            ...outputAsInput,
            ...toolResults,
        ];
        if (!this.resolvedRequest) {
            throw new Error('Request not initialized');
        }
        // Update resolvedRequest.input with accumulated conversation for next turn
        this.resolvedRequest = {
            ...this.resolvedRequest,
            input: newInput,
        };
        const newRequest = {
            ...this.resolvedRequest,
            stream: true,
        };
        const newResult = await this.sendFn(this.options.client, { responsesRequest: newRequest }, this.options.options);
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
        }
        else if (this.isNonStreamingResponse(value)) {
            return value;
        }
        else {
            throw new Error('Unexpected response type from API');
        }
    }
    /**
     * Validate the final response has required fields.
     */
    validateFinalResponse(response) {
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
    async resolveRequestForContext(context) {
        if (hasAsyncFunctions(this.options.request)) {
            return resolveAsyncFunctions(this.options.request, context);
        }
        // Already resolved, extract non-function fields
        const { stopWhen: _, state: _s, requireApproval: _r, approveToolCalls: _a, rejectToolCalls: _rj, context: _c, betaResponsesSend: _brs, onTurnStart: _ots, onTurnEnd: _ote, ...rest } = this.options.request;
        return rest;
    }
    /**
     * Safely persist state with error handling.
     */
    async saveStateSafely(updates) {
        if (!this.stateAccessor || !this.currentState)
            return;
        if (updates) {
            this.currentState = updateState(this.currentState, updates);
        }
        try {
            await this.stateAccessor.save(this.currentState);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to persist conversation state: ${message}`);
        }
    }
    /**
     * Remove optional properties from state when they should be cleared.
     */
    clearOptionalStateProperties(props) {
        if (!this.currentState)
            return;
        for (const prop of props) {
            delete this.currentState[prop];
        }
    }
    // =========================================================================
    // Core Methods
    // =========================================================================
    /**
     * Initialize the stream if not already started.
     * This is idempotent - multiple calls will return the same promise.
     */
    initStream() {
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
                            const approvalContext = { numberOfTurns: 0 };
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
                        this.currentState = updateState(loadedState, { status: 'in_progress' });
                        this.clearOptionalStateProperties(['interruptedBy']);
                        await this.saveStateSafely();
                    }
                }
                else {
                    this.currentState = createInitialState();
                }
                // Update status to in_progress
                await this.saveStateSafely({ status: 'in_progress' });
            }
            // Resolve async functions before initial request
            const initialContext = { numberOfTurns: 0 };
            // Initialize context store from the context option
            if (this.options.context !== undefined) {
                const resolvedCtx = await resolveContext(this.options.context, initialContext);
                this.contextStore = new ToolContextStore(resolvedCtx);
            }
            // Resolve any async functions first
            let baseRequest = await this.resolveRequestForContext(initialContext);
            // If we have state with existing messages, use those as input
            if (this.currentState && this.currentState.messages &&
                Array.isArray(this.currentState.messages) && this.currentState.messages.length > 0) {
                const newInput = baseRequest.input;
                if (newInput) {
                    const inputArray = Array.isArray(newInput) ? newInput : [newInput];
                    baseRequest = {
                        ...baseRequest,
                        input: appendToMessages(this.currentState.messages, inputArray),
                    };
                }
                else {
                    baseRequest = {
                        ...baseRequest,
                        input: this.currentState.messages,
                    };
                }
            }
            // Store resolved request with stream mode
            this.resolvedRequest = {
                ...baseRequest,
                stream: true,
            };
            // Make the API request
            const apiResult = await this.sendFn(this.options.client, { responsesRequest: this.resolvedRequest }, this.options.options);
            if (!apiResult.ok) {
                throw apiResult.error;
            }
            // Handle both streaming and non-streaming responses
            if (isEventStream(apiResult.value)) {
                this.reusableStream = new ReusableReadableStream(apiResult.value);
            }
            else if (this.isNonStreamingResponse(apiResult.value)) {
                this.finalResponse = apiResult.value;
            }
            else {
                throw new Error('Unexpected response type from API');
            }
        })();
        return this.initPromise;
    }
    /**
     * Process approval/rejection decisions and resume execution.
     */
    async processApprovalDecisions() {
        if (!this.currentState || !this.stateAccessor) {
            throw new Error('Cannot process approval decisions without state');
        }
        const pendingCalls = this.currentState.pendingToolCalls ?? [];
        const unsentResults = [
            ...(this.currentState.unsentToolResults ?? []),
        ];
        const turnContext = {
            numberOfTurns: this.allToolExecutionRounds.length + 1,
        };
        // Process approvals - execute the approved tools
        for (const callId of this.approvedToolCalls) {
            const toolCall = pendingCalls.find((tc) => tc.id === callId);
            if (!toolCall)
                continue;
            const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
            if (!tool || !hasExecuteFunction(tool)) {
                unsentResults.push(createRejectedResult(callId, String(toolCall.name), 'Tool not found or not executable'));
                continue;
            }
            const result = await executeTool(tool, toolCall, turnContext, undefined, this.contextStore ?? undefined);
            if (result.error) {
                unsentResults.push(createRejectedResult(callId, String(toolCall.name), result.error.message));
            }
            else {
                unsentResults.push(createUnsentResult(callId, String(toolCall.name), result.result));
            }
        }
        // Process rejections
        for (const callId of this.rejectedToolCalls) {
            const toolCall = pendingCalls.find((tc) => tc.id === callId);
            if (!toolCall)
                continue;
            unsentResults.push(createRejectedResult(callId, String(toolCall.name), 'Rejected by user'));
        }
        // Remove processed calls from pending
        const processedIds = new Set([...this.approvedToolCalls, ...this.rejectedToolCalls]);
        const remainingPending = pendingCalls.filter((tc) => !processedIds.has(tc.id));
        // Update state
        const stateUpdates = {
            status: remainingPending.length > 0 ? 'awaiting_approval' : 'in_progress',
        };
        if (remainingPending.length > 0) {
            stateUpdates.pendingToolCalls = remainingPending;
        }
        if (unsentResults.length > 0) {
            stateUpdates.unsentToolResults = unsentResults;
        }
        await this.saveStateSafely(stateUpdates);
        // Clear optional properties if they should be empty
        const propsToClear = [];
        if (remainingPending.length === 0)
            propsToClear.push('pendingToolCalls');
        if (unsentResults.length === 0)
            propsToClear.push('unsentToolResults');
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
    async continueWithUnsentResults() {
        if (!this.currentState || !this.stateAccessor)
            return;
        const unsentResults = this.currentState.unsentToolResults ?? [];
        if (unsentResults.length === 0)
            return;
        // Convert to API format
        const toolOutputs = unsentResultsToAPIFormat(unsentResults);
        // Build new input with tool results
        const currentMessages = this.currentState.messages;
        const newInput = appendToMessages(currentMessages, toolOutputs);
        // Clear unsent results from state
        this.currentState = updateState(this.currentState, {
            messages: newInput,
        });
        this.clearOptionalStateProperties(['unsentToolResults']);
        await this.saveStateSafely();
        const turnContext = {
            numberOfTurns: this.allToolExecutionRounds.length + 1,
        };
        const baseRequest = await this.resolveRequestForContext(turnContext);
        // Create request with the accumulated messages
        const request = {
            ...baseRequest,
            input: newInput,
            stream: true,
        };
        this.resolvedRequest = request;
        // Make the API request
        const apiResult = await this.sendFn(this.options.client, { responsesRequest: request }, this.options.options);
        if (!apiResult.ok) {
            throw apiResult.error;
        }
        // Handle both streaming and non-streaming responses
        if (isEventStream(apiResult.value)) {
            this.reusableStream = new ReusableReadableStream(apiResult.value);
        }
        else if (this.isNonStreamingResponse(apiResult.value)) {
            this.finalResponse = apiResult.value;
        }
        else {
            throw new Error('Unexpected response type from API');
        }
    }
    /**
     * Execute tools automatically if they are provided and have execute functions.
     * This is idempotent - multiple calls will return the same promise.
     */
    async executeToolsIfNeeded() {
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
            const hasToolCalls = currentResponse.output.some((item) => hasTypeProperty(item) && item.type === 'function_call');
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
                const turnContext = { numberOfTurns: turnNumber };
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
    async getTextInternal() {
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
    getText() {
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
    async getResponse() {
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
    getFullResponsesStream() {
        return async function* () {
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
    getTextStream() {
        return async function* () {
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
                if (isOutputTextDeltaEvent(event)) {
                    yield event.delta;
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
    getItemsStream() {
        return async function* () {
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
            const itemsInProgress = new Map();
            for await (const event of consumer) {
                // Tool call outputs -> yield directly as function_call_output items
                if (isToolCallOutputEvent(event)) {
                    yield event.output;
                    continue;
                }
                // Stream termination -> reset items map for next turn
                if ('type' in event && streamTerminationEvents.has(event.type)) {
                    itemsInProgress.clear();
                }
                // API stream events -> dispatch through item handlers
                if ('type' in event && event.type in itemsStreamHandlers) {
                    const handler = itemsStreamHandlers[event.type];
                    if (handler) {
                        const result = handler(event, itemsInProgress);
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
    getNewMessagesStream() {
        return async function* () {
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
                const hasMessage = this.finalResponse.output.some((item) => hasTypeProperty(item) && item.type === 'message');
                if (hasMessage) {
                    yield extractResponsesMessageFromResponse(this.finalResponse);
                }
            }
        }.call(this);
    }
    /**
     * Stream only reasoning deltas as they arrive from all turns.
     */
    getReasoningStream() {
        return async function* () {
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
                if (isReasoningDeltaEvent(event)) {
                    yield event.delta;
                }
            }
            await executionPromise;
        }.call(this);
    }
    /**
     * Stream tool call argument deltas and preliminary results from all turns.
     * Preliminary results are streamed in REAL-TIME as generator tools yield.
     */
    getToolStream() {
        return async function* () {
            await this.initStream();
            if (!this.reusableStream && !this.finalResponse) {
                throw new Error('Stream not initialized');
            }
            if (!this.options.tools?.length) {
                if (this.reusableStream) {
                    for await (const delta of extractToolDeltas(this.reusableStream)) {
                        yield { type: 'delta', content: delta };
                    }
                }
                return;
            }
            const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
            for await (const event of consumer) {
                if ('type' in event && event.type === 'response.function_call_arguments.delta') {
                    yield { type: 'delta', content: event.delta };
                    continue;
                }
                if ('type' in event && event.type === 'tool.preliminary_result') {
                    yield {
                        type: 'preliminary_result',
                        toolCallId: event.toolCallId,
                        result: event.result,
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
    async getToolCalls() {
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
    getToolCallsStream() {
        return async function* () {
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
    async *getContextUpdates() {
        // Ensure stream is initialized (which creates the context store)
        await this.initStream();
        if (!this.contextStore) {
            return;
        }
        const store = this.contextStore;
        const queue = [];
        let resolve = null;
        let done = false;
        const unsubscribe = store.subscribe((snapshot) => {
            queue.push(snapshot);
            if (resolve) {
                resolve();
                resolve = null;
            }
        });
        // Signal completion when tool execution finishes
        this.executeToolsIfNeeded().then(() => {
            done = true;
            if (resolve) {
                resolve();
                resolve = null;
            }
        }, () => {
            done = true;
            if (resolve) {
                resolve();
                resolve = null;
            }
        });
        try {
            while (!done) {
                if (queue.length > 0) {
                    yield queue.shift();
                }
                else {
                    // Wait for next update or completion
                    await new Promise((r) => {
                        resolve = r;
                    });
                }
            }
            // Drain any remaining queued snapshots
            while (queue.length > 0) {
                yield queue.shift();
            }
        }
        finally {
            unsubscribe();
        }
    }
    /**
     * Cancel the underlying stream and all consumers.
     */
    async cancel() {
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
    async requiresApproval() {
        await this.initStream();
        if (this.currentState?.status === 'awaiting_approval') {
            return true;
        }
        return this.currentState?.pendingToolCalls?.length > 0;
    }
    /**
     * Get the pending tool calls that require approval.
     * Returns empty array if no approvals needed.
     */
    async getPendingToolCalls() {
        await this.initStream();
        if (!this.isResumingFromApproval) {
            await this.executeToolsIfNeeded();
        }
        return (this.currentState?.pendingToolCalls ?? []);
    }
    /**
     * Get the current conversation state.
     * Useful for inspection, debugging, or custom persistence.
     */
    async getState() {
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
//# sourceMappingURL=model-result.js.map