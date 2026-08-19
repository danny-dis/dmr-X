/**
 * A2A JSON-RPC 2.0 method dispatcher.
 *
 * Implements the current A2A spec surface over a single POST endpoint:
 *   - message/send                    (blocking)
 *   - message/stream                  (SSE streaming)
 *   - tasks/get
 *   - tasks/cancel
 *   - tasks/resubscribe               (SSE)
 *   - tasks/pushNotificationConfig/set
 *   - tasks/pushNotificationConfig/get
 *
 * Transport framing (HTTP req/res, SSE) lives in handler.ts; this module is
 * pure protocol logic operating on the task store + dispatch bridge.
 */

import type { RequestHeaders } from '../tenant-key.js';
import { dispatchTask } from './dispatch.js';
import {
  getTaskManager,
  isTerminal,
  newMessageId,
  type PushNotificationConfig,
  type Task,
  type TaskMessage,
} from './task-manager.js';

// A2A JSON-RPC error codes (spec §8) + standard JSON-RPC codes.
export const A2A_ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
} as const;

/**
 * Supplies the current Agent Card to the `agent/getExtendedCard` method.
 *
 * The card is built in handler.ts from live config + the live tool list, which
 * jsonrpc.ts has no access to. A registered provider keeps the card a single
 * source of truth instead of rebuilding it here from stale inputs.
 */
type AgentCardProvider = () => unknown;
let agentCardProvider: AgentCardProvider | null = null;

export function setAgentCardProvider(provider: AgentCardProvider | null): void {
  agentCardProvider = provider;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

/** SSE sink used by streaming methods. */
export interface StreamSink {
  /** Write one SSE `data:` event (JSON-RPC response envelope). */
  send(event: JsonRpcResponse): void;
  /** End the stream. */
  end(): void;
}

const VALID_PART_KINDS = new Set(['text', 'file', 'data']);

function validateMessage(params: any): TaskMessage | null {
  const msg = params?.message;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  if (msg.role !== 'user' && msg.role !== 'agent') return null;
  if (!Array.isArray(msg.parts)) return null;
  // Reject structurally invalid parts rather than storing junk that later
  // serializes back to the client as a spec-invalid Message.
  for (const part of msg.parts) {
    if (!part || typeof part !== 'object' || !VALID_PART_KINDS.has(part.kind)) return null;
    if (part.kind === 'text' && typeof part.text !== 'string') return null;
  }
  if (msg.taskId !== undefined && typeof msg.taskId !== 'string') return null;
  if (msg.contextId !== undefined && typeof msg.contextId !== 'string') return null;
  return {
    role: msg.role,
    parts: msg.parts,
    // `messageId` is REQUIRED on a spec Message. Previously an omitted id was
    // stored as `undefined` and dropped on serialization, so the task history
    // handed back to the client contained Messages with no messageId at all.
    messageId: typeof msg.messageId === 'string' && msg.messageId ? msg.messageId : newMessageId(),
    kind: 'message',
    taskId: msg.taskId,
    contextId: msg.contextId,
    metadata: msg.metadata,
  } as TaskMessage;
}

/** Validate an optional `historyLength` param. Returns `false` when malformed. */
function readHistoryLength(raw: unknown): number | undefined | false {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return false;
  return raw;
}

/**
 * Register a push config supplied inline on message/send|stream
 * (`params.configuration.pushNotificationConfig`).
 *
 * This is the only workable path: dispatch runs to completion inside the same
 * call, so a config set afterwards via tasks/pushNotificationConfig/set can
 * never fire. Registering here — before dispatch — makes the advertised
 * `pushNotifications: true` capability real.
 */
function registerInlinePushConfig(taskId: string, params: any): void {
  const cfg = params?.configuration?.pushNotificationConfig as PushNotificationConfig | undefined;
  if (cfg?.url && typeof cfg.url === 'string') {
    getTaskManager().setPushConfig(taskId, cfg);
  }
}

// ---------------------------------------------------------------------------
// Blocking methods (return a JsonRpcResponse)
// ---------------------------------------------------------------------------

export async function handleRpc(
  req: JsonRpcRequest,
  headers: RequestHeaders,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const tm = getTaskManager();

  switch (req.method) {
    case 'message/send': {
      const message = validateMessage(req.params);
      if (!message) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Invalid or missing message');
      const { task, error } = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
      });
      if (error === 'terminal-task' || !task) {
        return rpcError(
          id,
          A2A_ERR.INVALID_PARAMS,
          'Task is in a terminal state and cannot accept further messages; start a new task with the same contextId',
        );
      }
      registerInlinePushConfig(task.id, req.params);
      const finalTask = await dispatchTask(task.id, headers);
      return rpcResult(id, finalTask);
    }

    case 'tasks/get': {
      const taskId = req.params?.id;
      if (!taskId || typeof taskId !== 'string') {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing task id');
      }
      const historyLength = readHistoryLength(req.params?.historyLength);
      if (historyLength === false) {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'historyLength must be a non-negative integer');
      }
      const task = tm.getTask(taskId, historyLength);
      if (!task) return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      return rpcResult(id, task);
    }

    case 'tasks/cancel': {
      const taskId = req.params?.id;
      if (!taskId || typeof taskId !== 'string') {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing task id');
      }
      const { task, error } = tm.cancelTask(taskId);
      if (error === 'not-found') return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      if (error === 'not-cancelable') return rpcError(id, A2A_ERR.TASK_NOT_CANCELABLE, 'Task not cancelable');
      return rpcResult(id, task);
    }

    case 'tasks/list': {
      const p = (req.params ?? {}) as {
        contextId?: string;
        status?: string;
        pageSize?: number;
        includeHistory?: boolean;
      };

      // Spec caps page_size at 100 (min 1). Reject out-of-range explicitly
      // rather than silently clamping, so a client learns its request was wrong.
      if (p.pageSize !== undefined) {
        if (!Number.isInteger(p.pageSize) || p.pageSize < 1 || p.pageSize > 100) {
          return rpcError(id, A2A_ERR.INVALID_PARAMS, 'pageSize must be an integer between 1 and 100');
        }
      }

      const tasks = tm.listTasks({
        state: p.status as never,
        contextId: p.contextId,
        limit: p.pageSize ?? 50, // spec default when unspecified
        includeHistory: p.includeHistory === true,
      });

      // `nextPageToken` is omitted: TaskManager holds an in-memory map with no
      // cursor, so real pagination would be a storage change. Returning no
      // token is spec-legal (it signals "no further pages").
      return rpcResult(id, { tasks });
    }

    case 'tasks/pushNotificationConfig/set': {
      const taskId = req.params?.taskId ?? req.params?.id;
      const config = req.params?.pushNotificationConfig as PushNotificationConfig | undefined;
      if (!taskId || !config?.url) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId or config url');
      if (!tm.setPushConfig(taskId, config)) return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      return rpcResult(id, { taskId, pushNotificationConfig: config });
    }

    case 'tasks/pushNotificationConfig/get': {
      const taskId = req.params?.taskId ?? req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId');
      // -32003 means "this agent does not support push notifications at all",
      // which is a lie here — we do, this task simply has no config yet.
      if (!tm.getTask(taskId)) return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      const config = tm.getPushConfig(taskId);
      if (!config) {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'No push notification config set for this task');
      }
      return rpcResult(id, { taskId, pushNotificationConfig: config });
    }

    case 'agent/getExtendedCard':
    // Alias — some clients use the 0.3.0-era name for the same operation.
    case 'agent/authenticatedExtendedCard': {
      if (!agentCardProvider) {
        return rpcError(id, A2A_ERR.INTERNAL, 'Agent card provider not registered');
      }
      return rpcResult(id, agentCardProvider());
    }

    case 'message/stream':
    case 'tasks/resubscribe':
      // Streaming methods must go through handleRpcStream, not here.
      return rpcError(id, A2A_ERR.UNSUPPORTED_OPERATION, 'Method requires a streaming transport');

    default:
      return rpcError(id, A2A_ERR.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
  }
}

// ---------------------------------------------------------------------------
// Streaming methods (emit onto an SSE sink)
// ---------------------------------------------------------------------------

/**
 * True if the method is a streaming method (handled by handleRpcStream).
 */
export function isStreamMethod(method: string | undefined): boolean {
  return method === 'message/stream' || method === 'tasks/resubscribe';
}

export async function handleRpcStream(
  req: JsonRpcRequest,
  headers: RequestHeaders,
  sink: StreamSink,
): Promise<void> {
  const id = req.id ?? null;
  const tm = getTaskManager();

  try {
    if (req.method === 'message/stream') {
      const message = validateMessage(req.params);
      if (!message) {
        sink.send(rpcError(id, A2A_ERR.INVALID_PARAMS, 'Invalid or missing message'));
        return;
      }
      const { task, error } = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
      });
      if (error === 'terminal-task' || !task) {
        sink.send(
          rpcError(
            id,
            A2A_ERR.INVALID_PARAMS,
            'Task is in a terminal state and cannot accept further messages; start a new task with the same contextId',
          ),
        );
        return;
      }
      registerInlinePushConfig(task.id, req.params);

      // First event is the Task itself (spec), then one status-update per real
      // state change. Previously the second event re-sent the *same* `submitted`
      // snapshot — `working` was never observable because it is only set inside
      // dispatchTask, which had not run yet.
      sink.send(rpcResult(id, task));
      const seen = new Set<string>([task.status.timestamp + task.status.state]);
      const unsubscribe = tm.subscribe(task.id, (updated) => {
        const key = updated.status.timestamp + updated.status.state;
        if (seen.has(key)) return;
        seen.add(key);
        sink.send(rpcResult(id, statusUpdateEvent(updated)));
      });
      try {
        const finalTask = await dispatchTask(task.id, headers);
        const finalKey = finalTask.status.timestamp + finalTask.status.state;
        if (!seen.has(finalKey)) sink.send(rpcResult(id, statusUpdateEvent(finalTask)));
      } finally {
        unsubscribe();
      }
      return;
    }

    if (req.method === 'tasks/resubscribe') {
      const taskId = req.params?.id;
      const task = taskId && typeof taskId === 'string' ? tm.getTask(taskId) : null;
      if (!task) {
        sink.send(rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found'));
        return;
      }
      // Replay current state, then follow the task to its terminal state.
      // A single replay event used to be the whole implementation, so a client
      // resubscribing to an in-flight task got one `working` frame and an
      // immediate close instead of the completion it was waiting for.
      sink.send(rpcResult(id, statusUpdateEvent(task)));
      if (isTerminal(task.status.state)) return;
      await followToTerminal(tm, task.id, id, sink);
      return;
    }

    sink.send(rpcError(id, A2A_ERR.METHOD_NOT_FOUND, `Method not found: ${req.method}`));
  } finally {
    sink.end();
  }
}

/** Max time a resubscribe stream stays open waiting for a terminal state (ms). */
const RESUBSCRIBE_TIMEOUT_MS = 5 * 60_000;

/** Stream status updates for `taskId` until it reaches a terminal state. */
function followToTerminal(
  tm: ReturnType<typeof getTaskManager>,
  taskId: string,
  rpcId: string | number | null,
  sink: StreamSink,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, RESUBSCRIBE_TIMEOUT_MS);
    // `unref` so a dangling subscriber can never hold the process open.
    (timer as unknown as { unref?: () => void }).unref?.();
    const unsubscribe = tm.subscribe(taskId, (updated) => {
      sink.send(rpcResult(rpcId, statusUpdateEvent(updated)));
      if (isTerminal(updated.status.state)) finish();
    });
    // Guard against the task having terminated between the replay and subscribe.
    if (tm.isTaskTerminal(taskId)) finish();
  });
}

/** Build a TaskStatusUpdateEvent (spec streaming event shape). */
function statusUpdateEvent(task: Task) {
  return {
    taskId: task.id,
    contextId: task.contextId,
    kind: 'status-update' as const,
    status: task.status,
    final: isTerminal(task.status.state),
    artifacts: task.artifacts,
  };
}
