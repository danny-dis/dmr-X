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
  initPersistence,
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
  return crypto.randomUUID();
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

export class A2ATaskManager {
  private tasks = new Map<string, Task>();
  private contexts = new Map<string, Set<string>>();
  private push = new Map<string, PushNotificationConfig>();

  constructor() {
    // Rehydrate tasks persisted from a previous run (survives restart).
    for (const t of loadPersistedTasks()) {
      this.tasks.set(t.id, t);
      const set = this.contexts.get(t.contextId) ?? new Set<string>();
      set.add(t.id);
      this.contexts.set(t.contextId, set);
    }
  }

  /** Create a task from an inbound user message (spec: message/send). */
  createTask(message: TaskMessage, opts?: { contextId?: string; metadata?: Record<string, unknown> }): Task {
    const id = message.taskId || crypto.randomUUID();
    const contextId = opts?.contextId || message.contextId || crypto.randomUUID();
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

    logger.info({ taskId: id, contextId }, 'A2A task created');
    return task;
  }

  getTask(id: string, historyLength?: number): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (historyLength === undefined) return task;
    return { ...task, history: task.history.slice(-Math.max(0, historyLength)) };
  }

  setStatus(id: string, state: TaskState, message?: TaskMessage): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = { state, message, timestamp: new Date().toISOString() };
    if (message) task.history.push(message);
    persistTask(task);
    logger.info({ taskId: id, state }, 'A2A task status');
    return task;
  }

  addArtifact(id: string, artifact: TaskArtifact): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.artifacts.push(artifact);
    return task;
  }

  /** Cancel a task. Returns { task } or an error reason for JSON-RPC mapping. */
  cancelTask(id: string): { task?: Task; error?: 'not-found' | 'not-cancelable' } {
    const task = this.tasks.get(id);
    if (!task) return { error: 'not-found' };
    if (isTerminal(task.status.state)) return { error: 'not-cancelable' };
    task.status = { state: 'canceled', timestamp: new Date().toISOString() };
    logger.info({ taskId: id }, 'A2A task canceled');
    return { task };
  }

  setPushConfig(id: string, config: PushNotificationConfig): boolean {
    if (!this.tasks.has(id)) return false;
    this.push.set(id, config);
    persistPushConfig(id, config);
    return true;
  }

  getPushConfig(id: string): PushNotificationConfig | null {
    return loadPushConfig(id) ?? this.push.get(id) ?? null;
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
