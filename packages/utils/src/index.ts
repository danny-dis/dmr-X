export { createLogger, logger } from './logger.js';
export {
  withRetry,
  parseRetryAfter,
  PermanentError,
  TemporaryError,
  type RetryOptions,
  type RetryConfig,
  type BackoffStrategy,
} from './retry.js';
export { retry } from './retries.js';
export { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js';
export { generateId, generateRequestId, generateApiKey, hashApiKey, encrypt, decrypt, encryptConfigApiKey, decryptConfigApiKey } from './crypto.js';
export { EventStream, parseOpenAISSE, type SseMessage } from './event-stream.js';
export { ReusableReadableStream } from './reusable-stream.js';
export {
  DefaultHttpHooks,
  matchContentType,
  matchStatusCode,
  type HttpHooks,
  type BeforeRequestHook,
  type AfterSuccessHook,
  type AfterErrorHook,
  type BeforeRequestContext,
  type AfterSuccessContext,
  type AfterErrorContext,
} from './http-hooks.js';
export { isConnectionError, isTimeoutError, isAbortError } from './error-classifiers.js';
export {
  // FP monad types
  OK,
  ERR,
  unwrap,
  unwrapAsync,
  type Result,
  // Error classes
  ResponseError,
  DefaultResponseError,
  ResponseValidationError,
  // HTTP matching (parameter-strict versions from the SDK)
  matchContentTypeStrict,
  matchStatusCodeStrict,
  matchResponse,
  // Plain object check
  isPlainObject,
  // Matcher factory functions
  json,
  jsonErr,
  jsonl,
  jsonlErr,
  text,
  textErr,
  bytes,
  bytesErr,
  stream,
  streamErr,
  sse,
  sseErr,
  nil,
  nilErr,
  fail,
  // Core match function
  match,
  unpackHeaders,
  // Types
  type Encoding,
  type StatusCodePredicate,
  type ValueMatcher,
  type ErrorMatcher,
  type FailMatcher,
  type Matcher,
  type MatchFunc,
  type MatchedValue,
  type MatchedError,
} from './response-matcher.js';
export {
  HttpError,
  HttpErrorMap,
  createHttpError,
  BadRequestError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  RequestTimeoutError,
  ConflictError,
  PayloadTooLargeError,
  UnprocessableEntityError,
  TooManyRequestsError,
  InternalServerError,
  BadGatewayError,
  ServiceUnavailableError,
  ProviderOverloadedError,
  EdgeNetworkTimeoutError,
  HttpClientError,
  UnexpectedClientError,
  InvalidRequestError,
  RequestAbortedError,
  ClientTimeoutError,
  ConnectionError,
  type HttpMeta,
  type HttpErrorData,
} from './http-errors.js';

// ---------------------------------------------------------------------------
// Stream type guards (Responses API event & output item discriminated unions)
// ---------------------------------------------------------------------------
export {
  // Event type guards
  isOutputTextDeltaEvent,
  isReasoningDeltaEvent,
  isFunctionCallArgumentsDeltaEvent,
  isFunctionCallArgumentsDoneEvent,
  isOutputItemAddedEvent,
  isOutputItemDoneEvent,
  isResponseCompletedEvent,
  isResponseFailedEvent,
  isResponseIncompleteEvent,
  // Output item type guards
  isOutputMessage,
  isFunctionCallItem,
  isReasoningOutputItem,
  isWebSearchCallOutputItem,
  isFileSearchCallOutputItem,
  isImageGenerationCallOutputItem,
  // Content part type guards
  isOutputTextPart,
  isRefusalPart,
  // Annotation type guards
  isFileCitationAnnotation,
  isURLCitationAnnotation,
  isFilePathAnnotation,
  // Types
  type StreamEvents,
  type OpenResponsesResult,
  type OutputMessage,
  type OutputFunctionCallItem,
  type OutputReasoningItem,
  type OutputWebSearchCallItem,
  type OutputFileSearchCallItem,
  type OutputImageGenerationCallItem,
  type FunctionCallOutputItem,
  type OutputTextPart,
  type RefusalPart,
  type OutputContentPart,
  type OutputItem,
  type OpenAIResponsesAnnotation,
  type FileCitationAnnotation,
  type URLCitationAnnotation,
  type FilePathAnnotation,
  type ChatAssistantMessage,
  type OutputTextDeltaEvent,
  type ReasoningDeltaEvent,
  type FunctionCallArgumentsDeltaEvent,
  type FunctionCallArgumentsDoneEvent,
  type OutputItemAddedEvent,
  type OutputItemDoneEvent,
  type ResponseCompletedEvent,
  type ResponseFailedEvent,
  type ResponseIncompleteEvent,
} from './stream-type-guards.js';

// ---------------------------------------------------------------------------
// Stream transformers (async generators for consuming Responses API streams)
// ---------------------------------------------------------------------------
export {
  // Delta extractors
  extractTextDeltas,
  extractReasoningDeltas,
  extractToolDeltas,
  // Message streams
  buildResponsesMessageStream,
  buildMessageStream,
  buildItemsStream,
  buildToolCallStream,
  // Stream consumption
  consumeStreamForCompletion,
  // Response helpers
  extractMessageFromResponse,
  extractResponsesMessageFromResponse,
  extractTextFromResponse,
  extractToolCallsFromResponse,
  responseHasToolCalls,
  // Claude / Anthropic format conversion
  convertToClaudeMessage,
  extractUnsupportedContent,
  hasUnsupportedContent,
  getUnsupportedContentSummary,
  // Constants
  itemsStreamHandlers,
  streamTerminationEvents,
  // Types
  type ParsedToolCall,
  type ClaudeMessage,
  type ClaudeContentBlock,
  type ClaudeTextBlock,
  type ClaudeToolUseBlock,
  type ClaudeThinkingBlock,
  type ClaudeServerToolUseBlock,
  type ClaudeStopReason,
  type ClaudeTextCitation,
  type ClaudeCharLocationCitation,
  type ClaudeWebSearchResultCitation,
  type UnsupportedContent,
  type StreamableOutputItem,
  type ItemInProgress,
} from './stream-transformers.js';

// ---------------------------------------------------------------------------
// Anthropic Claude message format <-> OpenResponses conversion
// ---------------------------------------------------------------------------
export {
  fromClaudeMessages,
  toClaudeMessage,
  // Types
  type ClaudeMessageParam,
  type ClaudeTextBlockParam,
  type ClaudeImageBlockParam,
  type ClaudeToolUseBlockParam,
  type ClaudeToolResultBlockParam,
  type EasyInputMessage,
  type InputMessageItem,
  type FunctionCallItem,
  type InputText,
  type InputImage,
  type InputsUnion,
} from './anthropic-compat.js';

// ---------------------------------------------------------------------------
// Stop conditions (composable predicates for agentic loop termination)
// ---------------------------------------------------------------------------
export {
  // Factory functions
  stepCountIs,
  hasToolCall,
  isStopConditionMet,
  maxTokensUsed,
  maxCost,
  finishReasonIs,
  // Types
  type StepResult,
  type StopCondition,
  type Tool as StopConditionTool,
} from './stop-conditions.js';

// ---------------------------------------------------------------------------
// Conversation state management (multi-turn agentic loop state)
// ---------------------------------------------------------------------------
export {
  // State lifecycle
  generateConversationId,
  createInitialState,
  updateState,
  appendToMessages,
  // Tool approval flow
  toolRequiresApproval,
  partitionToolCalls,
  // Tool result creation
  createUnsentResult,
  createRejectedResult,
  unsentResultsToAPIFormat,
  // Response extraction
  extractTextFromResponse as extractConversationText,
  extractToolCallsFromResponse as extractConversationToolCalls,
  // Types
  type ParsedToolCall as ConversationParsedToolCall,
  type Tool as ConversationTool,
  type TurnContext,
  type UnsentToolResult,
  type ConversationState,
} from './conversation-state.js';

// ---------------------------------------------------------------------------
// SDK configuration (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  ServerProduction,
  ServerList,
  SDK_METADATA,
  serverURLFromOptions,
  type SDKOptions,
  type HTTPClient,
  type Logger,
} from './sdk-config.js';

// ---------------------------------------------------------------------------
// Next-turn parameter resolution (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  buildNextTurnParamsContext,
  executeNextTurnParamsFunctions,
  applyNextTurnParamsToRequest,
  type NextTurnParamsContext,
  type ParsedToolCall as NextTurnParsedToolCall,
  type ToolDefinition,
  type NextTurnRequest,
} from './next-turn-params.js';

// ---------------------------------------------------------------------------
// Tool context store (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  SHARED_CONTEXT_KEY,
  ToolContextStore,
  buildToolExecuteContext,
  resolveContext,
  extractToolContext,
  type TurnContext as ToolContextTurnContext,
  type ToolExecuteContext,
  type ContextInput,
  type ContextSchema,
} from './tool-context.js';

// ---------------------------------------------------------------------------
// Tool event broadcaster (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  ToolEventBroadcaster,
} from './tool-event-broadcaster.js';

// ---------------------------------------------------------------------------
// Tool types (central type hub for tool execution system)
// ---------------------------------------------------------------------------
export {
  // Type guards
  hasExecuteFunction,
  isGeneratorTool,
  isRegularExecuteTool,
  // Types
  type Tool,
  type APITool,
  type ToolExecutionResult,
} from './tool-types.js';

// ---------------------------------------------------------------------------
// Tool factory (ergonomic tool() creation with 5 overloads)
// Ported from OpenRouter SDK's tool.ts
// ---------------------------------------------------------------------------
export {
  tool,
  ToolType,
  type ToolWithExecute,
  type ToolWithGenerator,
  type ManualTool,
  type NextTurnParamsFunctions,
  type ToolApprovalCheck,
  type Tool as EnhancedTool,
} from './tool-factory.js';

// ---------------------------------------------------------------------------
// Tool executor (individual tool execution with context)
// ---------------------------------------------------------------------------
export {
  executeTool,
  executeRegularTool,
  executeGeneratorTool,
  findToolByName,
  formatToolResultForModel,
  formatToolExecutionError,
  parseToolCallArguments,
  convertToolsToAPIFormat,
  convertZodToJsonSchema,
  sanitizeJsonSchema,
} from './tool-executor.js';

// ---------------------------------------------------------------------------
// Turn context builder (context for each tool execution turn)
// ---------------------------------------------------------------------------
export {
  buildTurnContext,
  normalizeInputToArray,
  type BuildTurnContextOptions,
} from './turn-context.js';

// ---------------------------------------------------------------------------
// Tool orchestrator (multi-turn tool execution loop)
// ---------------------------------------------------------------------------
export {
  executeToolLoop,
  toolResultsToMap,
  summarizeToolExecutions,
  hasToolExecutionErrors,
  getToolExecutionErrors,
  type ToolExecutionOptions,
  type ToolOrchestrationResult,
} from './tool-orchestrator.js';

// ---------------------------------------------------------------------------
// Async parameter resolution (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  resolveAsyncFunctions,
  hasAsyncFunctions,
  type FieldOrAsyncFunction,
  type CallModelInput,
  type CallModelInputWithState,
  type ResolvedCallModelInput,
  type StateAccessor,
  type ToolContextMapWithShared,
  type StopWhen,
} from './async-params.js';

// ---------------------------------------------------------------------------
// ModelResult orchestrator (ported from OpenRouter SDK)
// ---------------------------------------------------------------------------
export {
  ModelResult,
  type ApiClient,
  type ResponsesRequest,
  type RequestOptions,
  type BetaResponsesResult,
  type BetaResponsesSendFn,
  type ModelStateAccessor,
  type GetResponseOptions,
  type ResponseStreamEvent,
  type TurnStartEvent,
  type TurnEndEvent,
  type ToolResultEvent,
  type ToolPreliminaryResultEvent,
  type ToolCallOutputEvent,
  type ToolStreamEvent,
  type BaseInputsUnion,
} from './model-result.js';
