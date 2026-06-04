export { createLogger, logger } from './logger.js';
export { withRetry, parseRetryAfter, PermanentError, TemporaryError, } from './retry.js';
export { withRetry as retry } from './retry.js';
export { CircuitBreaker } from './circuit-breaker.js';
export { generateId, generateRequestId, generateApiKey, hashApiKey, encrypt, decrypt, encryptConfigApiKey, decryptConfigApiKey } from './crypto.js';
export { EventStream, parseOpenAISSE } from './event-stream.js';
export { ReusableReadableStream } from './reusable-stream.js';
export { DefaultHttpHooks, matchContentType, matchStatusCode, } from './http-hooks.js';
export { isConnectionError, isTimeoutError, isAbortError } from './error-classifiers.js';
export { 
// FP monad types
OK, ERR, unwrap, unwrapAsync, 
// Error classes
ResponseError, DefaultResponseError, ResponseValidationError, 
// HTTP matching (parameter-strict versions from the SDK)
matchContentTypeStrict, matchStatusCodeStrict, matchResponse, 
// Plain object check
isPlainObject, 
// Matcher factory functions
json, jsonErr, jsonl, jsonlErr, text, textErr, bytes, bytesErr, stream, streamErr, sse, sseErr, nil, nilErr, fail, 
// Core match function
match, unpackHeaders, } from './response-matcher.js';
export { HttpError, HttpErrorMap, createHttpError, BadRequestError, UnauthorizedError, PaymentRequiredError, ForbiddenError, NotFoundError, RequestTimeoutError, ConflictError, PayloadTooLargeError, UnprocessableEntityError, TooManyRequestsError, InternalServerError, BadGatewayError, ServiceUnavailableError, ProviderOverloadedError, EdgeNetworkTimeoutError, HttpClientError, UnexpectedClientError, InvalidRequestError, RequestAbortedError, ClientTimeoutError, ConnectionError, } from './http-errors.js';
// ---------------------------------------------------------------------------
// Stream type guards (Responses API event & output item discriminated unions)
// ---------------------------------------------------------------------------
export { 
// Event type guards
isOutputTextDeltaEvent, isReasoningDeltaEvent, isFunctionCallArgumentsDeltaEvent, isFunctionCallArgumentsDoneEvent, isOutputItemAddedEvent, isOutputItemDoneEvent, isResponseCompletedEvent, isResponseFailedEvent, isResponseIncompleteEvent, 
// Output item type guards
isOutputMessage, isFunctionCallItem, isReasoningOutputItem, isWebSearchCallOutputItem, isFileSearchCallOutputItem, isImageGenerationCallOutputItem, 
// Content part type guards
isOutputTextPart, isRefusalPart, 
// Annotation type guards
isFileCitationAnnotation, isURLCitationAnnotation, isFilePathAnnotation, } from './stream-type-guards.js';
// ---------------------------------------------------------------------------
// Stream transformers (async generators for consuming Responses API streams)
// ---------------------------------------------------------------------------
export { 
// Delta extractors
extractTextDeltas, extractReasoningDeltas, extractToolDeltas, 
// Message streams
buildResponsesMessageStream, buildMessageStream, buildItemsStream, buildToolCallStream, 
// Stream consumption
consumeStreamForCompletion, 
// Response helpers
extractMessageFromResponse, extractResponsesMessageFromResponse, extractTextFromResponse, extractToolCallsFromResponse, responseHasToolCalls, 
// Claude / Anthropic format conversion
convertToClaudeMessage, extractUnsupportedContent, hasUnsupportedContent, getUnsupportedContentSummary, 
// Constants
itemsStreamHandlers, streamTerminationEvents, } from './stream-transformers.js';
// ---------------------------------------------------------------------------
// Anthropic Claude message format <-> OpenResponses conversion
// ---------------------------------------------------------------------------
export { fromClaudeMessages, toClaudeMessage, } from './anthropic-compat.js';
// ---------------------------------------------------------------------------
// Stop conditions (composable predicates for agentic loop termination)
// ---------------------------------------------------------------------------
export { 
// Factory functions
stepCountIs, hasToolCall, isStopConditionMet, maxTokensUsed, maxCost, finishReasonIs, } from './stop-conditions.js';
// ---------------------------------------------------------------------------
// Conversation state management (multi-turn agentic loop state)
// ---------------------------------------------------------------------------
export { 
// State lifecycle
generateConversationId, createInitialState, updateState, appendToMessages, 
// Tool approval flow
toolRequiresApproval, partitionToolCalls, 
// Tool result creation
createUnsentResult, createRejectedResult, unsentResultsToAPIFormat, 
// Response extraction
extractTextFromResponse as extractConversationText, extractToolCallsFromResponse as extractConversationToolCalls, } from './conversation-state.js';
// ---------------------------------------------------------------------------
// SDK configuration (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { ServerProduction, ServerList, SDK_METADATA, serverURLFromOptions, } from './sdk-config.js';
// ---------------------------------------------------------------------------
// Next-turn parameter resolution (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { buildNextTurnParamsContext, executeNextTurnParamsFunctions, applyNextTurnParamsToRequest, } from './next-turn-params.js';
// ---------------------------------------------------------------------------
// Tool context store (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { SHARED_CONTEXT_KEY, ToolContextStore, buildToolExecuteContext, resolveContext, extractToolContext, } from './tool-context.js';
// ---------------------------------------------------------------------------
// Tool event broadcaster (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { ToolEventBroadcaster, } from './tool-event-broadcaster.js';
// ---------------------------------------------------------------------------
// Tool types (central type hub for tool execution system)
// ---------------------------------------------------------------------------
export { 
// Type guards
hasExecuteFunction, isGeneratorTool, isRegularExecuteTool, } from './tool-types.js';
// ---------------------------------------------------------------------------
// Tool factory (ergonomic tool() creation with 5 overloads)
// Ported from OpenRouter SDK's tool.ts
// ---------------------------------------------------------------------------
export { tool, ToolType, } from './tool-factory.js';
// ---------------------------------------------------------------------------
// Tool executor (individual tool execution with context)
// ---------------------------------------------------------------------------
export { executeTool, executeRegularTool, executeGeneratorTool, findToolByName, formatToolResultForModel, formatToolExecutionError, parseToolCallArguments, convertToolsToAPIFormat, convertZodToJsonSchema, sanitizeJsonSchema, } from './tool-executor.js';
// ---------------------------------------------------------------------------
// Turn context builder (context for each tool execution turn)
// ---------------------------------------------------------------------------
export { buildTurnContext, normalizeInputToArray, } from './turn-context.js';
// ---------------------------------------------------------------------------
// Tool orchestrator (multi-turn tool execution loop)
// ---------------------------------------------------------------------------
export { executeToolLoop, toolResultsToMap, summarizeToolExecutions, hasToolExecutionErrors, getToolExecutionErrors, } from './tool-orchestrator.js';
// ---------------------------------------------------------------------------
// Async parameter resolution (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { resolveAsyncFunctions, hasAsyncFunctions, } from './async-params.js';
// ---------------------------------------------------------------------------
// ModelResult orchestrator (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export { ModelResult, } from './model-result.js';
//# sourceMappingURL=index.js.map