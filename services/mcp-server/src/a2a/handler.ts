/**
 * A2A Protocol HTTP Handler
 * 
 * Implements the A2A protocol endpoints for agent-to-agent communication.
 * 
 * Endpoints:
 * - GET /.well-known/agent.json - Agent Card discovery
 * - POST /a2a/tasks/send - Send a task to the agent
 * - POST /a2a/tasks/get - Get task status
 * - POST /a2a/tasks/cancel - Cancel a task
 * - GET /a2a/tasks/{taskId} - Get task by ID (RESTful)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createLogger } from '@dmr-x/utils';

import { buildAgentCard, type AgentCardConfig } from './agent-card.js';
import { getTaskManager, type TaskCreateRequest, type TaskMessage } from './task-manager.js';

const logger = createLogger('mcp-server:a2a:handler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface A2AHandlerConfig {
  /** Agent Card configuration */
  agentCard?: AgentCardConfig;
  /** Enable A2A protocol */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// A2A Protocol Handler
// ---------------------------------------------------------------------------

/**
 * Handle A2A protocol HTTP requests
 */
export async function handleA2ARoutes(
  req: IncomingMessage,
  res: ServerResponse,
  config?: A2AHandlerConfig,
  tools?: Array<{ name: string; description: string; modality?: string }>
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // Check if A2A is enabled
  if (config?.enabled === false) {
    return false;
  }

  // Agent Card discovery endpoint
  if (path === '/.well-known/agent.json' && req.method === 'GET') {
    const agentCard = buildAgentCard(config?.agentCard || {}, tools || []);
    sendJson(res, 200, agentCard);
    return true;
  }

  // A2A task endpoints
  if (path === '/a2a/tasks/send' && req.method === 'POST') {
    return handleTaskSend(req, res);
  }

  if (path === '/a2a/tasks/get' && req.method === 'POST') {
    return handleTaskGet(req, res);
  }

  if (path === '/a2a/tasks/cancel' && req.method === 'POST') {
    return handleTaskCancel(req, res);
  }

  // RESTful task endpoint
  const taskIdMatch = path.match(/^\/a2a\/tasks\/([^/]+)$/);
  if (taskIdMatch && req.method === 'GET') {
    return handleTaskGetById(res, taskIdMatch[1]);
  }

  // Not an A2A route
  return false;
}

// ---------------------------------------------------------------------------
// Task Handlers
// ---------------------------------------------------------------------------

async function handleTaskSend(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    const body = await readBody(req);
    
    if (!body.message) {
      sendJson(res, 400, { error: 'Missing message parameter' });
      return true;
    }

    const taskManager = getTaskManager();
    const task = taskManager.createTask({
      id: body.id as string | undefined,
      sessionId: body.sessionId as string | undefined,
      message: body.message as TaskMessage,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });

    // Update task to working state
    taskManager.updateTask({
      id: task.id,
      status: {
        state: 'working',
        timestamp: new Date().toISOString(),
      },
    });

    // TODO: Process the task asynchronously
    // For now, just return the task with working status
    sendJson(res, 200, {
      id: task.id,
      status: task.status,
      sessionId: task.sessionId,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Failed to send task');
    sendJson(res, 500, { error: message });
    return true;
  }
}

async function handleTaskGet(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    const body = await readBody(req);
    
    if (!body.id) {
      sendJson(res, 400, { error: 'Missing task ID' });
      return true;
    }

    const taskManager = getTaskManager();
    const task = taskManager.getTask({ id: body.id as string });

    if (!task) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }

    sendJson(res, 200, task);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Failed to get task');
    sendJson(res, 500, { error: message });
    return true;
  }
}

async function handleTaskCancel(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    const body = await readBody(req);
    
    if (!body.id) {
      sendJson(res, 400, { error: 'Missing task ID' });
      return true;
    }

    const taskManager = getTaskManager();
    const task = taskManager.cancelTask({ id: body.id as string });

    if (!task) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }

    sendJson(res, 200, {
      id: task.id,
      status: task.status,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Failed to cancel task');
    sendJson(res, 500, { error: message });
    return true;
  }
}

async function handleTaskGetById(res: ServerResponse, taskId: string): Promise<boolean> {
  const taskManager = getTaskManager();
  const task = taskManager.getTask({ id: taskId });

  if (!task) {
    sendJson(res, 404, { error: 'Task not found' });
    return true;
  }

  sendJson(res, 200, task);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}