/**
 * Shared HTTP auth/session helpers for both MCP HTTP listeners (legacy SSE
 * and Streamable HTTP). Small functions only — not a framework.
 *
 * - Bearer policy is built per request from the same three sources the
 *   process supports: simple `DMRX_MCP_API_KEY` / config `apiKey`, detailed
 *   `apiKeysConfig` file records, and `DMRX_MCP_API_KEYS_CONFIG` env JSON.
 *   Malformed configured sources fail closed (deny all).
 * - Identity is the SHA-256 hash of the validated key (see auth-runtime);
 *   the raw key never becomes a principal or an owner id.
 * - Sessions bind to authenticated principal AND downstream tenant header;
 *   ambiguous tenant headers are rejected, never guessed.
 * - Eviction/failure/shutdown close transport AND server exactly once.
 * - MCP protocol versions are restricted to what the installed SDK (2.0.0)
 *   supports. Unsupported versions fail with a clear list; nothing else is
 *   advertised and no initialized state is faked.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  buildBearerAuthPolicy,
  authenticateBearer,
  type AuthenticationResult,
} from './auth-runtime.js';
import {
  readSessionBinding,
  type SessionBinding,
} from './session-runtime.js';
import type { McpConfigFile } from './config.js';

export interface HttpAuthResult extends AuthenticationResult {
  authorized: boolean;
}

/** Build the per-request bearer policy from env + config file. */
export function buildHttpBearerPolicy(configFile: McpConfigFile | null): ReturnType<typeof buildBearerAuthPolicy> {
  return buildBearerAuthPolicy({
    simpleKeys: process.env.DMRX_MCP_API_KEY || configFile?.apiKey || '',
    fileKeyConfigs: configFile?.apiKeysConfig,
    envKeyConfigsRaw: process.env.DMRX_MCP_API_KEYS_CONFIG,
  });
}

/**
 * Authenticate one HTTP request. Writes the failure response and returns
 * `{ authorized: false }` on denial; returns the validated principal (hashed
 * key id, or 'anonymous' when auth is not configured) on success.
 */
export function authenticateHttpRequest(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void },
  configFile: McpConfigFile | null,
): HttpAuthResult {
  const policy = buildHttpBearerPolicy(configFile);
  const result = authenticateBearer(req, policy);
  if (result.authorized) return result;
  if (policy.malformed) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server authentication is misconfigured — refusing requests' }));
    return result;
  }
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — missing Bearer token' }));
    return result;
  }
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — invalid Bearer token' }));
  return result;
}

/**
 * Owner id for A2A task persistence, derived ONLY from validated identity.
 *
 * SEAM (a2a lane owns integration): the A2A handler must call this with the
 * already-authenticated result and persist tasks under the returned id, and
 * enforce it on list/get/cancel/resubscribe/push-config. Tool-restricted keys
 * never reach A2A (denied at the shared HTTP boundary), so a scoped key can
 * neither bypass its policy nor mint tasks owned by someone else. This file
 * does not touch a2a/*.
 */
export function ownerIdForA2A(auth: HttpAuthResult): string {
  if (!auth.authorized) return 'unauthorized';
  return auth.principalId;
}

/** Read and validate the downstream tenant binding; rejects ambiguity. */
export function sessionBindingForRequest(
  req: { headers: Record<string, string | string[] | undefined> },
  principalId: string,
  res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body: string) => void },
): SessionBinding | undefined {
  const parsed = readSessionBinding(req.headers, principalId);
  if (!parsed.ok) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ambiguous tenant key header — refusing to bind session' }));
    return undefined;
  }
  return parsed.binding;
}

/** True when a request's binding still matches the session's stored binding. */
export function isSameSessionBinding(stored: SessionBinding, current: SessionBinding): boolean {
  if (stored.principalId !== current.principalId) return false;
  return (stored.tenantKey ?? undefined) === (current.tenantKey ?? undefined);
}

interface ClosableSession {
  transport?: { close?: () => void | Promise<void> };
  server?: { close?: () => void | Promise<void> };
}

/** Close transport AND server, best-effort, for eviction/failure/shutdown. */
export async function closeHttpSessionResources(session: ClosableSession): Promise<void> {
  try {
    await session.transport?.close?.();
  } catch { /* best-effort */ }
  try {
    await session.server?.close?.();
  } catch { /* best-effort */ }
}

/**
 * Evict the oldest entry of a session map, closing transport AND server
 * exactly once. Returns the evicted id, or undefined when empty.
 */
export async function evictOldestHttpSession<T extends ClosableSession>(
  sessions: Map<string, T>,
  removeSession: (id: string) => void,
  unregisterActiveSession: (id: string) => void,
): Promise<string | undefined> {
  const oldest = sessions.keys().next().value as string | undefined;
  if (!oldest) return undefined;
  const entry = sessions.get(oldest);
  sessions.delete(oldest);
  try {
    removeSession(oldest);
  } catch { /* best-effort */ }
  unregisterActiveSession(oldest);
  if (entry) await closeHttpSessionResources(entry);
  return oldest;
}

// ---------------------------------------------------------------------------
// MCP protocol versions (installed SDK 2.0.0)
// ---------------------------------------------------------------------------

/** Latest version negotiated by the installed SDK. */
export const MCP_LATEST_PROTOCOL_VERSION = '2025-11-25';

/**
 * Every version the installed SDK accepts. Do not advertise anything else;
 * unsupported versions fail with this list instead of a faked session.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

function writeVersionFailure(
  res: ServerResponse,
  message: string,
): void {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS] }));
}

/**
 * Validate the `MCP-Protocol-Version` header for stateful /mcp requests.
 * Missing headers are allowed only when no session exists yet (the
 * initialize path); anything else fails closed with the supported list.
 */
export function checkMcpProtocolVersion(
  req: IncomingMessage,
  res: ServerResponse,
  hasSession: boolean,
): boolean {
  const header = req.headers['mcp-protocol-version'];
  if (Array.isArray(header)) {
    writeVersionFailure(res, 'Ambiguous MCP-Protocol-Version header');
    return false;
  }
  if (header === undefined) {
    if (hasSession) {
      writeVersionFailure(res, 'Missing MCP-Protocol-Version for session request');
      return false;
    }
    return true;
  }
  if (!MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(header)) {
    writeVersionFailure(res, `Unsupported MCP-Protocol-Version "${header}"`);
    return false;
  }
  return true;
}

/** Header/body agreement for initialize-style payloads carrying a version. */
export function checkMcpBodyVersionAgreement(
  res: ServerResponse,
  headerVersion: string | undefined,
  bodyVersion: unknown,
): boolean {
  if (headerVersion === undefined || bodyVersion === undefined) return true;
  if (typeof bodyVersion !== 'string') return true;
  if (headerVersion !== bodyVersion) {
    writeVersionFailure(
      res,
      `MCP-Protocol-Version header "${headerVersion}" does not match body protocolVersion "${bodyVersion}"`,
    );
    return false;
  }
  if (!MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(bodyVersion)) {
    writeVersionFailure(res, `Unsupported body protocolVersion "${bodyVersion}"`);
    return false;
  }
  return true;
}

/**
 * Validate every `initialize` message in a session-less POST body.
 *
 * The installed SDK leniently upgrades an unknown requested version to
 * latest and mints a session; that would fake initialized state for a
 * version we do not support. Fail those bodies here with the supported
 * list instead, and require header/body agreement when the header is set.
 * Non-initialize messages (and unparseable shapes) pass through to the
 * transport, which owns method-level validation.
 */
export function checkMcpInitializeBody(
  res: ServerResponse,
  parsedBody: unknown,
  headerVersion: string | undefined,
): boolean {
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  let checked = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const method = (message as { method?: unknown }).method;
    if (method !== 'initialize') continue;
    const params = (message as { params?: unknown }).params;
    const version = params && typeof params === 'object'
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;
    checked = true;
    if (typeof version !== 'string' || !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      writeVersionFailure(res, `Unsupported initialize protocolVersion "${String(version)}"`);
      return false;
    }
    if (!checkMcpBodyVersionAgreement(res, headerVersion, version)) return false;
  }
  void checked;
  return true;
}
