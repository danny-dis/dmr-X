/**
 * Async generators for consuming Responses API SSE streams and extracting
 * structured content: text deltas, reasoning deltas, tool call deltas,
 * message streams, and items streams.
 *
 * Also provides utilities for converting Responses API results to Anthropic
 * Claude message format and extracting tool calls.
 *
 * Ported from OpenRouter SDK's stream-transformers.ts with adaptations for DMR-X.
 */

import type { ReusableReadableStream } from './reusable-stream.js';
import {
  isOutputTextDeltaEvent,
  isReasoningDeltaEvent,
  isFunctionCallArgumentsDeltaEvent,
  isOutputItemAddedEvent,
  isOutputItemDoneEvent,
  isResponseCompletedEvent,
  isResponseFailedEvent,
  isResponseIncompleteEvent,
  isFunctionCallArgumentsDoneEvent,
  isOutputMessage,
  isFunctionCallItem,
  isReasoningOutputItem,
  isWebSearchCallOutputItem,
  isFileSearchCallOutputItem,
  isImageGenerationCallOutputItem,
  isOutputTextPart,
  isRefusalPart,
  isFileCitationAnnotation,
  isURLCitationAnnotation,
  isFilePathAnnotation,
} from './stream-type-guards.js';
import type {
  StreamEvents,
  OpenResponsesResult,
  OutputMessage,
  OutputFunctionCallItem,
  OutputReasoningItem,
  OutputWebSearchCallItem,
  OutputFileSearchCallItem,
  OutputImageGenerationCallItem,
  FunctionCallOutputItem,
  OutputTextPart,
  OpenAIResponsesAnnotation,
} from './stream-type-guards.js';

// ---------------------------------------------------------------------------
// Local type definitions for types not yet in @dmr-x/core
// ---------------------------------------------------------------------------

/** Parsed tool call with structured arguments object (not JSON string). */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Anthropic-compatible text citation at a character location. */
export interface ClaudeCharLocationCitation {
  type: 'char_location';
  cited_text: string;
  document_index: number;
  document_title: string;
  file_id: string;
  start_char_index: number;
  end_char_index: number;
}

/** Anthropic-compatible citation pointing to a web search result. */
export interface ClaudeWebSearchResultCitation {
  type: 'web_search_result_location';
  cited_text: string;
  title: string;
  url: string;
  encrypted_index: string;
}

/** Union of Anthropic-compatible citation types. */
export type ClaudeTextCitation = ClaudeCharLocationCitation | ClaudeWebSearchResultCitation;

/** Anthropic-compatible text content block. */
export interface ClaudeTextBlock {
  type: 'text';
  text: string;
  citations?: ClaudeTextCitation[];
}

/** Anthropic-compatible tool use content block. */
export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Anthropic-compatible thinking content block. */
export interface ClaudeThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

/** Anthropic-compatible server tool use content block. */
export interface ClaudeServerToolUseBlock {
  type: 'server_tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Union of Anthropic-compatible content blocks. */
export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeThinkingBlock
  | ClaudeServerToolUseBlock;

/** Anthropic stop reasons. */
export type ClaudeStopReason = 'end_turn' | 'tool_use' | 'max_tokens';

/** Tracks content from the Responses API that has no direct Claude equivalent. */
export interface UnsupportedContent {
  original_type: string;
  data: Record<string, unknown>;
  reason: string;
}

/**
 * Anthropic-compatible message format produced by convertToClaudeMessage().
 * Compatible with the Anthropic SDK BetaMessage type.
 */
export interface ClaudeMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ClaudeContentBlock[];
  stop_reason: ClaudeStopReason | null;
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  unsupported_content?: UnsupportedContent[];
}

// ---------------------------------------------------------------------------
// Text / reasoning / tool-call delta extractors
// ---------------------------------------------------------------------------

/**
 * Extract text deltas from responses stream events.
 */
export async function* extractTextDeltas(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<string> {
  const consumer = stream.createConsumer();

  for await (const event of consumer) {
    if (isOutputTextDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}

/**
 * Extract reasoning deltas from responses stream events.
 */
export async function* extractReasoningDeltas(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<string> {
  const consumer = stream.createConsumer();

  for await (const event of consumer) {
    if (isReasoningDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}

/**
 * Extract tool call argument deltas from responses stream events.
 */
export async function* extractToolDeltas(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<string> {
  const consumer = stream.createConsumer();

  for await (const event of consumer) {
    if (isFunctionCallArgumentsDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core message stream builder (shared logic)
// ---------------------------------------------------------------------------

/**
 * Core message stream builder - shared logic for both formats.
 * Accumulates text deltas and yields updates.
 */
async function* buildMessageStreamCore(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<{
  type: 'delta' | 'complete';
  text?: string;
  messageId?: string;
  completeMessage?: OutputMessage;
}> {
  const consumer = stream.createConsumer();

  let currentText = '';
  let currentId = '';
  let hasStarted = false;

  for await (const event of consumer) {
    if (!('type' in event)) {
      continue;
    }

    switch (event.type) {
      case 'response.output_item.added': {
        if (isOutputItemAddedEvent(event)) {
          if (event.item && isOutputMessage(event.item)) {
            hasStarted = true;
            currentText = '';
            currentId = event.item.id;
          }
        }
        break;
      }

      case 'response.output_text.delta': {
        if (isOutputTextDeltaEvent(event)) {
          if (hasStarted && event.delta) {
            currentText += event.delta;
            yield {
              type: 'delta' as const,
              text: currentText,
              messageId: currentId,
            };
          }
        }
        break;
      }

      case 'response.output_item.done': {
        if (isOutputItemDoneEvent(event)) {
          if (event.item && isOutputMessage(event.item)) {
            yield {
              type: 'complete' as const,
              completeMessage: event.item,
            };
          }
        }
        break;
      }

      case 'response.completed':
      case 'response.failed':
      case 'response.incomplete':
        return;

      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Responses format message stream
// ---------------------------------------------------------------------------

/**
 * Build incremental message updates from responses stream events.
 * Returns OutputMessage (assistant/responses format).
 */
export async function* buildResponsesMessageStream(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<OutputMessage> {
  for await (const update of buildMessageStreamCore(stream)) {
    if (update.type === 'delta' && update.text !== undefined && update.messageId !== undefined) {
      yield {
        id: update.messageId,
        type: 'message' as const,
        role: 'assistant' as const,
        status: 'in_progress' as const,
        content: [
          {
            type: 'output_text' as const,
            text: update.text,
            annotations: [],
          },
        ],
      };
    } else if (update.type === 'complete' && update.completeMessage) {
      yield update.completeMessage;
    }
  }
}

// ---------------------------------------------------------------------------
// Items stream types and handlers
// ---------------------------------------------------------------------------

/** Output item types that can be streamed from a response. */
export type StreamableOutputItem =
  | OutputMessage
  | OutputFunctionCallItem
  | OutputReasoningItem
  | OutputWebSearchCallItem
  | OutputFileSearchCallItem
  | OutputImageGenerationCallItem
  | FunctionCallOutputItem;

/** Discriminated union for tracking items in progress. */
export type ItemInProgress =
  | { type: 'message'; id: string; textContent: string }
  | { type: 'function_call'; id: string; name: string; callId: string; argumentsAccumulated: string }
  | { type: 'reasoning'; id: string; reasoningContent: string };

/**
 * Handle output_item.added event - initialize tracking for new items.
 */
function handleOutputItemAdded(
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
): StreamableOutputItem | undefined {
  if (!isOutputItemAddedEvent(event) || !event.item) {
    return undefined;
  }

  const item = event.item;

  if (isOutputMessage(item)) {
    itemsInProgress.set(item.id, {
      type: 'message',
      id: item.id,
      textContent: '',
    });
    return {
      id: item.id,
      type: 'message' as const,
      role: 'assistant' as const,
      status: 'in_progress' as const,
      content: [],
    };
  }

  if (isFunctionCallItem(item)) {
    const itemKey = item.id ?? item.callId;
    itemsInProgress.set(itemKey, {
      type: 'function_call',
      id: itemKey,
      name: item.name,
      callId: item.callId,
      argumentsAccumulated: '',
    });
    return {
      type: 'function_call' as const,
      id: item.id,
      callId: item.callId,
      name: item.name,
      arguments: '',
      status: 'in_progress' as const,
    };
  }

  if (isReasoningOutputItem(item)) {
    itemsInProgress.set(item.id, {
      type: 'reasoning',
      id: item.id,
      reasoningContent: '',
    });
    return {
      type: 'reasoning' as const,
      id: item.id,
      status: 'in_progress' as const,
      summary: [],
    };
  }

  if (isWebSearchCallOutputItem(item)) {
    return item;
  }

  if (isFileSearchCallOutputItem(item)) {
    return item;
  }

  if (isImageGenerationCallOutputItem(item)) {
    return item;
  }

  return undefined;
}

/**
 * Handle text delta event for messages.
 */
function handleTextDelta(
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
): StreamableOutputItem | undefined {
  if (!isOutputTextDeltaEvent(event) || !event.delta) {
    return undefined;
  }

  const item = itemsInProgress.get(event.itemId);
  if (item?.type === 'message') {
    item.textContent += event.delta;
    return {
      id: item.id,
      type: 'message' as const,
      role: 'assistant' as const,
      status: 'in_progress' as const,
      content: [
        {
          type: 'output_text' as const,
          text: item.textContent,
          annotations: [],
        },
      ],
    };
  }

  return undefined;
}

/**
 * Handle function call argument delta event.
 */
function handleFunctionCallDelta(
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
): StreamableOutputItem | undefined {
  if (!isFunctionCallArgumentsDeltaEvent(event) || !event.delta) {
    return undefined;
  }

  const item = itemsInProgress.get(event.itemId);
  if (item?.type === 'function_call') {
    item.argumentsAccumulated += event.delta;
    return {
      type: 'function_call' as const,
      id: item.id !== item.callId ? item.id : undefined as unknown as string,
      callId: item.callId,
      name: item.name,
      arguments: item.argumentsAccumulated,
      status: 'in_progress' as const,
    };
  }

  return undefined;
}

/**
 * Handle reasoning text delta event.
 */
function handleReasoningDelta(
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
): StreamableOutputItem | undefined {
  if (!isReasoningDeltaEvent(event) || !event.delta) {
    return undefined;
  }

  const item = itemsInProgress.get(event.itemId);
  if (item?.type === 'reasoning') {
    item.reasoningContent += event.delta;
    return {
      type: 'reasoning' as const,
      id: item.id,
      status: 'in_progress' as const,
      summary: [
        {
          type: 'summary_text' as const,
          text: item.reasoningContent,
        },
      ],
    };
  }

  return undefined;
}

/**
 * Handle output_item.done event - yield final complete item.
 */
function handleOutputItemDone(
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
): StreamableOutputItem | undefined {
  if (!isOutputItemDoneEvent(event) || !event.item) {
    return undefined;
  }

  const item = event.item;

  if (isOutputMessage(item)) {
    itemsInProgress.delete(item.id);
    return item;
  }

  if (isFunctionCallItem(item)) {
    itemsInProgress.delete(item.id ?? item.callId);
    return item;
  }

  if (isReasoningOutputItem(item)) {
    itemsInProgress.delete(item.id);
    return item;
  }

  if (isWebSearchCallOutputItem(item)) {
    return item;
  }

  if (isFileSearchCallOutputItem(item)) {
    return item;
  }

  if (isImageGenerationCallOutputItem(item)) {
    return item;
  }

  return undefined;
}

type ItemsStreamHandler = (
  event: unknown,
  itemsInProgress: Map<string, ItemInProgress>,
) => StreamableOutputItem | undefined;

/** Maps stream event types to their handler functions. */
export const itemsStreamHandlers: Record<string, ItemsStreamHandler> = {
  'response.output_item.added': handleOutputItemAdded,
  'response.output_text.delta': handleTextDelta,
  'response.function_call_arguments.delta': handleFunctionCallDelta,
  'response.reasoning_text.delta': handleReasoningDelta,
  'response.output_item.done': handleOutputItemDone,
};

/** Event types that signal the stream has terminated. */
export const streamTerminationEvents = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
]);

// ---------------------------------------------------------------------------
// Items stream builder
// ---------------------------------------------------------------------------

/**
 * Build incremental output item updates from responses stream events.
 * Yields all item types cumulatively - the same item may be emitted multiple
 * times with the same ID but progressively updated content as streaming progresses.
 */
export async function* buildItemsStream(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<StreamableOutputItem> {
  const consumer = stream.createConsumer();
  const itemsInProgress = new Map<string, ItemInProgress>();

  for await (const event of consumer) {
    if (!('type' in event)) {
      continue;
    }

    if (streamTerminationEvents.has(event.type)) {
      return;
    }

    const handler = itemsStreamHandlers[event.type];
    if (handler) {
      const result = handler(event, itemsInProgress);
      if (result) {
        yield result;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chat format message stream
// ---------------------------------------------------------------------------

/**
 * Convert OutputMessage to ChatAssistantMessage (chat format).
 */
function convertToAssistantMessage(
  outputMessage: OutputMessage,
): { role: 'assistant'; content: string | null } {
  const textContent = outputMessage.content
    .filter(
      (part): part is OutputTextPart => 'type' in part && part.type === 'output_text',
    )
    .map((part) => part.text)
    .join('');

  return {
    role: 'assistant' as const,
    content: textContent || null,
  };
}

/**
 * Build incremental message updates from responses stream events.
 * Returns chat-format assistant messages instead of OutputMessage.
 */
export async function* buildMessageStream(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<{ role: 'assistant'; content: string | null }> {
  for await (const update of buildMessageStreamCore(stream)) {
    if (update.type === 'delta' && update.text !== undefined) {
      yield {
        role: 'assistant' as const,
        content: update.text,
      };
    } else if (update.type === 'complete' && update.completeMessage) {
      yield convertToAssistantMessage(update.completeMessage);
    }
  }
}

// ---------------------------------------------------------------------------
// Stream consumption helpers
// ---------------------------------------------------------------------------

/**
 * Consume stream until completion and return the complete response.
 */
export async function consumeStreamForCompletion(
  stream: ReusableReadableStream<StreamEvents>,
): Promise<OpenResponsesResult> {
  const consumer = stream.createConsumer();

  for await (const event of consumer) {
    if (!('type' in event)) {
      continue;
    }

    if (isResponseCompletedEvent(event)) {
      return event.response;
    }

    if (isResponseFailedEvent(event)) {
      throw new Error(`Response failed: ${JSON.stringify(event.response.error)}`);
    }

    if (isResponseIncompleteEvent(event)) {
      return event.response;
    }
  }

  throw new Error('Stream ended without completion event');
}

// ---------------------------------------------------------------------------
// Response extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first message from a completed response (chat format).
 */
export function extractMessageFromResponse(
  response: OpenResponsesResult,
): { role: 'assistant'; content: string | null } {
  const messageItem = response.output.find(
    (item): item is OutputMessage => 'type' in item && item.type === 'message',
  );

  if (!messageItem) {
    throw new Error('No message found in response output');
  }

  return convertToAssistantMessage(messageItem);
}

/**
 * Extract the first message from a completed response (responses format).
 */
export function extractResponsesMessageFromResponse(
  response: OpenResponsesResult,
): OutputMessage {
  const messageItem = response.output.find(
    (item): item is OutputMessage => 'type' in item && item.type === 'message',
  );

  if (!messageItem) {
    throw new Error('No message found in response output');
  }

  return messageItem;
}

/**
 * Extract text from a response, either from outputText or by concatenating
 * message content.
 */
export function extractTextFromResponse(response: OpenResponsesResult): string {
  if (response.outputText) {
    return response.outputText;
  }

  const hasMessage = response.output.some(
    (item): item is OutputMessage => 'type' in item && item.type === 'message',
  );

  if (!hasMessage) {
    return '';
  }

  const message = extractMessageFromResponse(response);

  if (typeof message.content === 'string') {
    return message.content;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Tool call extraction
// ---------------------------------------------------------------------------

/**
 * Extract all tool calls from a completed response.
 * Returns parsed tool calls with arguments as objects (not JSON strings).
 */
export function extractToolCallsFromResponse(
  response: OpenResponsesResult,
): ParsedToolCall[] {
  const toolCalls: ParsedToolCall[] = [];

  for (const item of response.output) {
    if (isFunctionCallItem(item)) {
      try {
        const trimmedArgs = item.arguments.trim();
        const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};

        toolCalls.push({
          id: item.callId,
          name: item.name,
          arguments: parsedArguments,
        });
      } catch (error) {
        console.warn(
          `Failed to parse tool call arguments for ${item.name}:`,
          error instanceof Error ? error.message : String(error),
          `\nArguments: ${item.arguments.substring(0, 100)}${item.arguments.length > 100 ? '...' : ''}`,
        );
        toolCalls.push({
          id: item.callId,
          name: item.name,
          arguments: { _raw_arguments: item.arguments } as Record<string, unknown>,
        });
      }
    }
  }

  return toolCalls;
}

/**
 * Build incremental tool call updates from responses stream events.
 * Yields structured tool call objects as they are built from deltas.
 */
export async function* buildToolCallStream(
  stream: ReusableReadableStream<StreamEvents>,
): AsyncIterableIterator<ParsedToolCall> {
  const consumer = stream.createConsumer();

  const toolCallsInProgress = new Map<
    string,
    { id: string; name: string; argumentsAccumulated: string }
  >();

  for await (const event of consumer) {
    if (!('type' in event)) {
      continue;
    }

    switch (event.type) {
      case 'response.output_item.added': {
        if (isOutputItemAddedEvent(event) && event.item && isFunctionCallItem(event.item)) {
          const itemKey = event.item.id ?? event.item.callId;
          toolCallsInProgress.set(itemKey, {
            id: event.item.callId,
            name: event.item.name,
            argumentsAccumulated: '',
          });
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        if (isFunctionCallArgumentsDeltaEvent(event)) {
          const toolCall = toolCallsInProgress.get(event.itemId);
          if (toolCall && event.delta) {
            toolCall.argumentsAccumulated += event.delta;
          }
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        if (isFunctionCallArgumentsDoneEvent(event)) {
          const toolCall = toolCallsInProgress.get(event.itemId);

          if (toolCall) {
            try {
              const trimmedArgs = event.arguments.trim();
              const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};
              yield {
                id: toolCall.id,
                name: event.name,
                arguments: parsedArguments,
              };
            } catch (error) {
              console.warn(
                `Failed to parse tool call arguments for ${event.name}:`,
                error instanceof Error ? error.message : String(error),
                `\nArguments: ${event.arguments.substring(0, 100)}${event.arguments.length > 100 ? '...' : ''}`,
              );
              yield {
                id: toolCall.id,
                name: event.name,
                arguments: { _raw_arguments: event.arguments } as Record<string, unknown>,
              };
            }

            toolCallsInProgress.delete(event.itemId);
          }
        }
        break;
      }

      case 'response.output_item.done': {
        if (isOutputItemDoneEvent(event) && event.item && isFunctionCallItem(event.item)) {
          const itemKey = event.item.id ?? event.item.callId;
          if (toolCallsInProgress.has(itemKey)) {
            try {
              const trimmedArgs = event.item.arguments.trim();
              const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};
              yield {
                id: event.item.callId,
                name: event.item.name,
                arguments: parsedArguments,
              };
            } catch {
              yield {
                id: event.item.callId,
                name: event.item.name,
                arguments: { _raw_arguments: event.item.arguments } as Record<string, unknown>,
              };
            }

            toolCallsInProgress.delete(itemKey);
          }
        }
        break;
      }
    }
  }
}

/**
 * Check if a response contains any tool calls.
 */
export function responseHasToolCalls(response: OpenResponsesResult): boolean {
  return response.output.some((item) => 'type' in item && item.type === 'function_call');
}

// ---------------------------------------------------------------------------
// Anthropic / Claude format conversion
// ---------------------------------------------------------------------------

/**
 * Convert OpenRouter annotations to Claude citations.
 */
function mapAnnotationsToCitations(
  annotations?: OpenAIResponsesAnnotation[],
): ClaudeTextCitation[] | undefined {
  if (!annotations || annotations.length === 0) {
    return undefined;
  }

  const citations: ClaudeTextCitation[] = [];

  for (const annotation of annotations) {
    if (!('type' in annotation)) {
      continue;
    }

    switch (annotation.type) {
      case 'file_citation': {
        if (isFileCitationAnnotation(annotation)) {
          citations.push({
            type: 'char_location',
            cited_text: '',
            document_index: annotation.index,
            document_title: annotation.filename,
            file_id: annotation.fileId,
            start_char_index: 0,
            end_char_index: 0,
          });
        }
        break;
      }

      case 'url_citation': {
        if (isURLCitationAnnotation(annotation)) {
          citations.push({
            type: 'web_search_result_location',
            cited_text: '',
            title: annotation.title,
            url: annotation.url,
            encrypted_index: '',
          });
        }
        break;
      }

      case 'file_path': {
        if (isFilePathAnnotation(annotation)) {
          citations.push({
            type: 'char_location',
            cited_text: '',
            document_index: annotation.index,
            document_title: '',
            file_id: annotation.fileId,
            start_char_index: 0,
            end_char_index: 0,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return citations.length > 0 ? citations : undefined;
}

/**
 * Map OpenResponses status to Claude stop reason.
 */
function mapStopReason(response: OpenResponsesResult): ClaudeStopReason | null {
  const hasToolCalls = response.output.some(
    (item) => 'type' in item && item.type === 'function_call',
  );

  if (hasToolCalls) {
    return 'tool_use';
  }

  if (response.status === 'completed') {
    return 'end_turn';
  }

  if (response.status === 'incomplete') {
    const incompleteReason = response.incompleteDetails?.reason;
    if (incompleteReason === 'max_output_tokens') {
      return 'max_tokens';
    }
    return 'end_turn';
  }

  return 'end_turn';
}

/**
 * Convert OpenResponsesResult to ClaudeMessage format.
 * Compatible with the Anthropic SDK BetaMessage type.
 */
export function convertToClaudeMessage(response: OpenResponsesResult): ClaudeMessage {
  const content: ClaudeContentBlock[] = [];
  const unsupportedContent: UnsupportedContent[] = [];

  for (const item of response.output) {
    if (!('type' in item)) {
      const itemData = typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>)
        : { value: item };
      unsupportedContent.push({
        original_type: 'unknown',
        data: itemData,
        reason: 'Output item missing type field',
      });
      continue;
    }

    switch (item.type) {
      case 'message': {
        if (isOutputMessage(item)) {
          for (const part of item.content) {
            if (!('type' in part)) {
              const partData = typeof part === 'object' && part !== null
                ? (part as Record<string, unknown>)
                : { value: part };
              unsupportedContent.push({
                original_type: 'unknown_message_part',
                data: partData,
                reason: 'Message content part missing type field',
              });
              continue;
            }

            if (isOutputTextPart(part)) {
              const citations = mapAnnotationsToCitations(part.annotations);
              content.push({
                type: 'text',
                text: part.text,
                ...(citations && { citations }),
              });
            } else if (isRefusalPart(part)) {
              unsupportedContent.push({
                original_type: 'refusal',
                data: { refusal: part.refusal } as Record<string, unknown>,
                reason: 'Claude does not have a native refusal content type',
              });
            }
          }
        }
        break;
      }

      case 'function_call': {
        if (isFunctionCallItem(item)) {
          let parsedInput: Record<string, unknown>;

          try {
            const trimmedArgs = item.arguments.trim();
            parsedInput = trimmedArgs ? JSON.parse(trimmedArgs) : {};
          } catch (error) {
            console.warn(
              `Failed to parse tool call arguments for ${item.name}:`,
              error instanceof Error ? error.message : String(error),
              `\nArguments: ${item.arguments.substring(0, 100)}${item.arguments.length > 100 ? '...' : ''}`,
            );
            parsedInput = { _raw_arguments: item.arguments };
          }

          content.push({
            type: 'tool_use',
            id: item.callId,
            name: item.name,
            input: parsedInput,
          });
        }
        break;
      }

      case 'reasoning': {
        if (isReasoningOutputItem(item)) {
          if (item.summary && item.summary.length > 0) {
            for (const summaryItem of item.summary) {
              if (summaryItem.type === 'summary_text' && summaryItem.text) {
                content.push({
                  type: 'thinking',
                  thinking: summaryItem.text,
                  signature: '',
                });
              }
            }
          }

          if (item.encryptedContent) {
            unsupportedContent.push({
              original_type: 'reasoning_encrypted',
              data: {
                id: item.id,
                encrypted_content: item.encryptedContent,
              } as Record<string, unknown>,
              reason: 'Encrypted reasoning content preserved for round-trip',
            });
          }
        }
        break;
      }

      case 'web_search_call': {
        if (isWebSearchCallOutputItem(item)) {
          content.push({
            type: 'server_tool_use',
            id: item.id,
            name: 'web_search',
            input: { status: item.status },
          });
        }
        break;
      }

      case 'file_search_call': {
        if (isFileSearchCallOutputItem(item)) {
          content.push({
            type: 'tool_use',
            id: item.id,
            name: 'file_search',
            input: { queries: item.queries, status: item.status },
          });
        }
        break;
      }

      case 'image_generation_call': {
        if (isImageGenerationCallOutputItem(item)) {
          unsupportedContent.push({
            original_type: 'image_generation_call',
            data: { id: item.id, result: item.result, status: item.status } as Record<
              string,
              unknown
            >,
            reason: 'Claude does not support image outputs in assistant messages',
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model ?? 'unknown',
    content,
    stop_reason: mapStopReason(response),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      cache_creation_input_tokens: response.usage?.inputTokensDetails?.cachedTokens ?? 0,
      cache_read_input_tokens: 0,
    },
    ...(unsupportedContent.length > 0 && {
      unsupported_content: unsupportedContent,
    }),
  };
}

/**
 * Extract unsupported content by original type.
 */
export function extractUnsupportedContent(
  message: ClaudeMessage,
  originalType: string,
): UnsupportedContent[] {
  if (!message.unsupported_content) {
    return [];
  }

  return message.unsupported_content.filter((item) => item.original_type === originalType);
}

/**
 * Check if message has any unsupported content.
 */
export function hasUnsupportedContent(message: ClaudeMessage): boolean {
  return !!(message.unsupported_content && message.unsupported_content.length > 0);
}

/**
 * Get summary of unsupported content types.
 */
export function getUnsupportedContentSummary(message: ClaudeMessage): Record<string, number> {
  if (!message.unsupported_content) {
    return {};
  }

  const summary: Record<string, number> = {};
  for (const item of message.unsupported_content) {
    summary[item.original_type] = (summary[item.original_type] || 0) + 1;
  }

  return summary;
}
