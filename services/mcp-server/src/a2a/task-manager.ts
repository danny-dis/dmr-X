/**
 * A2A Task Manager
 *
 * In-memory store of A2A-native Task/Message objects (spec shapes: `kind`,
 * `contextId`, `history`, `artifacts`). Pure store — no I/O side effects
 * (dispatch + push live in dispatch.ts / jsonrpc.ts).
 *
 * ponytail: in-memory Map, lost on restart. Swap for @dmr-x/db if tasks must
 * survive a gateway bounce or be shared across instances.
 */

import { randomUUID } from 'node:crypto';
import {
  persistTask,
  loadPersistedTasks,
  setPushConfig as persistPushConfig,
  getPushConfig as loadPushConfig,
} from './persistence.js';

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:a2a:task-manager');

// ---------------------------------------------------------------------------
// A2A object shapes (current spec)
// ---------------------------------------------------------------------------

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

const TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

export function isTerminal(state: TaskState): boolean {
  return TERMINAL.has(state);
}

export interface TaskPart {
  kind: 'text' | 'file' | 'data';
  text?: string;
  data?: unknown;
  file?: { name?: string; mimeType?: string; uri?: string; bytes?: string };
  metadata?: Record<string, unknown>;
}

export interface TaskMessage {
  role: 'user' | 'agent';
  parts: TaskPart[];
  messageId: string;
  kind: 'message';
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: TaskMessage;
  timestamp: string;
}

export interface TaskArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: TaskPart[];
  metadata?: Record<string, unknown>;
}

export interface PushNotificationConfig {
  url: string;
  token?: string;
  authentication?: { schemes: string[]; credentials?: string };
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  history: TaskMessage[];
  artifacts: TaskArtifact[];
  kind: 'task';
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers to build spec-shaped objects
// ---------------------------------------------------------------------------

export function newMessageId(): string {
  return randomUUID();
}

export function textMessage(role: 'user' | 'agent', text: string, extra?: Partial<TaskMessage>): TaskMessage {
  return {
    role,
    parts: [{ kind: 'text', text }],
    messageId: newMessageId(),
    kind: 'message',
    ...extra,
  };
}

/** Flatten a message's parts into a single text string. */
export function messageText(msg: TaskMessage | undefined): string {
  if (!msg?.parts) return '';
  return msg.parts
    .map((p) => (p.kind === 'text' ? p.text ?? '' : p.kind === 'data' ? JSON.stringify(p.data) : ''))
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Outcome of createTask — `error` set when the request is not admissible. */
export interface CreateTaskResult {
  task?: Task;
  /** Client referenced `message.taskId` of an already-terminal task. */
  error?: 'terminal-task';
}

/** Callback invoked on every state change of a subscribed task. */
export type TaskListener = (task: Task) => void;

/**
 * Hard ceiling on retained tasks. Without it the store is an unbounded memory
 * leak: every inbound message/send permanently retains its full text (a single
 * request may legally carry megabytes). Oldest terminal tasks are evicted first;
 * live (non-terminal) tasks are never evicted.
 */
const DEFAULT_MAX_TASKS = 1000;

export class A2ATaskManager {
  private tasks = new Map<string, Task>();
  private contexts = new Map<string, Set<string>>();
  private push = new Map<string, PushNotificationConfig>();
  private listeners = new Map<string, Set<TaskListener>>();
  private readonly maxTasks: number;

  constructor(opts?: { maxTasks?: number }) {
    const envMax = Number(process.env.DMRX_A2A_MAX_TASKS);
    this.maxTasks =
      opts?.maxTasks ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_TASKS);
    // Rehydrate tasks persisted from a previous run (survives restart).
    for (const t of loadPersistedTasks()) {
      this.tasks.set(t.id, t);
      const set = this.contexts.get(t.contextId) ?? new Set<string>();
      set.add(t.id);
      this.contexts.set(t.contextId, set);
    }
    this.evict();
  }

  /**
   * Create a task from an inbound user message (spec: message/send).
   *
   * If `message.taskId` names a task that already exists, this CONTINUES that
   * task (appends to its history) rather than silently replacing it — replacing
   * destroyed all prior history and artifacts, breaking multi-turn. Continuing a
   * task that already reached a terminal state is rejected: per spec a terminal
   * task is immutable and follow-up turns belong to a NEW task sharing the same
   * `contextId`.
   */
  createTask(
    message: TaskMessage,
    opts?: { contextId?: string; metadata?: Record<string, unknown> },
  ): CreateTaskResult {
    const existing = message.taskId ? this.tasks.get(message.taskId) : undefined;
    if (existing) {
      if (isTerminal(existing.status.state)) return { error: 'terminal-task' };
      existing.history.push({ ...message, taskId: existing.id, contextId: existing.contextId });
      existing.status = { state: 'submitted', timestamp: new Date().toISOString() };
      if (opts?.metadata) existing.metadata = { ...existing.metadata, ...opts.metadata };
      persistTask(existing);
      this.emit(existing);
      logger.info({ taskId: existing.id, contextId: existing.contextId }, 'A2A task continued');
      return { task: existing };
    }

    const id = message.taskId || randomUUID();
    const contextId = opts?.contextId || message.contextId || randomUUID();
    const now = new Date().toISOString();

    const task: Task = {
      id,
      contextId,
      status: { state: 'submitted', timestamp: now },
      history: [{ ...message, taskId: id, contextId }],
      artifacts: [],
      kind: 'task',
      metadata: opts?.metadata,
    };

    this.tasks.set(id, task);
    const set = this.contexts.get(contextId) ?? new Set<string>();
    set.add(id);
    this.contexts.set(contextId, set);
    persistTask(task);
    this.evict();

    logger.info({ taskId: id, contextId }, 'A2A task created');
    return { task };
  }

  getTask(id: string, historyLength?: number): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (historyLength === undefined) return task;
    return { ...task, history: task.history.slice(-Math.max(0, historyLength)) };
  }

  /** All tasks sharing a contextId, oldest first (used to rebuild multi-turn context). */
  getContextTasks(contextId: string): Task[] {
    const ids = this.contexts.get(contextId);
    if (!ids) return [];
    const out: Task[] = [];
    for (const id of ids) {
      const t = this.tasks.get(id);
      if (t) out.push(t);
    }
    return out;
  }

  /**
   * Move a task to a new state.
   *
   * Terminal states are FINAL: once a task is completed/canceled/failed/rejected
   * it can never transition again. Without this guard an in-flight dispatch that
   * finished after a `tasks/cancel` would resurrect the canceled task as
   * `completed`, which the spec forbids and which silently lies to the client.
   */
  setStatus(id: string, state: TaskState, message?: TaskMessage): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (isTerminal(task.status.state)) {
      logger.info(
        { taskId: id, from: task.status.state, attempted: state },
        'A2A task already terminal — status change ignored',
      );
      return null;
    }
    task.status = { state, message, timestamp: new Date().toISOString() };
    if (message) task.history.push(message);
    persistTask(task);
    this.emit(task);
    logger.info({ taskId: id, state }, 'A2A task status');
    return task;
  }

  addArtifact(id: string, artifact: TaskArtifact): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (isTerminal(task.status.state)) return null;
    task.artifacts.push(artifact);
    // Artifacts were previously held only in memory — a restart lost every
    // result while the task row still claimed `completed`.
    persistTask(task);
    return task;
  }

  /** Cancel a task. Returns { task } or an error reason for JSON-RPC mapping. */
  cancelTask(id: string): { task?: Task; error?: 'not-found' | 'not-cancelable' } {
    const task = this.tasks.get(id);
    if (!task) return { error: 'not-found' };
    if (isTerminal(task.status.state)) return { error: 'not-cancelable' };
    task.status = {
      state: 'canceled',
      message: textMessage('agent', 'Task canceled by client request', { taskId: id }),
      timestamp: new Date().toISOString(),
    };
    persistTask(task);
    this.emit(task);
    logger.info({ taskId: id }, 'A2A task canceled');
    return { task };
  }

  /** True if the task exists and has already reached a terminal state. */
  isTaskTerminal(id: string): boolean {
    const task = this.tasks.get(id);
    return !!task && isTerminal(task.status.state);
  }

  setPushConfig(id: string, config: PushNotificationConfig): boolean {
    if (!this.tasks.has(id)) return false;
    this.push.set(id, config);
    persistPushConfig(id, config);
    return true;
  }

  getPushConfig(id: string): PushNotificationConfig | null {
    return this.push.get(id) ?? loadPushConfig(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Live subscriptions (used by message/stream + tasks/resubscribe)
  // -------------------------------------------------------------------------

  /** Subscribe to state changes of a task. Returns an unsubscribe function. */
  subscribe(id: string, listener: TaskListener): () => void {
    const set = this.listeners.get(id) ?? new Set<TaskListener>();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      const cur = this.listeners.get(id);
      if (!cur) return;
      cur.delete(listener);
      if (cur.size === 0) this.listeners.delete(id);
    };
  }

  private emit(task: Task): void {
    const set = this.listeners.get(task.id);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(task);
      } catch (err) {
        logger.warn({ err, taskId: task.id }, 'A2A task listener threw');
      }
    }
    if (isTerminal(task.status.state)) this.listeners.delete(task.id);
  }

  /** Drop oldest terminal tasks once the store exceeds `maxTasks`. */
  private evict(): void {
    if (this.tasks.size <= this.maxTasks) return;
    for (const [id, task] of this.tasks) {
      if (this.tasks.size <= this.maxTasks) break;
      if (!isTerminal(task.status.state)) continue;
      this.tasks.delete(id);
      this.push.delete(id);
      this.listeners.delete(id);
      const set = this.contexts.get(task.contextId);
      if (set) {
        set.delete(id);
        if (set.size === 0) this.contexts.delete(task.contextId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: A2ATaskManager | null = null;

export function getTaskManager(): A2ATaskManager {
  if (!instance) instance = new A2ATaskManager();
  return instance;
}

export function resetTaskManager(): void {
  instance = null;
}
