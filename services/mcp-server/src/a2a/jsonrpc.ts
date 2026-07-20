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

import type { ServerResponse } from 'node:http';

import type { RequestHeaders } from '../tenant-key.js';
import { dispatchTask } from './dispatch.js';
import {
  getTaskManager,
  isTerminal,
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

function validateMessage(params: any): TaskMessage | null {
  const msg = params?.message;
  if (!msg || typeof msg !== 'object') return null;
  if (msg.role !== 'user' && msg.role !== 'agent') return null;
  if (!Array.isArray(msg.parts)) return null;
  return {
    role: msg.role,
    parts: msg.parts,
    messageId: msg.messageId || undefined,
    kind: 'message',
    taskId: msg.taskId,
    contextId: msg.contextId,
    metadata: msg.metadata,
  } as TaskMessage;
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
      const task = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
      });
      const finalTask = await dispatchTask(task.id, headers);
      return rpcResult(id, finalTask);
    }

    case 'tasks/get': {
      const taskId = req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing task id');
      const task = tm.getTask(taskId, req.params?.historyLength);
      if (!task) return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      return rpcResult(id, task);
    }

    case 'tasks/cancel': {
      const taskId = req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing task id');
      const { task, error } = tm.cancelTask(taskId);
      if (error === 'not-found') return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      if (error === 'not-cancelable') return rpcError(id, A2A_ERR.TASK_NOT_CANCELABLE, 'Task not cancelable');
      return rpcResult(id, task);
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
      const config = tm.getPushConfig(taskId);
      if (!config) return rpcError(id, A2A_ERR.PUSH_NOT_SUPPORTED, 'No push config for task');
      return rpcResult(id, { taskId, pushNotificationConfig: config });
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
      const task = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
      });
      // Emit the initial submitted task, then working, then the terminal task.
      sink.send(rpcResult(id, task));
      const working = tm.getTask(task.id)!;
      sink.send(rpcResult(id, { ...working, status: { ...working.status } }));
      const finalTask = await dispatchTask(task.id, headers);
      sink.send(rpcResult(id, statusUpdateEvent(finalTask)));
      return;
    }

    if (req.method === 'tasks/resubscribe') {
      const taskId = req.params?.id;
      const task = taskId ? tm.getTask(taskId) : null;
      if (!task) {
        sink.send(rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found'));
        return;
      }
      // Task store is synchronous-terminal here (no long-running background
      // work), so resubscribe replays the current state as one event.
      // ponytail: single replay event; wire a real pub/sub if dispatch ever
      // becomes async/long-lived.
      sink.send(rpcResult(id, statusUpdateEvent(task)));
      return;
    }

    sink.send(rpcError(id, A2A_ERR.METHOD_NOT_FOUND, `Method not found: ${req.method}`));
  } finally {
    sink.end();
  }
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
