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
  persistOwnerBinding,
  loadOwnerBindings,
  setPushConfig as persistPushConfig,
  getPushConfig as loadPushConfig,
} from './persistence.js';

import { legacyUnownedVisibility, ownerIdMatches, type OwnerId } from './owner.js';

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

/**
 * Decode a `tasks/list` cursor into the task id it resumes after.
 *
 * Returns `undefined` for anything that is not a well-formed token this server
 * issued. The caller treats that as "end of listing" instead of restarting, so
 * a client cannot be handed page 1 forever by a corrupt or replayed token.
 */
function decodeTaskCursor(pageToken: string): string | undefined {
  try {
    const raw = Buffer.from(pageToken, 'base64url').toString('utf8');
    // Bound the decode: a client may send an arbitrarily large string.
    if (raw.length > 512) return undefined;
    const parsed = JSON.parse(raw) as { v?: unknown; after?: unknown };
    if (parsed?.v !== 1 || typeof parsed.after !== 'string' || parsed.after.length === 0) {
      return undefined;
    }
    return parsed.after;
  } catch {
    return undefined;
  }
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
  /** The referenced task exists but belongs to a different principal. */
  errorOwner?: 'forbidden';
  /** The referenced `contextId` belongs to a different principal. */
  errorContext?: 'forbidden';
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
  private messageIndex = new Map<string, string>();
  private listeners = new Map<string, Set<TaskListener>>();
  /**
   * Immutable owner digest per task, and per contextId.
   *
   * A task with no entry here is UNOWNED — persisted by a build that predates
   * ownership. Unowned tasks are never handed to a remote principal; see
   * `canReadUnowned`.
   */
  private owners = new Map<string, OwnerId>();
  private contextOwners = new Map<string, OwnerId>();
  /** In-flight downstream dispatch per task, so a cancel can abort it. */
  private inflight = new Map<string, AbortController>();
  private readonly maxTasks: number;

  constructor(opts?: { maxTasks?: number }) {
    const envMax = Number(process.env.DMRX_A2A_MAX_TASKS);
    this.maxTasks =
      opts?.maxTasks ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_TASKS);
    // Rehydrate tasks persisted from a previous run (survives restart).
    for (const persisted of loadPersistedTasks()) {
      const t = persisted.task;
      this.tasks.set(t.id, t);
      if (persisted.ownerId) {
        this.owners.set(t.id, persisted.ownerId);
        Object.defineProperty(t, '__ownerId', { value: persisted.ownerId, enumerable: false, writable: true });
      }
      for (const message of t.history) this.messageIndex.set(message.messageId, t.id);
      const set = this.contexts.get(t.contextId) ?? new Set<string>();
      set.add(t.id);
      this.contexts.set(t.contextId, set);
    }
    // Rehydrate ownership from the same store. Without this a restart produced
    // a store where every task looked unowned, so a legitimate owner would be
    // told their task did not exist after a bounce.
    const bindings = loadOwnerBindings();
    for (const b of bindings.tasks) this.owners.set(b.taskId, b.ownerId);
    for (const [contextId, ownerId] of bindings.contexts) this.contextOwners.set(contextId, ownerId);
    this.evict();
  }

  // -------------------------------------------------------------------------
  // Ownership guards — the single place authorization decisions are made.
  // -------------------------------------------------------------------------

  /**
   * Whether an unowned (legacy) task may be read.
   *
   * `ownerId` is always supplied for remote calls and is `undefined` only for
   * the in-process operator listing. Remote principals therefore never match.
   */
  private canReadUnowned(ownerId: OwnerId | undefined): boolean {
    return ownerId === undefined && legacyUnownedVisibility();
  }

  /** True when `ownerId` owns `taskId`. The one task-ownership check. */
  isTaskOwnedBy(taskId: string, ownerId: OwnerId | undefined): boolean {
    if (!ownerId) return false;
    const owner = this.owners.get(taskId);
    if (!owner) return this.canReadUnowned(ownerId);
    return ownerIdMatches(owner, ownerId);
  }

  /** True when `ownerId` owns `contextId`, or the context does not exist yet. */
  isContextOwnedBy(contextId: string, ownerId: OwnerId | undefined): boolean {
    if (!ownerId) return false;
    const owner = this.contextOwners.get(contextId);
    if (!owner) return true; // unclaimed context — first writer binds it
    return ownerIdMatches(owner, ownerId);
  }

  /**
   * Authorize a task access. Returns the task when the caller owns it, else
   * `null` — the caller maps that to the same "not found" answer it gives for a
   * genuinely absent task, so a foreign task's existence is never revealed.
   */
  private authorize(taskId: string, ownerId: OwnerId | undefined): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (!this.isTaskOwnedBy(taskId, ownerId)) {
      logger.warn({ taskId }, 'A2A cross-owner access denied');
      return null;
    }
    return task;
  }

  // -------------------------------------------------------------------------
  // Owner-scoped API (the ONLY surface jsonrpc.ts / handler.ts may use)
  // -------------------------------------------------------------------------

  /** Owner-scoped task read. `null` when absent, unowned-by-caller, or unauthenticated. */
  getOwnedTask(ownerId: OwnerId | undefined, id: string, historyLength?: number): Task | null {
    const task = this.authorize(id, ownerId);
    if (!task) return null;
    if (historyLength === undefined) return task;
    // `slice(-0)` is `slice(0)` — the WHOLE array. A caller asking for
    // historyLength: 0 (no history) must get an empty array, so zero is
    // special-cased rather than left to the negative-index trick.
    return { ...task, history: historyLength === 0 ? [] : task.history.slice(-historyLength) };
  }

  /**
   * Owner-scoped listing, newest first.
   *
   * This is the entry point every remote surface uses, so it is defined for the
   * NO-principal case too: an unauthenticated caller sees nothing (or, under the
   * documented legacy-unowned opt-in, only the unowned set). It must never fall
   * through to the unfiltered store — doing so handed every task in the process
   * to an anonymous `tasks/list`.
   */
  listOwnedTasks(
    ownerId: OwnerId | undefined,
    opts: {
      state?: TaskState;
      contextId?: string;
      limit?: number;
      includeHistory?: boolean;
      pageToken?: string;
    } = {},
  ): Task[] {
    const authorized = ownerId
      ? (taskId: string) => this.isTaskOwnedBy(taskId, ownerId)
      : (taskId: string) => !this.owners.has(taskId) && legacyUnownedVisibility();
    return this.listTasks({ ...opts, authorized });
  }

  /** Owner-scoped retained-task count (backs the legacy REST `retained` field). */
  ownedTaskCount(ownerId: OwnerId | undefined): number {
    if (ownerId) {
      let count = 0;
      for (const id of this.tasks.keys()) if (this.isTaskOwnedBy(id, ownerId)) count++;
      return count;
    }
    let count = 0;
    for (const id of this.tasks.keys()) {
      if (!this.owners.has(id) && legacyUnownedVisibility()) count++;
    }
    return count;
  }

  /** Owner-scoped cancel. Aborts any in-flight downstream request. */
  cancelOwnedTask(ownerId: OwnerId | undefined, id: string): { task?: Task; error?: 'not-found' | 'not-cancelable' } {
    if (!this.authorize(id, ownerId)) return { error: 'not-found' };
    return this.cancelTask(id);
  }

  /** Owner-scoped push-config write. Validates the URL before storing it. */
  async setOwnedPushConfig(
    ownerId: OwnerId | undefined,
    id: string,
    config: PushNotificationConfig,
  ): Promise<boolean> {
    if (!this.authorize(id, ownerId)) return false;
    return this.setPushConfig(id, config);
  }

  /** Owner-scoped push-config read. */
  getOwnedPushConfig(ownerId: OwnerId | undefined, id: string): PushNotificationConfig | null {
    if (!this.authorize(id, ownerId)) return null;
    return this.getPushConfig(id);
  }

  /** Owner-scoped subscribe. Returns a no-op unsubscribe when not authorized. */
  subscribeOwned(ownerId: OwnerId | undefined, id: string, listener: TaskListener): () => void {
    if (!this.authorize(id, ownerId)) return () => {};
    return this.subscribe(id, listener);
  }

  /**
   * Create a task from an inbound user message (spec: message/send), binding it
   * immutably to `opts.ownerId`.
   *
   * If `message.taskId` names a task that already exists, this CONTINUES that
   * task (appends to its history) rather than silently replacing it — replacing
   * destroyed all prior history and artifacts, breaking multi-turn. Continuing a
   * task that already reached a terminal state is rejected: per spec a terminal
   * task is immutable and follow-up turns belong to a NEW task sharing the same
   * `contextId`.
   *
   * Ownership: continuing an existing task requires owning it, and reusing an
   * existing `contextId` requires owning that context. Without both checks a
   * second caller could attach a turn to someone else's task — or, by naming
   * only their `contextId`, silently append into a private conversation.
   */
  createTask(
    message: TaskMessage,
    opts?: { contextId?: string; metadata?: Record<string, unknown>; ownerId?: OwnerId },
  ): CreateTaskResult {
    const ownerId = opts?.ownerId;
    const existing = message.taskId ? this.tasks.get(message.taskId) : undefined;
    if (existing) {
      // The single ownership check. This used to sit behind an earlier
      // `owners.get(id) !== ownerId` branch that answered 'terminal-task', which
      // jsonrpc.ts reported as INVALID_PARAMS "Task is in a terminal state" —
      // wrong semantics, and an existence oracle: it told a stranger that another
      // principal's task id exists and is finished, while a genuinely unknown id
      // quietly created a new task. `errorOwner` maps to TASK_NOT_FOUND, the same
      // answer a missing task gets.
      if (!this.isTaskOwnedBy(existing.id, ownerId)) {
        logger.warn({ taskId: existing.id }, 'A2A cross-owner task continuation denied');
        return { errorOwner: 'forbidden' };
      }
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
    // Reusing another principal's contextId would splice this turn into their
    // conversation, so a context is claimed by its first writer and never shared.
    if (!this.isContextOwnedBy(contextId, ownerId)) {
      logger.warn({ contextId }, 'A2A cross-owner context continuation denied');
      return { errorContext: 'forbidden' };
    }
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
    if (opts?.ownerId) {
      this.owners.set(id, opts.ownerId);
      Object.defineProperty(task, '__ownerId', { value: opts.ownerId, enumerable: false, writable: true });
    }
    this.messageIndex.set(message.messageId, id);
    const set = this.contexts.get(contextId) ?? new Set<string>();
    set.add(id);
    this.contexts.set(contextId, set);
    // Bind BEFORE the task is observable, so there is no window in which a task
    // exists but nobody owns it (which would make it an unowned legacy task).
    if (ownerId) {
      this.owners.set(id, ownerId);
      if (!this.contextOwners.has(contextId)) this.contextOwners.set(contextId, ownerId);
      persistOwnerBinding(id, contextId, ownerId);
    }
    persistTask(task);
    this.evict();

    logger.info({ taskId: id, contextId }, 'A2A task created');
    return { task };
  }

  getTask(id: string, historyLength?: number, ownerId?: string): Task | null {
    const task = this.tasks.get(id);
    if (ownerId && this.owners.get(id) !== ownerId) return null;
    if (!task) return null;
    if (historyLength === undefined) return task;
    // Same zero special-case as getOwnedTask: slice(-0) returns everything.
    return { ...task, history: historyLength === 0 ? [] : task.history.slice(-historyLength) };
  }

  /**
   * All tasks, newest first, for operator-facing listing.
   *
   * The spec has no `tasks/list` method — a peer agent only ever addresses a
   * task it already holds an id for. But an operator watching this agent needs
   * to see what it is working on, so this backs the admin-only
   * `GET /a2a/tasks` route rather than the JSON-RPC surface.
   *
   * `history` is dropped by default: a listing renders status and timing, and
   * full transcripts for every retained task would dominate the payload.
   *
   * When `opts.authorized` is supplied the result is restricted to the tasks it
   * approves. It is omitted only by the in-process operator path, which runs
   * behind the MCP server's own listener rather than the A2A transport.
   *
   * When `opts.pageToken` is supplied the window resumes after that cursor
   * instead of restarting at the newest task. An unparseable or unknown token
   * yields an EMPTY page rather than page 1: handing back page 1 to a client
   * that is looping on `nextPageToken` never terminates.
   */
  listTasks(
    opts: {
      state?: TaskState;
      contextId?: string;
      limit?: number;
      includeHistory?: boolean;
      /** Restricts the result to the tasks this predicate authorizes. */
      authorized?: (taskId: string) => boolean;
      /** Opaque cursor from a previous page's `nextPageToken`. */
      pageToken?: string;
    } = {},
  ): Task[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const { authorized, ...filters } = opts;

    let tasks = Array.from(this.tasks.values());
    // Filter BEFORE slicing to `limit`, so an unauthorized task cannot displace
    // an authorized one from the page.
    if (authorized) tasks = tasks.filter((t) => authorized(t.id));
    if (filters.state) tasks = tasks.filter((t) => t.status.state === filters.state);
    if (filters.contextId) tasks = tasks.filter((t) => t.contextId === filters.contextId);

    // Insertion order is chronological (Map preserves it, and ids are only
    // ever added), so reversing gives newest-first without needing a timestamp
    // that Task does not carry.
    tasks = tasks.reverse();

    if (filters.pageToken) {
      const cursor = decodeTaskCursor(filters.pageToken);
      // No cursor, or one that no longer names a retained task (evicted, or a
      // token from a different filter set): terminate the walk.
      if (!cursor) return [];
      const at = tasks.findIndex((t) => t.id === cursor);
      tasks = at < 0 ? [] : tasks.slice(at + 1);
    }

    tasks = tasks.slice(0, limit);

    if (filters.includeHistory) return tasks;
    return tasks.map((t) => ({ ...t, history: [] }));
  }

  /**
   * Encode the cursor that resumes a listing strictly after `taskId`.
   *
   * The token is opaque base64url. It carries no task data, so a client cannot
   * read another principal's ids out of it; it is a position, not a payload.
   */
  nextPageTokenFor(taskId: string | undefined): string {
    if (!taskId) return '';
    return Buffer.from(JSON.stringify({ v: 1, after: taskId }), 'utf8').toString('base64url');
  }

  /** Number of retained tasks, before any filtering. */
  taskCount(): number {
    return this.tasks.size;
  }

  /** All tasks sharing a contextId, oldest first (used to rebuild multi-turn context). */
  getContextTasks(contextId: string, ownerId?: string): Task[] {
    const ids = this.contexts.get(contextId);
    if (!ids) return [];
    const out: Task[] = [];
    for (const id of ids) {
      const t = this.tasks.get(id);
      if (t && (!ownerId || this.owners.get(t.id) === ownerId)) out.push(t);
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

  /**
   * Cancel a task. Returns { task } or an error reason for JSON-RPC mapping.
   *
   * Cancelling also ABORTS the in-flight downstream dispatch. Otherwise the
   * upstream HTTP request (and the provider call behind it) kept running to
   * completion after the client had been told the task was canceled, burning
   * quota for a result nobody would ever read.
   */
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
    // Abort AFTER the terminal status is set, so the aborted dispatch's own
    // error path observes an already-terminal task and cannot resurrect it.
    this.abortDispatch(id);
    this.emit(task);
    logger.info({ taskId: id }, 'A2A task canceled');
    return { task };
  }

  // -------------------------------------------------------------------------
  // In-flight dispatch registry (cancellation)
  // -------------------------------------------------------------------------

  /**
   * Register the AbortController for a task's downstream dispatch. A second
   * dispatch for the same task aborts the first so they cannot interleave.
   * Returns a disposer that only clears the entry if it is still ours.
   */
  registerDispatch(id: string, controller: AbortController): () => void {
    this.inflight.get(id)?.abort(new Error('superseded by a newer dispatch'));
    this.inflight.set(id, controller);
    return () => {
      if (this.inflight.get(id) === controller) this.inflight.delete(id);
    };
  }

  /** Abort a task's in-flight downstream request, if any. */
  abortDispatch(id: string): boolean {
    const controller = this.inflight.get(id);
    if (!controller) return false;
    this.inflight.delete(id);
    controller.abort(new Error('A2A task canceled'));
    return true;
  }

  /** True when a downstream request is currently in flight for a task. */
  isDispatchInflight(id: string): boolean {
    return this.inflight.has(id);
  }

  /** True if the task exists and has already reached a terminal state. */
  isTaskTerminal(id: string): boolean {
    const task = this.tasks.get(id);
    return !!task && isTerminal(task.status.state);
  }

  setPushConfig(id: string, config: PushNotificationConfig, ownerId?: string): boolean {
    if (!this.tasks.has(id)) return false;
    if (ownerId && this.owners.get(id) !== ownerId) return false;
    this.push.set(id, config);
    persistPushConfig(id, config);
    return true;
  }

  getPushConfig(id: string, ownerId?: string): PushNotificationConfig | null {
    if (ownerId && this.owners.get(id) !== ownerId) return null;
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
      this.owners.delete(id);
      this.inflight.delete(id);
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
