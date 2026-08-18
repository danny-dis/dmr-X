/**
 * A2A Protocol HTTP transport.
 *
 * Framing only — protocol logic lives in jsonrpc.ts. Surfaces:
 *   - GET  /.well-known/agent-card.json  Agent Card discovery (spec current)
 *   - GET  /.well-known/agent.json       Agent Card discovery (legacy alias)
 *   - POST /a2a                          JSON-RPC 2.0 endpoint (send/get/cancel/…)
 *                                        SSE response for streaming methods
 *   - Legacy REST shims (back-compat, thin wrappers over the JSON-RPC core):
 *     POST /a2a/tasks/send, /a2a/tasks/get, /a2a/tasks/cancel
 *     GET  /a2a/tasks/:id
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createLogger } from '@dmr-x/utils';

import type { RequestHeaders } from '../tenant-key.js';
import { buildAgentCard, type AgentCardConfig } from './agent-card.js';
import {
  handleRpc,
  handleRpcStream,
  isStreamMethod,
  rpcError,
  A2A_ERR,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StreamSink,
} from './jsonrpc.js';
import { getTaskManager } from './task-manager.js';

const logger = createLogger('mcp-server:a2a:handler');

export interface A2AHandlerConfig {
  agentCard?: AgentCardConfig;
  enabled?: boolean;
}

type ToolList = Array<{ name: string; description: string; modality?: string }>;

export async function handleA2ARoutes(
  req: IncomingMessage,
  res: ServerResponse,
  config?: A2AHandlerConfig,
  tools?: ToolList,
): Promise<boolean> {
  if (config?.enabled === false) return false;

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // --- Agent Card discovery (current + legacy paths) ---
  if (
    (path === '/.well-known/agent-card.json' || path === '/.well-known/agent.json') &&
    req.method === 'GET'
  ) {
    sendJson(res, 200, buildAgentCard(config?.agentCard || {}, tools || []));
    return true;
  }

  // --- Primary JSON-RPC 2.0 endpoint ---
  if (path === '/a2a' && req.method === 'POST') {
    return handleJsonRpc(req, res);
  }

  // --- Legacy REST shims (map onto JSON-RPC methods) ---
  if (path === '/a2a/tasks/send' && req.method === 'POST') {
    return legacyShim(req, res, 'message/send', (b) => ({ message: b.message }));
  }
  if (path === '/a2a/tasks/get' && req.method === 'POST') {
    return legacyShim(req, res, 'tasks/get', (b) => ({ id: b.id }));
  }
  if (path === '/a2a/tasks/cancel' && req.method === 'POST') {
    return legacyShim(req, res, 'tasks/cancel', (b) => ({ id: b.id }));
  }
  // --- Operator listing (not part of the A2A spec) ---
  //
  // A2A peers only ever address a task they already hold an id for, so the
  // JSON-RPC surface has no list method. The gateway's admin UI needs one to
  // show what this agent is currently working on, and proxies to it.
  if (path === '/a2a/tasks' && req.method === 'GET') {
    const state = url.searchParams.get('state') ?? undefined;
    const contextId = url.searchParams.get('contextId') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const manager = getTaskManager();
    const tasks = manager.listTasks({
      state: state as never,
      contextId,
      limit: Number.isFinite(limit) ? limit : undefined,
      includeHistory: url.searchParams.get('includeHistory') === 'true',
    });

    sendJson(res, 200, { tasks, total: tasks.length, retained: manager.taskCount() });
    return true;
  }

  const taskIdMatch = path.match(/^\/a2a\/tasks\/([^/]+)$/);
  if (taskIdMatch && req.method === 'GET') {
    const task = getTaskManager().getTask(taskIdMatch[1]);
    if (!task) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }
    sendJson(res, 200, task);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

async function handleJsonRpc(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let parsed: unknown;
  try {
    const body = await readRaw(req);
    parsed = body ? JSON.parse(body) : {};
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJsonAndClose(req, res, 413, rpcError(null, A2A_ERR.INVALID_REQUEST, err.message));
      return true;
    }
    sendJson(res, 200, rpcError(null, A2A_ERR.PARSE, 'Parse error'));
    return true;
  }

  const headers = req.headers as RequestHeaders;

  // JSON-RPC 2.0 batch: an array of requests answered with an array of
  // responses. Previously any array was rejected outright as -32600.
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      sendJson(res, 200, rpcError(null, A2A_ERR.INVALID_REQUEST, 'Invalid JSON-RPC request'));
      return true;
    }
    if (parsed.length > MAX_BATCH_SIZE) {
      sendJson(res, 200, rpcError(null, A2A_ERR.INVALID_REQUEST, `Batch too large — max ${MAX_BATCH_SIZE} requests`));
      return true;
    }
    const responses: JsonRpcResponse[] = [];
    for (const entry of parsed) {
      const item = entry as JsonRpcRequest;
      if (!item || typeof item !== 'object' || item.jsonrpc !== '2.0' || typeof item.method !== 'string') {
        responses.push(rpcError((item as JsonRpcRequest)?.id ?? null, A2A_ERR.INVALID_REQUEST, 'Invalid JSON-RPC request'));
        continue;
      }
      if (isStreamMethod(item.method)) {
        responses.push(rpcError(item.id ?? null, A2A_ERR.UNSUPPORTED_OPERATION, 'Streaming methods cannot be batched'));
        continue;
      }
      try {
        const result = await handleRpc(item, headers);
        // Notifications (no `id`) get no response entry, per JSON-RPC 2.0.
        if (item.id !== undefined && item.id !== null) responses.push(result);
      } catch (err) {
        logger.error({ err, method: item.method }, 'A2A JSON-RPC batch entry error');
        if (item.id !== undefined && item.id !== null) {
          responses.push(rpcError(item.id, A2A_ERR.INTERNAL, 'Internal error'));
        }
      }
    }
    if (responses.length === 0) {
      res.writeHead(204).end();
      return true;
    }
    sendJson(res, 200, responses);
    return true;
  }

  const rpc = parsed as JsonRpcRequest;
  if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    sendJson(res, 200, rpcError(rpc?.id ?? null, A2A_ERR.INVALID_REQUEST, 'Invalid JSON-RPC request'));
    return true;
  }

  // A request without `id` is a JSON-RPC notification — the server MUST NOT
  // reply. It previously got a full response body with `id: null`.
  const isNotification = rpc.id === undefined;

  // Streaming methods → SSE.
  const accept = String(req.headers.accept || '');
  if (isStreamMethod(rpc.method) || accept.includes('text/event-stream')) {
    if (!isStreamMethod(rpc.method)) {
      // Client asked for SSE on a non-streaming method — answer as a single event.
      const result = await handleRpc(rpc, headers);
      openSse(res);
      writeSse(res, result);
      res.end();
      return true;
    }
    openSse(res);
    const sink: StreamSink = {
      send: (event: JsonRpcResponse) => writeSse(res, event),
      end: () => res.end(),
    };
    await handleRpcStream(rpc, headers, sink);
    return true;
  }

  // Blocking methods → single JSON response.
  try {
    const result = await handleRpc(rpc, headers);
    if (isNotification) res.writeHead(204).end();
    else sendJson(res, 200, result);
  } catch (err) {
    logger.error({ err, method: rpc.method }, 'A2A JSON-RPC handler error');
    if (isNotification) res.writeHead(204).end();
    else sendJson(res, 200, rpcError(rpc.id ?? null, A2A_ERR.INTERNAL, 'Internal error'));
  }
  return true;
}

/** Bridge a legacy REST call to a JSON-RPC method and return the raw result. */
async function legacyShim(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  toParams: (body: Record<string, any>) => Record<string, unknown>,
): Promise<boolean> {
  let body: Record<string, any> = {};
  try {
    const raw = await readRaw(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJsonAndClose(req, res, 413, { error: err.message });
      return true;
    }
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return true;
  }
  const rpc: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method, params: toParams(body) };
  const result = await handleRpc(rpc, req.headers as RequestHeaders);
  if (result.error) {
    const status = result.error.code === A2A_ERR.TASK_NOT_FOUND ? 404 : 400;
    sendJson(res, status, { error: result.error.message });
    return true;
  }
  sendJson(res, 200, result.result);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Answer a request whose body was rejected part-way through.
 *
 * The remaining upload is never drained, so the connection must be closed after
 * the response — otherwise keep-alive would try to parse the unread body bytes
 * as the next request.
 */
function sendJsonAndClose(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
  res.end(JSON.stringify(data), () => {
    req.destroy();
  });
}

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Stop reverse proxies from buffering the stream into a single blob.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function writeSse(res: ServerResponse, event: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Raised by readRaw when the request body exceeds the configured ceiling. */
class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds the ${limit} byte A2A limit`);
    this.name = 'PayloadTooLargeError';
  }
}

/** Default max A2A request body (bytes). Override with DMRX_A2A_MAX_BODY_BYTES. */
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Max JSON-RPC batch size — prevents a client from flooding the event loop. */
const MAX_BATCH_SIZE = 100;

function maxBodyBytes(): number {
  const raw = Number(process.env.DMRX_A2A_MAX_BODY_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Buffer the request body, bounded.
 *
 * The unbounded version let any unauthenticated client stream arbitrarily many
 * bytes straight into process memory (a 50MB POST was accepted and retained in
 * full), so the endpoint was a trivial memory-exhaustion vector.
 */
async function readRaw(req: IncomingMessage): Promise<string> {
  const limit = maxBodyBytes();

  // Reject on the declared Content-Length before a single body byte is read, so
  // an oversized upload costs nothing and the client gets its 413 immediately
  // instead of after streaming the whole payload.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new PayloadTooLargeError(limit);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      // Stop reading but do NOT destroy the socket here — the caller still has
      // to write the error response, and destroying first loses it.
      req.pause();
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buf = chunk as Buffer;
      size += buf.length;
      // Enforced independently of Content-Length: a chunked (or lying) client
      // can otherwise stream unbounded bytes into memory.
      if (size > limit) {
        fail(new PayloadTooLargeError(limit));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', fail);
  });
}
