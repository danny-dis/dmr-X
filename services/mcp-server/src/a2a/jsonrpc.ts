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

import { V1_METHODS, V1_TASK_STATES, legacyV1Request, wireTask, wireV1Response, wireV1StreamResponses } from './v1-codec.js';
import type { RequestHeaders } from '../tenant-key.js';
import { dispatchTask } from './dispatch.js';
import { resolveOwnerId, type OwnerId } from './owner.js';
import { assertWebhookUrlAllowed, WebhookPolicyError } from './egress.js';
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
  /**
   * No authenticated principal on the request. Distinct from TASK_NOT_FOUND so
   * "you are not authenticated" is never reported as "that task does not exist",
   * which would be a lie about our own state.
   */
  AUTH_REQUIRED: -32005,
  /**
   * A push-notification URL was refused by the egress policy. Reported instead
   * of accepting the config, so a caller learns immediately that its webhook
   * will never fire.
   */
  WEBHOOK_NOT_ALLOWED: -32006,
} as const;

/** Map an owner-scoped refusal onto the wire code. */
function notFoundOrAuth(ownerId: OwnerId | undefined): { code: number; message: string } {
  return ownerId
    ? { code: A2A_ERR.TASK_NOT_FOUND, message: 'Task not found' }
    : { code: A2A_ERR.AUTH_REQUIRED, message: 'A2A requires an authenticated principal' };
}

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

export interface A2ARequestContext { principal?: string; version?: string; }

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

function normalizeRole(role: unknown): 'user' | 'agent' | null {
  if (role === 'user' || role === 'ROLE_USER') return 'user';
  if (role === 'agent' || role === 'ROLE_AGENT') return 'agent';
  return null;
}

function toWireMessage(message: TaskMessage, version?: string): TaskMessage {
  if (version !== '1.0') return message;
  return { ...message, role: message.role === 'user' ? 'ROLE_USER' as never : 'ROLE_AGENT' as never };
}

/**
 * The result body for a task-returning method.
 *
 * Under A2A-Version 1.0 there is ONE task shape and ONE envelope for the whole
 * surface: the protobuf-JSON encoding plus the `TaskState` enum strings produced
 * by v1-codec.ts. The lowercase `message/send` spelling used to return a bare
 * legacy task while `SendMessage` returned `{ task: … }`, so the same version had
 * two answers depending only on how the caller spelled the method. `wrap` keeps
 * the codec's own envelope (`wireV1Response` wraps SendMessage and nothing else).
 *
 * Legacy (0.3 / unversioned) callers get the untouched legacy task, so this does
 * not move the legacy wire format.
 */
function wireTaskResult(
  task: Task,
  version?: string,
  opts?: { wrap?: boolean },
): Omit<Task, 'status'> & { status: Omit<Task['status'], 'state'> & { state: string } } | { task: unknown } | Task {
  if (version !== '1.0') return task;
  const wire = wireTask(task);
  return opts?.wrap ? { task: wire } : wire;
}

function toWireTask(task: Task, version?: string): Omit<Task, 'status'> & { status: Omit<Task['status'], 'state'> & { state: string } } {
  if (version !== '1.0') return task;
  return {
    ...task,
    status: {
      ...task.status,
      state: V1_TASK_STATES[task.status.state] || 'TASK_STATE_UNSPECIFIED',
      ...(task.status.message ? { message: toWireMessage(task.status.message, version) } : {}),
    },
    history: task.history.map((m) => toWireMessage(m, version)),
  };
}


function validateMessage(params: any): TaskMessage | null {
  const msg = params?.message;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const role = normalizeRole(msg.role);
  if (!role) return null;
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
    role,
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
 *
 * VALIDATION IS A SEPARATE, EARLIER STEP (`assertInlinePushConfig`): the egress
 * check used to run after the task existed, so a policy-rejected URL returned
 * WEBHOOK_NOT_ALLOWED while leaving behind a task that was never dispatched and
 * never reached a terminal state — undismissable from memory and durable on
 * disk, and invisible to the `maxTasks` eviction that only reclaims terminal
 * tasks. One rejected call per request was one permanent row.
 */
async function assertInlinePushConfig(params: any): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = params?.configuration?.pushNotificationConfig as PushNotificationConfig | undefined;
  if (!cfg?.url || typeof cfg.url !== 'string') return { ok: true };
  try {
    await assertWebhookUrlAllowed(cfg.url);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof WebhookPolicyError ? err.message : 'egress policy check failed',
    };
  }
}

/** Store an already-validated inline push config on the created task. */
function registerInlinePushConfig(taskId: string, params: any): void {
  const cfg = params?.configuration?.pushNotificationConfig as PushNotificationConfig | undefined;
  if (!cfg?.url || typeof cfg.url !== 'string') return;
  getTaskManager().setPushConfig(taskId, cfg);
}

// ---------------------------------------------------------------------------
// Blocking methods (return a JsonRpcResponse)
// ---------------------------------------------------------------------------

export async function handleRpc(
  req: JsonRpcRequest,
  headers: RequestHeaders,
  context: A2ARequestContext = {},
): Promise<JsonRpcResponse> {
  if (req.method && V1_METHODS[req.method]) {
    const result = await handleRpc(legacyV1Request(req), headers, { ...context, version: '0.3' });
    return wireV1Response(result, req.method);
  }
  const id = req.id ?? null;
  const tm = getTaskManager();
  const ownerId = await resolveOwnerId(headers);

  switch (req.method) {
    case 'message/send': {
      const message = validateMessage(req.params);
      if (!message) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Invalid or missing message');
      // An unauthenticated caller cannot create a task: an unbound task would
      // have no provable owner and would be permanently unreachable afterwards.
      if (!ownerId) {
        return rpcError(id, A2A_ERR.AUTH_REQUIRED, 'A2A requires an authenticated principal');
      }
      // Egress policy BEFORE the task exists, so a refused webhook cannot leave
      // an orphan task behind (see `assertInlinePushConfig`).
      const push = await assertInlinePushConfig(req.params);
      if (!push.ok) {
        return rpcError(id, A2A_ERR.WEBHOOK_NOT_ALLOWED, `Push notification URL rejected: ${push.error}`);
      }
      const { task, error, errorOwner, errorContext } = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
        ownerId,
      });
      if (errorOwner || errorContext) {
        // Same answer as "task not found": do not confirm that another
        // principal's task or context exists.
        return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      }
      if (error === 'terminal-task' || !task) {
        return rpcError(
          id,
          A2A_ERR.INVALID_PARAMS,
          'Task is in a terminal state and cannot accept further messages; start a new task with the same contextId',
        );
      }
      registerInlinePushConfig(task.id, req.params);
      const finalTask = await dispatchTask(task.id, headers);
      return rpcResult(id, wireTaskResult(finalTask, context.version, { wrap: true }));
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
      const task = tm.getOwnedTask(ownerId, taskId, historyLength);
      if (!task) {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      return rpcResult(id, task);
    }

    case 'tasks/cancel': {
      const taskId = req.params?.id;
      if (!taskId || typeof taskId !== 'string') {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing task id');
      }
      const { task, error } = tm.cancelOwnedTask(ownerId, taskId);
      if (error === 'not-found') {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      if (error === 'not-cancelable') return rpcError(id, A2A_ERR.TASK_NOT_CANCELABLE, 'Task not cancelable');
      if (!task) return rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found');
      return rpcResult(id, toWireTask(task, context.version));
    }

    case 'tasks/list': {
      const p = (req.params ?? {}) as {
        contextId?: string;
        status?: string;
        pageSize?: number;
        pageToken?: string;
        includeHistory?: boolean;
        includeArtifacts?: boolean;
      };

      if (p.pageSize !== undefined && (!Number.isInteger(p.pageSize) || p.pageSize < 1 || p.pageSize > 100)) {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'pageSize must be an integer between 1 and 100');
      }

      // Owner-scoped: a principal only ever sees its own tasks. With no
      // principal the list is empty rather than a leak of everyone's work.
      const tasks = tm.listOwnedTasks(ownerId, {
        state: p.status as never,
        contextId: p.contextId,
        limit: p.pageSize ?? 50,
        includeHistory: p.includeHistory === true,
        pageToken: p.pageToken,
      });

      // Cursor pagination. The token resumes strictly after the last task of
      // this page, so a client walking pages sees every owned task exactly once
      // even while new tasks arrive. It is omitted (not emptied) on the final
      // page, which is how the spec signals "no further pages".
      //
      // The cursor is applied INSIDE the owner filter, so a token naming a task
      // this principal cannot see simply ends the walk: it can never be used to
      // probe for another principal's tasks.
      const lastId = tasks.length > 0 ? tasks[tasks.length - 1].id : undefined;
      const nextPageToken = tasks.length >= (p.pageSize ?? 50) ? tm.nextPageTokenFor(lastId) : '';
      return nextPageToken
        ? rpcResult(id, { tasks, nextPageToken })
        : rpcResult(id, { tasks });
    }
    case 'tasks/pushNotificationConfig/set': {
      const taskId = req.params?.taskId ?? req.params?.id;
      const config = req.params?.pushNotificationConfig as PushNotificationConfig | undefined;
      if (!taskId || !config?.url) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId or config url');
      if (!ownerId) return rpcError(id, A2A_ERR.AUTH_REQUIRED, 'A2A requires an authenticated principal');
      // Authorization FIRST, then validation. A non-owner learns only that the
      // task is not theirs; running the egress check first would both leak the
      // webhook policy to unauthorized callers and make them trigger a DNS
      // lookup for a URL they may not register.
      if (!tm.getOwnedTask(ownerId, taskId)) {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      // Registration-time egress gate: refuse to store a URL that would be
      // rejected at delivery time, so the advertised capability is honest.
      try {
        await assertWebhookUrlAllowed(config.url);
      } catch (err) {
        const message = err instanceof WebhookPolicyError ? err.message : 'egress policy check failed';
        return rpcError(id, A2A_ERR.WEBHOOK_NOT_ALLOWED, `Push notification URL rejected: ${message}`);
      }
      // The 1.0 SDK names the config (`TaskPushNotificationConfig.id`) while
      // the core stores a single unkeyed config per task. The id rides
      // alongside (not inside the validated URL object) so the V1 response can
      // echo it without changing the validated shape. Only the flat V1 shape
      // carries both `taskId` and `id`: a legacy caller addressing its task as
      // `{id}` must not have its task id mistaken for a config id.
      const configId =
        req.params?.taskId !== undefined && typeof req.params?.id === 'string' ? req.params.id : undefined;
      const stored = configId !== undefined ? { ...config, id: configId } : config;
      await tm.setOwnedPushConfig(ownerId, taskId, stored);
      return rpcResult(id, {
        taskId,
        ...(configId !== undefined ? { id: configId } : {}),
        pushNotificationConfig: config,
      });
    }

    case 'tasks/pushNotificationConfig/list': {
      const taskId = req.params?.taskId ?? req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId');
      if (!tm.getOwnedTask(ownerId, taskId)) {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      // The core keeps ONE config per task, so the SDK's config collection is
      // that config (or empty). Entries use the same {taskId, id?,
      // pushNotificationConfig} shape the V1 wire flattens.
      const config = tm.getOwnedPushConfig(ownerId, taskId) as
        | (PushNotificationConfig & { id?: string })
        | null;
      if (!config?.url) return rpcResult(id, { taskId, configs: [] });
      const { id: configId, ...urlConfig } = config;
      return rpcResult(id, {
        taskId,
        configs: [
          {
            taskId,
            ...(typeof configId === 'string' ? { id: configId } : {}),
            pushNotificationConfig: urlConfig,
          },
        ],
      });
    }

    case 'tasks/pushNotificationConfig/delete': {
      const taskId = req.params?.taskId ?? req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId');
      if (!ownerId) return rpcError(id, A2A_ERR.AUTH_REQUIRED, 'A2A requires an authenticated principal');
      if (!tm.getOwnedTask(ownerId, taskId)) {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      // The store has no delete API (single config per task, owned by another
      // module), so deletion is a tombstone through the owned write path: an
      // empty URL never fires (delivery skips falsy urls) and reads treat it
      // as absent. No validation runs here — there is no URL to validate.
      await tm.setOwnedPushConfig(ownerId, taskId, { url: '' } as PushNotificationConfig);
      return rpcResult(id, { taskId });
    }

    case 'tasks/pushNotificationConfig/get': {
      const taskId = req.params?.taskId ?? req.params?.id;
      if (!taskId) return rpcError(id, A2A_ERR.INVALID_PARAMS, 'Missing taskId');
      // -32003 means "this agent does not support push notifications at all",
      // which is a lie here — we do, this task simply has no config yet.
      if (!tm.getOwnedTask(ownerId, taskId)) {
        const { code, message } = notFoundOrAuth(ownerId);
        return rpcError(id, code, message);
      }
      const config = tm.getOwnedPushConfig(ownerId, taskId) as
        | (PushNotificationConfig & { id?: string })
        | null;
      if (!config?.url) {
        return rpcError(id, A2A_ERR.INVALID_PARAMS, 'No push notification config set for this task');
      }
      // Hoist a V1 config id stored alongside the URL object (see set) so the
      // wire can echo the flat SDK shape; a tombstoned (deleted) config has no
      // URL and is reported as absent above.
      const { id: configId, ...urlConfig } = config;
      return rpcResult(id, {
        taskId,
        ...(typeof configId === 'string' ? { id: configId } : {}),
        pushNotificationConfig: urlConfig,
      });
    }

    case 'agent/getExtendedCard':
      // Alias — some clients use the 0.3.0-era name for the same operation.
      /* falls through */
    case 'agent/authenticatedExtendedCard': {
      if (!agentCardProvider) return rpcError(id, A2A_ERR.INTERNAL, 'Agent card provider not registered');
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
  const canonical = method ? V1_METHODS[method] ?? method : undefined;
  return canonical === 'message/stream' || canonical === 'tasks/resubscribe';
}

export async function handleRpcStream(
  req: JsonRpcRequest,
  headers: RequestHeaders,
  sink: StreamSink,
  context: A2ARequestContext = {},
): Promise<void> {
  if (req.method && V1_METHODS[req.method]) {
    const artifacts = new Map<string, string>();
    const adaptedSink: StreamSink = {
      ...sink,
      send(response) {
        for (const event of wireV1StreamResponses(response, artifacts)) sink.send(event);
      },
    };
    return handleRpcStream(legacyV1Request(req), headers, adaptedSink, { ...context, version: '0.3' });
  }
  const id = req.id ?? null;
  const tm = getTaskManager();
  const ownerId = await resolveOwnerId(headers);

  try {
    if (req.method === 'message/stream') {
      const message = validateMessage(req.params);
      if (!message) {
        sink.send(rpcError(id, A2A_ERR.INVALID_PARAMS, 'Invalid or missing message'));
        return;
      }
      if (!ownerId) {
        sink.send(rpcError(id, A2A_ERR.AUTH_REQUIRED, 'A2A requires an authenticated principal'));
        return;
      }
      // Same ordering as message/send: refuse the webhook before the task exists.
      const push = await assertInlinePushConfig(req.params);
      if (!push.ok) {
        sink.send(rpcError(id, A2A_ERR.WEBHOOK_NOT_ALLOWED, `Push notification URL rejected: ${push.error}`));
        return;
      }
      const { task, error, errorOwner, errorContext } = tm.createTask(message, {
        contextId: req.params?.message?.contextId,
        metadata: req.params?.metadata,
        ownerId,
      });
      if (errorOwner || errorContext) {
        sink.send(rpcError(id, A2A_ERR.TASK_NOT_FOUND, 'Task not found'));
        return;
      }
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
      sink.send(rpcResult(id, toWireTask(task, context.version)));
      const seen = new Set<string>([task.status.timestamp + task.status.state]);
      const unsubscribe = tm.subscribeOwned(ownerId, task.id, (updated) => {
        const key = updated.status.timestamp + updated.status.state;
        if (seen.has(key)) return;
        seen.add(key);
        sink.send(rpcResult(id, statusUpdateEvent(updated, context.version)));
      });
      try {
        const finalTask = await dispatchTask(task.id, headers);
        const finalKey = finalTask.status.timestamp + finalTask.status.state;
        if (!seen.has(finalKey)) sink.send(rpcResult(id, statusUpdateEvent(finalTask, context.version)));
      } finally {
        unsubscribe();
      }
      return;
    }

    if (req.method === 'tasks/resubscribe') {
      const taskId = req.params?.id;
      const task = taskId && typeof taskId === 'string' ? tm.getOwnedTask(ownerId, taskId) : null;
      if (!task) {
        const { code, message } = notFoundOrAuth(ownerId);
        sink.send(rpcError(id, code, message));
        return;
      }
      // Replay current state, then follow the task to its terminal state.
      // A single replay event used to be the whole implementation, so a client
      // resubscribing to an in-flight task got one `working` frame and an
      // immediate close instead of the completion it was waiting for.
      sink.send(rpcResult(id, statusUpdateEvent(task, context.version)));
      if (isTerminal(task.status.state)) return;
      await followToTerminal(tm, ownerId, task.id, id, sink, context.version);
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
  ownerId: OwnerId | undefined,
  taskId: string,
  rpcId: string | number | null,
  sink: StreamSink,
  version?: string,
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
    const unsubscribe = tm.subscribeOwned(ownerId, taskId, (updated) => {
      // `version` must be threaded through: without it every follow-up event was
      // serialised in the legacy 0.3 shape while the initial replay (above) used
      // the negotiated 1.0 form, producing a mixed-version stream.
      sink.send(rpcResult(rpcId, statusUpdateEvent(updated, version)));
      if (isTerminal(updated.status.state)) finish();
    });
    // Guard against the task having terminated between the replay and subscribe.
    if (tm.isTaskTerminal(taskId)) finish();
  });
}

/** Build a TaskStatusUpdateEvent (spec streaming event shape). */
function statusUpdateEvent(task: Task, version?: string) {
  const wire = toWireTask(task, version);
  return {
    taskId: wire.id,
    contextId: wire.contextId,
    kind: 'status-update' as const,
    status: wire.status,
    final: isTerminal(task.status.state),
    artifacts: wire.artifacts,
  };
}
