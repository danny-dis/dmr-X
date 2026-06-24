/**
 * Conversation state management for multi-turn agentic loops.
 *
 * Provides utilities for creating, updating, and querying conversation state,
 * including tool approval flow helpers and response extraction.
 *
 * Ported from OpenRouter SDK's conversation-state.ts with adaptations for DMR-X.
 */

import type {
  FunctionCallOutputItem,
  OpenResponsesResult,
} from './stream-type-guards.js';
import type { TurnContext } from './tool-context.js';
export type { TurnContext } from './tool-context.js';

// ---------------------------------------------------------------------------
// Local type definitions for types not yet in @dmr-x/core/tool-types
// ---------------------------------------------------------------------------

/** A parsed tool call with structured arguments. */
export interface ParsedToolCall<TTool extends Tool = Tool> {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Minimal tool definition with approval support. */
export interface Tool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
    readonly inputSchema?: unknown;
    readonly requireApproval?:
      | boolean
      | ((args: unknown, context: TurnContext) => boolean | Promise<boolean>);
  };
}

/** A tool result not yet sent to the model. */
export interface UnsentToolResult<TTools extends readonly Tool[] = readonly Tool[]> {
  callId: string;
  name: string;
  output: unknown;
  error?: string;
}

/** Queue delivery mode. */
export type QueueMode = 'all' | 'one-at-a-time';

/** A message queued for steering or follow-up. */
export interface QueuedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

/** Conversation state tracking. */
export interface ConversationState<TTools extends readonly Tool[] = readonly Tool[]> {
  id: string;
  messages: Record<string, unknown>[];
  status: 'in_progress' | 'completed' | 'error' | 'awaiting_approval' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  /** ID of the signal that interrupted execution. */
  interruptedBy?: string;
  /** Tool calls awaiting user approval. */
  pendingToolCalls?: ParsedToolCall<TTools[number]>[];
  /** Tool results not yet sent to the model. */
  unsentToolResults?: UnsentToolResult<TTools>[];
  /** Partial response captured at interruption. */
  partialResponse?: { text: string; toolCalls: ParsedToolCall[] };
  /** Steering messages injected during execution (after current tool batch). */
  steeringQueue?: QueuedMessage[];
  /** Follow-up messages processed after agent enters idle state. */
  followUpQueue?: QueuedMessage[];
  /** How to drain steering messages: 'all' drains at once, 'one-at-a-time' drains one per turn. */
  steeringMode?: QueueMode;
  /** How to drain follow-up messages. */
  followUpMode?: QueueMode;
}

/** Input that can be a single item or an array. */
type InputsUnion = BaseInputsUnion | BaseInputsUnion[];

/** Base type for input items (messages). */
type BaseInputsUnion = Record<string, unknown>;

/** Extended FunctionCallOutputItem with optional id field for API format. */
interface FunctionCallOutputItemWithId extends FunctionCallOutputItem {
  id?: string;
}

// ---------------------------------------------------------------------------
// Local utility (replaces import from ./turn-context.js)
// ---------------------------------------------------------------------------

/** Normalize input to an array. */
function normalizeInputToArray(input: InputsUnion): BaseInputsUnion[] {
  return Array.isArray(input) ? input : [input];
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

/**
 * Type guard to verify an object is a valid UnsentToolResult.
 */
function isValidUnsentToolResult<TTools extends readonly Tool[]>(
  obj: unknown,
): obj is UnsentToolResult<TTools> {
  if (typeof obj !== 'object' || obj === null) return false;
  return (
    'callId' in obj &&
    typeof obj.callId === 'string' &&
    'name' in obj &&
    typeof obj.name === 'string' &&
    'output' in obj
  );
}

/**
 * Type guard to verify an object is a valid ParsedToolCall.
 */
function isValidParsedToolCall<TTools extends readonly Tool[]>(
  obj: unknown,
): obj is ParsedToolCall<TTools[number]> {
  if (typeof obj !== 'object' || obj === null) return false;
  return (
    'id' in obj &&
    typeof obj.id === 'string' &&
    'name' in obj &&
    typeof obj.name === 'string' &&
    'arguments' in obj
  );
}

// ---------------------------------------------------------------------------
// Conversation state management
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID for a conversation.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
export function generateConversationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `conv_${crypto.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create an initial conversation state.
 * @param id - Optional custom ID, generates one if not provided.
 */
export function createInitialState<TTools extends readonly Tool[] = readonly Tool[]>(
  id?: string,
): ConversationState<TTools> {
  const now = Date.now();
  return {
    id: id ?? generateConversationId(),
    messages: [],
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a conversation state with new values.
 * Automatically updates the updatedAt timestamp.
 */
export function updateState<TTools extends readonly Tool[] = readonly Tool[]>(
  state: ConversationState<TTools>,
  updates: Partial<Omit<ConversationState<TTools>, 'id' | 'createdAt' | 'updatedAt'>>,
): ConversationState<TTools> {
  return {
    ...state,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Append new items to the message history.
 */
export function appendToMessages(
  current: InputsUnion,
  newItems: BaseInputsUnion[],
): InputsUnion {
  const currentArray = normalizeInputToArray(current);
  return [...currentArray, ...newItems];
}

// ---------------------------------------------------------------------------
// Tool approval flow
// ---------------------------------------------------------------------------

/**
 * Check if a tool call requires approval.
 * @param toolCall - The tool call to check.
 * @param tools - Available tools.
 * @param context - Turn context for the approval check.
 * @param callLevelCheck - Optional call-level approval function (overrides tool-level), can be async.
 */
export async function toolRequiresApproval<TTools extends readonly Tool[]>(
  toolCall: ParsedToolCall<TTools[number]>,
  tools: TTools,
  context: TurnContext,
  callLevelCheck?: (
    toolCall: ParsedToolCall<TTools[number]>,
    context: TurnContext,
  ) => boolean | Promise<boolean>,
): Promise<boolean> {
  // Call-level check takes precedence
  if (callLevelCheck) {
    return callLevelCheck(toolCall, context);
  }

  // Fall back to tool-level setting
  const tool = tools.find((t) => t.function.name === toolCall.name);
  if (!tool) return false;

  const requireApproval = tool.function.requireApproval;

  // If it's a function, call it with the tool's arguments and context
  if (typeof requireApproval === 'function') {
    return requireApproval(toolCall.arguments, context);
  }

  // Otherwise treat as boolean
  return requireApproval ?? false;
}

/**
 * Partition tool calls into those requiring approval and those that can auto-execute.
 * @param toolCalls - Tool calls to partition.
 * @param tools - Available tools.
 * @param context - Turn context for the approval check.
 * @param callLevelCheck - Optional call-level approval function (overrides tool-level), can be async.
 */
export async function partitionToolCalls<TTools extends readonly Tool[]>(
  toolCalls: ParsedToolCall<TTools[number]>[],
  tools: TTools,
  context: TurnContext,
  callLevelCheck?: (
    toolCall: ParsedToolCall<TTools[number]>,
    context: TurnContext,
  ) => boolean | Promise<boolean>,
): Promise<{
  requiresApproval: ParsedToolCall<TTools[number]>[];
  autoExecute: ParsedToolCall<TTools[number]>[];
}> {
  const requiresApproval: ParsedToolCall<TTools[number]>[] = [];
  const autoExecute: ParsedToolCall<TTools[number]>[] = [];

  for (const tc of toolCalls) {
    if (await toolRequiresApproval(tc, tools, context, callLevelCheck)) {
      requiresApproval.push(tc);
    } else {
      autoExecute.push(tc);
    }
  }

  return { requiresApproval, autoExecute };
}

// ---------------------------------------------------------------------------
// Tool result creation
// ---------------------------------------------------------------------------

/**
 * Create an unsent tool result from a successful execution.
 */
export function createUnsentResult<TTools extends readonly Tool[] = readonly Tool[]>(
  callId: string,
  name: string,
  output: unknown,
): UnsentToolResult<TTools> {
  const result = { callId, name, output };
  if (!isValidUnsentToolResult<TTools>(result)) {
    throw new Error('Invalid UnsentToolResult structure');
  }
  return result;
}

/**
 * Create an unsent tool result from a rejection.
 */
export function createRejectedResult<TTools extends readonly Tool[] = readonly Tool[]>(
  callId: string,
  name: string,
  reason?: string,
): UnsentToolResult<TTools> {
  const result = {
    callId,
    name,
    output: null,
    error: reason ?? 'Tool call rejected by user',
  };
  if (!isValidUnsentToolResult<TTools>(result)) {
    throw new Error('Invalid UnsentToolResult structure');
  }
  return result;
}

/**
 * Convert unsent tool results to API format for sending to the model.
 */
export function unsentResultsToAPIFormat(
  results: UnsentToolResult[],
): FunctionCallOutputItemWithId[] {
  return results.map((r) => ({
    type: 'function_call_output' as const,
    id: `output_${r.callId}`,
    callId: r.callId,
    output: r.error
      ? JSON.stringify({ error: r.error })
      : JSON.stringify(r.output),
  }));
}

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

/**
 * Extract text content from a response.
 */
export function extractTextFromResponse(response: OpenResponsesResult): string {
  if (!response.output) {
    return '';
  }

  const outputs = Array.isArray(response.output) ? response.output : [response.output];
  const textParts: string[] = [];

  for (const item of outputs) {
    if (item.type === 'message' && 'content' in item && item.content) {
      for (const content of item.content) {
        if (content.type === 'output_text' && 'text' in content && content.text) {
          textParts.push(content.text);
        }
      }
    }
  }

  return textParts.join('');
}

/**
 * Extract tool calls from a response.
 */
export function extractToolCallsFromResponse<TTools extends readonly Tool[]>(
  response: OpenResponsesResult,
): ParsedToolCall<TTools[number]>[] {
  if (!response.output) {
    return [];
  }

  const outputs = Array.isArray(response.output) ? response.output : [response.output];
  const toolCalls: ParsedToolCall<TTools[number]>[] = [];

  for (const item of outputs) {
    if (item.type !== 'function_call' || !('arguments' in item)) {
      continue;
    }

    let parsedArguments: unknown;
    if (typeof item.arguments === 'string') {
      try {
        parsedArguments = JSON.parse(item.arguments);
      } catch (error) {
        // Log warning and skip malformed tool call
        console.warn(
          `Failed to parse arguments for tool call "${'name' in item ? item.name : 'unknown'}": ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    } else {
      parsedArguments = item.arguments;
    }

    const toolCall = {
      id: ('callId' in item ? item.callId : undefined) ?? item.id ?? '',
      name: ('name' in item ? item.name : undefined) ?? '',
      arguments: parsedArguments,
    };
    if (!isValidParsedToolCall<TTools>(toolCall)) {
      throw new Error(`Invalid tool call structure for tool: ${(toolCall as { name?: string }).name ?? 'unknown'}`);
    }
    toolCalls.push(toolCall);
  }

  return toolCalls;
}

// ---------------------------------------------------------------------------
// Steering and follow-up queue helpers
// ---------------------------------------------------------------------------

/**
 * Enqueue a steering message (injected after current tool batch).
 */
export function steerConversation(
  state: ConversationState,
  message: QueuedMessage,
): ConversationState {
  return updateState(state, {
    steeringQueue: [...(state.steeringQueue ?? []), message],
  });
}

/**
 * Enqueue a follow-up message (processed after agent enters idle).
 */
export function followUpConversation(
  state: ConversationState,
  message: QueuedMessage,
): ConversationState {
  return updateState(state, {
    followUpQueue: [...(state.followUpQueue ?? []), message],
  });
}

/**
 * Drain steering messages from the queue.
 * In 'all' mode, returns all messages. In 'one-at-a-time', returns the first.
 */
export function drainSteeringQueue(state: ConversationState): {
  messages: QueuedMessage[];
  updatedState: ConversationState;
} {
  const queue = state.steeringQueue ?? [];
  if (queue.length === 0) {
    return { messages: [], updatedState: state };
  }

  const mode = state.steeringMode ?? 'all';
  const drained = mode === 'all' ? queue : [queue[0]];
  const remaining = mode === 'all' ? [] : queue.slice(1);

  return {
    messages: drained,
    updatedState: updateState(state, { steeringQueue: remaining }),
  };
}

/**
 * Drain follow-up messages from the queue.
 * In 'all' mode, returns all messages. In 'one-at-a-time', returns the first.
 */
export function drainFollowUpQueue(state: ConversationState): {
  messages: QueuedMessage[];
  updatedState: ConversationState;
} {
  const queue = state.followUpQueue ?? [];
  if (queue.length === 0) {
    return { messages: [], updatedState: state };
  }

  const mode = state.followUpMode ?? 'all';
  const drained = mode === 'all' ? queue : [queue[0]];
  const remaining = mode === 'all' ? [] : queue.slice(1);

  return {
    messages: drained,
    updatedState: updateState(state, { followUpQueue: remaining }),
  };
}

/**
 * Check if there are queued messages.
 */
export function hasQueuedMessages(state: ConversationState): boolean {
  return (state.steeringQueue?.length ?? 0) > 0 || (state.followUpQueue?.length ?? 0) > 0;
}
