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

/** Default wall-clock ceiling for one gateway dispatch (ms). */
const DEFAULT_TASK_TIMEOUT_MS = 60_000;

/** Extended timeout for multi-turn contexts (ms) — longer conversations need more processing time. */
const MULTI_TURN_TASK_TIMEOUT_MS = 120_000;

function taskTimeoutMs(turnCount: number): number {
  const raw = Number(process.env.DMRX_A2A_TASK_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return turnCount > 2 ? MULTI_TURN_TASK_TIMEOUT_MS : DEFAULT_TASK_TIMEOUT_MS;
}

/** Max conversation turns forwarded downstream (newest kept). */
const MAX_CONTEXT_MESSAGES = 20;

/**
 * Build the full downstream conversation for a task, so multi-turn actually
 * carries context. Previously every turn was dispatched as a bare task string,
 * so the agent had amnesia between turns of the same `contextId`.
 *
 * The CURRENT turn is included as the final entry: `/v1/agentic/dispatch`
 * treats `messages` as a full override of `task` (it only falls back to `task`
 * when `messages` is absent), so omitting the current turn here would send the
 * model the history and never the actual question.
 *
 * Returns `null` when there is no prior context — the caller then sends the
 * plain `task` field and lets the gateway build the message list.
 */
function buildContextMessages(
  task: Task,
  currentText: string,
): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  const tm = getTaskManager();
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const siblings = tm
    .getContextTasks(task.contextId)
    .filter((t) => t.id !== task.id)
    .sort((a, b) => a.status.timestamp.localeCompare(b.status.timestamp));

  // Prior tasks in this context, then earlier turns of the current task.
  for (const t of [...siblings, task]) {
    const history = t === task ? task.history.slice(0, -1) : t.history;
    for (const msg of history) {
      const content = messageText(msg);
      if (!content) continue;
      out.push({ role: msg.role === 'agent' ? 'assistant' : 'user', content });
    }
  }
  if (out.length === 0) return null;

  // Keep the newest turns, then append the turn being dispatched.
  const trimmed = out.slice(-MAX_CONTEXT_MESSAGES);
  trimmed.push({ role: 'user', content: currentText });
  return trimmed;
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

  const messages = buildContextMessages(task, taskText);
  const turnCount = messages ? messages.length : 1;

  try {
    const res = await fetch(`${gatewayUrl}/v1/agentic/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        task: taskText,
        run: true,
        ...(messages ? { messages } : {}),
      }),
      // Without a deadline a wedged gateway pins the A2A request open forever;
      // the client sees a hang instead of a `failed` task.
      signal: AbortSignal.timeout(taskTimeoutMs(turnCount)),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return finalize(taskId, 'failed', json?.error?.message || `Dispatch failed (HTTP ${res.status})`);
    }
    const resultText =
      typeof json.content === 'string' ? json.content : JSON.stringify(json.content ?? json);
    return finalize(taskId, 'completed', resultText);
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const text = timedOut
      ? `Dispatch timed out after ${taskTimeoutMs(turnCount)}ms`
      : `Dispatch error: ${err instanceof Error ? err.message : String(err)}`;
    return finalize(taskId, 'failed', text);
  }
}

/**
 * Attach a result/error artifact + agent message and set terminal status.
 *
 * If the task already reached a terminal state while the dispatch was in flight
 * (the client called `tasks/cancel`), the late result is DROPPED — a canceled
 * task must never be resurrected as `completed`.
 */
function finalize(taskId: string, state: 'completed' | 'failed', text: string): Task {
  const tm = getTaskManager();
  if (tm.isTaskTerminal(taskId)) {
    logger.info({ taskId, attempted: state }, 'A2A dispatch result discarded — task already terminal');
    return tm.getTask(taskId)!;
  }
  const artifact: TaskArtifact = {
    artifactId: state === 'completed' ? 'result' : 'error',
    name: state === 'completed' ? 'result' : 'error',
    parts: [{ kind: 'text', text }],
  };
  tm.addArtifact(taskId, artifact);
  const task = tm.setStatus(taskId, state, textMessage('agent', text, { taskId }));
  // Fire push notification (best-effort) on terminal state.
  if (task) void firePushNotification(task);
  // setStatus returns null only if the task vanished or raced into a terminal
  // state between the guard above and here; fall back to the stored task.
  return task ?? tm.getTask(taskId)!;
}
