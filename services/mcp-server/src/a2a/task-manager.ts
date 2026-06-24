/**
 * A2A Task Manager
 * 
 * Manages agent-to-agent tasks including task creation,
 * status tracking, and result handling.
 * 
 * Based on Google's A2A protocol specification.
 */

import crypto from 'node:crypto';

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:a2a:task-manager');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskState = 
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected';

export interface TaskMessage {
  /** Message role */
  role: 'user' | 'agent';
  /** Message parts */
  parts: TaskPart[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface TaskPart {
  /** Part type */
  type: 'text' | 'data' | 'file';
  /** Text content (for text parts) */
  text?: string;
  /** Data content (for data parts) */
  data?: unknown;
  /** File metadata (for file parts) */
  file?: {
    name: string;
    mimeType: string;
    uri?: string;
    bytes?: string;
  };
}

export interface Task {
  /** Task ID */
  id: string;
  /** Session ID */
  sessionId?: string;
  /** Task status */
  status: TaskStatus;
  /** Task messages */
  messages: TaskMessage[];
  /** Task artifacts */
  artifacts: TaskArtifact[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  /** Current task state */
  state: TaskState;
  /** Status message */
  message?: string;
  /** Timestamp */
  timestamp: string;
}

export interface TaskArtifact {
  /** Artifact ID */
  id: string;
  /** Artifact name */
  name?: string;
  /** Artifact parts */
  parts: TaskPart[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface TaskCreateRequest {
  /** Task ID (optional, will be generated if not provided) */
  id?: string;
  /** Session ID */
  sessionId?: string;
  /** Initial message */
  message?: TaskMessage;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface TaskGetRequest {
  /** Task ID */
  id: string;
  /** Session ID */
  sessionId?: string;
  /** Include history */
  historyLength?: number;
}

export interface TaskUpdateRequest {
  /** Task ID */
  id: string;
  /** Session ID */
  sessionId?: string;
  /** New status */
  status?: TaskStatus;
  /** Additional messages */
  messages?: TaskMessage[];
  /** Artifacts */
  artifacts?: TaskArtifact[];
}

export interface TaskCancelRequest {
  /** Task ID */
  id: string;
  /** Session ID */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Task Manager
// ---------------------------------------------------------------------------

/**
 * A2A Task Manager for handling agent-to-agent tasks
 */
export class A2ATaskManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, Set<string>>();

  /**
   * Create a new task
   */
  createTask(request: TaskCreateRequest): Task {
    const taskId = request.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const task: Task = {
      id: taskId,
      sessionId: request.sessionId,
      status: {
        state: 'submitted',
        timestamp: now,
      },
      messages: request.message ? [request.message] : [],
      artifacts: [],
      metadata: request.metadata,
    };

    this.tasks.set(taskId, task);

    // Track session
    if (request.sessionId) {
      const sessionTasks = this.sessions.get(request.sessionId) || new Set();
      sessionTasks.add(taskId);
      this.sessions.set(request.sessionId, sessionTasks);
    }

    logger.info({ taskId, sessionId: request.sessionId }, 'Task created');
    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(request: TaskGetRequest): Task | null {
    return this.tasks.get(request.id) || null;
  }

  /**
   * Update a task
   */
  updateTask(request: TaskUpdateRequest): Task | null {
    const task = this.tasks.get(request.id);
    if (!task) return null;

    if (request.status) {
      task.status = {
        ...task.status,
        ...request.status,
        timestamp: new Date().toISOString(),
      };
    }

    if (request.messages) {
      task.messages.push(...request.messages);
    }

    if (request.artifacts) {
      task.artifacts.push(...request.artifacts);
    }

    logger.info({ taskId: request.id, state: task.status.state }, 'Task updated');
    return task;
  }

  /**
   * Cancel a task
   */
  cancelTask(request: TaskCancelRequest): Task | null {
    const task = this.tasks.get(request.id);
    if (!task) return null;

    task.status = {
      state: 'canceled',
      message: 'Task canceled by user',
      timestamp: new Date().toISOString(),
    };

    logger.info({ taskId: request.id }, 'Task canceled');
    return task;
  }

  /**
   * List tasks for a session
   */
  listTasks(sessionId?: string): Task[] {
    if (!sessionId) {
      return Array.from(this.tasks.values());
    }

    const taskIds = this.sessions.get(sessionId);
    if (!taskIds) return [];

    return Array.from(taskIds)
      .map((id) => this.tasks.get(id))
      .filter((task): task is Task => task !== undefined);
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove from session tracking
    if (task.sessionId) {
      const sessionTasks = this.sessions.get(task.sessionId);
      if (sessionTasks) {
        sessionTasks.delete(taskId);
        if (sessionTasks.size === 0) {
          this.sessions.delete(task.sessionId);
        }
      }
    }

    this.tasks.delete(taskId);
    logger.info({ taskId }, 'Task deleted');
    return true;
  }

  /**
   * Get task statistics
   */
  getStats(): {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalSessions: number;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      totalTasks: tasks.length,
      activeTasks: tasks.filter((t) => ['submitted', 'working', 'input-required'].includes(t.status.state)).length,
      completedTasks: tasks.filter((t) => t.status.state === 'completed').length,
      failedTasks: tasks.filter((t) => ['canceled', 'failed', 'rejected'].includes(t.status.state)).length,
      totalSessions: this.sessions.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: A2ATaskManager | null = null;

export function getTaskManager(): A2ATaskManager {
  if (!instance) {
    instance = new A2ATaskManager();
  }
  return instance;
}

export function resetTaskManager(): void {
  instance = null;
}