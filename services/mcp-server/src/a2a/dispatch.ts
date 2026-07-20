/**
 * A2A → DMR-X gateway dispatch bridge.
 *
 * Single place that turns an inbound A2A user message into a DMR-X meta-agent
 * dispatch call and maps the result onto the task store. Reused by both the
 * blocking (`message/send`) and streaming (`message/stream`) JSON-RPC methods
 * so the gateway-call logic is not duplicated.
 */

import { createLogger } from '@dmr-x/utils';

import { resolveGatewayKey, type RequestHeaders } from '../tenant-key.js';
import {
  getTaskManager,
  messageText,
  textMessage,
  type Task,
  type TaskArtifact,
} from './task-manager.js';
import { firePushNotification } from './persistence.js';

const logger = createLogger('mcp-server:a2a:dispatch');

export interface DispatchResult {
  task: Task;
}

/**
 * Run a task to completion against the gateway dispatcher and update its state.
 * Never throws — failures land as a `failed` task status so callers can just
 * read the final task.
 */
export async function dispatchTask(taskId: string, headers: RequestHeaders): Promise<Task> {
  const tm = getTaskManager();
  const task = tm.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  tm.setStatus(taskId, 'working');

  const gatewayUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
  const apiKey = resolveGatewayKey(headers);
  const taskText = messageText(task.history[task.history.length - 1]);

  if (!taskText) {
    return finalize(taskId, 'failed', 'Empty task message');
  }
  if (!apiKey) {
    logger.warn({ gatewayUrl }, 'A2A dispatch: no gateway key (DMRX_MCP_AGENT_API_KEY / X-DMR-Tenant-Key)');
    return finalize(taskId, 'failed', 'A2A agent key not configured (DMRX_MCP_AGENT_API_KEY / X-DMR-Tenant-Key)');
  }

  try {
    const res = await fetch(`${gatewayUrl}/v1/agentic/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ task: taskText, run: true }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return finalize(taskId, 'failed', json?.error?.message || `Dispatch failed (HTTP ${res.status})`);
    }
    const resultText =
      typeof json.content === 'string' ? json.content : JSON.stringify(json.content ?? json);
    return finalize(taskId, 'completed', resultText);
  } catch (err) {
    return finalize(taskId, 'failed', `Dispatch error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Attach a result/error artifact + agent message and set terminal status. */
function finalize(taskId: string, state: 'completed' | 'failed', text: string): Task {
  const tm = getTaskManager();
  const artifact: TaskArtifact = {
    artifactId: state === 'completed' ? 'result' : 'error',
    name: state === 'completed' ? 'result' : 'error',
    parts: [{ kind: 'text', text }],
  };
  tm.addArtifact(taskId, artifact);
  const task = tm.setStatus(taskId, state, textMessage('agent', text, { taskId }));
  // Fire push notification (best-effort) on terminal state.
  if (task) void firePushNotification(task);
  return task!;
}
