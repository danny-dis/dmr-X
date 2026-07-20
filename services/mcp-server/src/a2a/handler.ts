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
  let rpc: JsonRpcRequest;
  try {
    const body = await readRaw(req);
    rpc = body ? JSON.parse(body) : ({} as JsonRpcRequest);
  } catch {
    sendJson(res, 200, rpcError(null, A2A_ERR.PARSE, 'Parse error'));
    return true;
  }

  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    sendJson(res, 200, rpcError(rpc.id ?? null, A2A_ERR.INVALID_REQUEST, 'Invalid JSON-RPC request'));
    return true;
  }

  const headers = req.headers as RequestHeaders;

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
    sendJson(res, 200, result);
  } catch (err) {
    logger.error({ err, method: rpc.method }, 'A2A JSON-RPC handler error');
    sendJson(res, 200, rpcError(rpc.id ?? null, A2A_ERR.INTERNAL, 'Internal error'));
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
  } catch {
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
  res.end(JSON.stringify(data, null, 2));
}

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

function writeSse(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
