/**
 * MCP transport + protocol conformance for the owned lane.
 *
 * - Unit: version gate (supported/unsupported/missing/ambiguous header and
 *   header/body agreement), shared HTTP auth/session wiring (config-only and
 *   env-only keys, fail-closed malformed config, hashed owner identity,
 *   ambiguous tenant rejection, eviction closing both resources).
 * - Real interop with the installed SDK (2.0.0) through independent fixtures
 *   (a one-tool McpServer built here, never the production server): legacy
 *   initialize/list/call on an old supported version, current-version
 *   stateful flow via the SDK Client, stateless flow, legacy SSE flow, and a
 *   clear failure for an unsupported version. No production keys, no model
 *   calls, ephemeral loopback ports only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { z } from 'zod/v4';

import {
  buildHttpBearerPolicy,
  authenticateHttpRequest,
  ownerIdForA2A,
  sessionBindingForRequest,
  isSameSessionBinding,
  evictOldestHttpSession,
  checkMcpProtocolVersion,
  checkMcpBodyVersionAgreement,
  checkMcpInitializeBody,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_LATEST_PROTOCOL_VERSION,
} from '../../services/mcp-server/src/http-auth-session.js';
import type { McpConfigFile } from '../../services/mcp-server/src/config.js';

// Independent SDK fixtures (installed SDK only, no production server).
import { McpServer } from '../../services/mcp-server/node_modules/@modelcontextprotocol/server/dist/index.mjs';
import { NodeStreamableHTTPServerTransport } from '../../services/mcp-server/node_modules/@modelcontextprotocol/node/dist/index.mjs';
import { SSEServerTransport } from '../../services/mcp-server/node_modules/@modelcontextprotocol/server-legacy/dist/index.mjs';
import {
  Client,
  StreamableHTTPClientTransport,
  SSEClientTransport,
} from '@modelcontextprotocol/client';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  delete process.env.DMRX_MCP_API_KEYS_CONFIG;
  delete process.env.DMRX_MCP_API_KEY;
});

function resStub() {
  const calls: Array<{ status: number; body: string }> = [];
  return {
    calls,
    res: {
      writeHead(status: number) {
        calls.push({ status, body: '' });
      },
      end(body: string) {
        calls[calls.length - 1].body = body;
      },
    } as unknown as ServerResponse,
  };
}

function reqStub(headers: Record<string, string | string[] | undefined> = {}) {
  return { headers };
}

const initialize = (protocolVersion: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'dmrx-fixture-client', version: '1.0.0' },
  },
});

describe('MCP protocol version gate (installed SDK 2.0.0)', () => {
  it('advertises only supported versions, headed by the latest', () => {
    expect(MCP_LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
    expect([...MCP_SUPPORTED_PROTOCOL_VERSIONS]).toEqual([
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
      '2024-10-07',
    ]);
  });

  it.each([...MCP_SUPPORTED_PROTOCOL_VERSIONS])('accepts supported version %s on a session request', (version) => {
    const { res } = resStub();
    const req = { headers: { 'mcp-protocol-version': version } } as unknown as IncomingMessage;
    expect(checkMcpProtocolVersion(req, res, true)).toBe(true);
  });

  it.each(['1999-12-31', '1.0', '2026-07-28', ''])('rejects unsupported version %s with the supported list', async (version) => {
    const dispatched: string[] = [];
    const server = createServer((req, res) => {
      if (!checkMcpProtocolVersion(req, res, false)) return;
      dispatched.push(req.url || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'mcp-protocol-version': version } });
    expect(response.status).toBe(400);
    expect(dispatched).toEqual([]);
    const body = (await response.json()) as { error: string; supported: string[] };
    expect(body.error).toMatch(/Unsupported MCP-Protocol-Version/);
    expect(body.supported).toEqual([...MCP_SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it('allows a missing header only before a session exists', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      const hasSession = req.url === '/mcp-existing';
      if (!checkMcpProtocolVersion(req, res, hasSession)) return;
      seen.push(req.url || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    expect((await fetch(`${base}/mcp-new`, { method: 'POST' })).status).toBe(200);
    const denied = await fetch(`${base}/mcp-existing`, { method: 'POST' });
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as { supported: string[] }).supported).toEqual([
      ...MCP_SUPPORTED_PROTOCOL_VERSIONS,
    ]);
    expect(seen).toEqual(['/mcp-new']);
  });

  it('rejects an ambiguous (repeated) version header', async () => {
    const dispatched: string[] = [];
    const server = createServer((req, res) => {
      if (!checkMcpProtocolVersion(req, res, false)) return;
      dispatched.push(req.url || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest(
        `${base}/mcp`,
        { method: 'POST', headers: { 'mcp-protocol-version': ['2025-11-25', '2025-06-18'] } },
        (incoming) => {
          try {
            expect(incoming.statusCode).toBe(400);
            expect(dispatched).toEqual([]);
            incoming.resume();
            incoming.on('end', () => resolve());
          } catch (error) {
            reject(error);
          }
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  });

  it('requires header/body version agreement', () => {
    const first = resStub();
    expect(
      checkMcpBodyVersionAgreement(first.res, '2025-11-25', { protocolVersion: 'x' } as unknown as string),
    ).toBe(true); // non-string bodies are the transport's problem, not a mismatch
    const mismatch = resStub();
    expect(checkMcpBodyVersionAgreement(mismatch.res, '2025-11-25', '2025-06-18')).toBe(false);
    expect(mismatch.calls[0].status).toBe(400);
    const unsupported = resStub();
    expect(checkMcpBodyVersionAgreement(unsupported.res, '1999-12-31', '1999-12-31')).toBe(false);
    const agreement = resStub();
    expect(checkMcpBodyVersionAgreement(agreement.res, '2025-03-26', '2025-03-26')).toBe(true);
    expect(agreement.calls).toEqual([]);
  });

  it('rejects initialize bodies carrying unsupported or disagreeing versions', () => {
    const bad = resStub();
    expect(checkMcpInitializeBody(bad.res, initialize('1999-12-31'), undefined)).toBe(false);
    expect(bad.calls[0].status).toBe(400);
    expect(JSON.parse(bad.calls[0].body).supported).toEqual([...MCP_SUPPORTED_PROTOCOL_VERSIONS]);

    const disagree = resStub();
    expect(checkMcpInitializeBody(disagree.res, initialize('2025-06-18'), '2025-11-25')).toBe(false);

    const batch = resStub();
    expect(
      checkMcpInitializeBody(
        batch.res,
        [initialize('2025-03-26'), { jsonrpc: '2.0', method: 'notifications/initialized' }],
        '2025-03-26',
      ),
    ).toBe(true);
    const batchBad = resStub();
    expect(
      checkMcpInitializeBody(batchBad.res, [initialize('2025-03-26'), initialize('1999-12-31')], '2025-03-26'),
    ).toBe(false);

    // Non-initialize traffic passes through to transport-level validation.
    const passthrough = resStub();
    expect(
      checkMcpInitializeBody(passthrough.res, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, undefined),
    ).toBe(true);
    expect(passthrough.calls).toEqual([]);
  });
});

describe('shared HTTP auth/session wiring', () => {
  it('enforces standalone config-file key records', () => {
    const config = { apiKeysConfig: [{ key: 'config-only', allowedTools: ['dmrx_status'] }] } as McpConfigFile;
    const policy = buildHttpBearerPolicy(config);
    expect(policy.configured).toBe(true);
    expect(policy.malformed).toBe(false);
    const ok = resStub();
    const accepted = authenticateHttpRequest(reqStub({ authorization: 'Bearer config-only' }), ok.res, config);
    expect(accepted.authorized).toBe(true);
    expect(accepted.principalId).not.toContain('config-only');
    expect(accepted.allowedTools).toEqual(['dmrx_status']);
    const denied = resStub();
    expect(
      authenticateHttpRequest(reqStub({ authorization: 'Bearer wrong' }), denied.res, config).authorized,
    ).toBe(false);
    expect(denied.calls[0].status).toBe(401);
  });

  it('enforces env-only key records and fails closed on malformed env JSON', () => {
    process.env.DMRX_MCP_API_KEYS_CONFIG = JSON.stringify([{ key: 'env-only' }]);
    const policy = buildHttpBearerPolicy(null);
    expect(policy).toMatchObject({ configured: true, malformed: false });
    const ok = resStub();
    expect(authenticateHttpRequest(reqStub({ authorization: 'Bearer env-only' }), ok.res, null).authorized).toBe(
      true,
    );

    process.env.DMRX_MCP_API_KEYS_CONFIG = '{"key": "broken"';
    const bad = resStub();
    const result = authenticateHttpRequest(reqStub({ authorization: 'Bearer anything' }), bad.res, null);
    expect(result.authorized).toBe(false);
    expect(bad.calls[0].status).toBe(500);
  });

  it('derives the A2A owner id from validated identity only', () => {
    const config = { apiKeysConfig: [{ key: 'owner-key' }] } as McpConfigFile;
    const stub = resStub();
    const auth = authenticateHttpRequest(reqStub({ authorization: 'Bearer owner-key' }), stub.res, config);
    expect(ownerIdForA2A(auth)).toBe(auth.principalId);
    expect(ownerIdForA2A(auth)).not.toContain('owner-key');
    expect(ownerIdForA2A({ authorized: false, principalId: 'unauthorized' })).toBe('unauthorized');
  });

  it('rejects ambiguous tenant headers and binds the rest to principal + tenant', () => {
    const bad = resStub();
    expect(sessionBindingForRequest(reqStub({ 'x-dmr-tenant-key': ['a', 'b'] }), 'p', bad.res)).toBeUndefined();
    expect(bad.calls[0].status).toBe(400);
    const ws = resStub();
    expect(sessionBindingForRequest(reqStub({ 'x-dmr-tenant-key': '   ' }), 'p', ws.res)).toEqual({
      principalId: 'p',
    });
    const good = resStub();
    expect(sessionBindingForRequest(reqStub({ 'x-dmr-tenant-key': 't' }), 'p', good.res)).toEqual({
      principalId: 'p',
      tenantKey: 't',
    });
    expect(isSameSessionBinding({ principalId: 'p', tenantKey: 't' }, { principalId: 'p', tenantKey: 't' })).toBe(
      true,
    );
    expect(isSameSessionBinding({ principalId: 'p', tenantKey: 't' }, { principalId: 'p' })).toBe(false);
  });

  it('evicts the oldest HTTP session closing transport and server', async () => {
    const firstTransportClose = vi.fn(async () => undefined);
    const firstServerClose = vi.fn(async () => undefined);
    const sessions = new Map([
      ['first', { transport: { close: firstTransportClose }, server: { close: firstServerClose } }],
    ]);
    const removeSession = vi.fn();
    const unregister = vi.fn();
    // Fill to capacity first so the helper below evicts (capacity enforced by callers).
    sessions.set('second', {
      transport: { close: vi.fn(async () => undefined) },
      server: { close: vi.fn(async () => undefined) },
    });
    const evicted = await evictOldestHttpSession(sessions, removeSession, unregister);
    expect(evicted).toBe('first');
    expect(firstTransportClose).toHaveBeenCalledOnce();
    expect(firstServerClose).toHaveBeenCalledOnce();
    expect(removeSession).toHaveBeenCalledWith('first');
    expect(unregister).toHaveBeenCalledWith('first');
    expect(sessions.has('first')).toBe(false);
  });
});

describe('protocol interop with independent SDK fixtures', () => {
  function fixtureServer() {
    const server = new McpServer({ name: 'dmrx-protocol-fixture', version: '1.0.0' });
    server.registerTool(
      'fixture_echo',
      { description: 'Echo fixture', inputSchema: { text: z.string() } },
      async ({ text }: { text: string }) => ({ content: [{ type: 'text' as const, text }] }),
    );
    return server;
  }

  async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  /** POST a raw JSON-RPC message to a streamable endpoint; parse SSE or JSON. */
  async function postMcp(
    base: string,
    body: unknown,
    headers: Record<string, string> = {},
    path = '/mcp',
  ): Promise<{ status: number; headers: Headers; payloads: any[] }> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payloads: any[];
    try {
      payloads = [JSON.parse(text)];
    } catch {
      payloads = text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)));
    }
    return { status: response.status, headers: response.headers, payloads };
  }

  it('keeps legacy initialize/list/call working on an old supported version', async () => {
    const server = fixtureServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    const base = await listen((req, res) => void transport.handleRequest(req, res));

    const init = await postMcp(base, initialize('2025-03-26'));
    expect(init.status).toBe(200);
    expect(init.payloads[0].result.protocolVersion).toBe('2025-03-26');
    const sessionId = init.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    // Initialized notification (accepted, no response payload expected).
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
        'mcp-protocol-version': '2025-03-26',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    const list = await postMcp(
      base,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-03-26' },
    );
    expect(list.status).toBe(200);
    expect(list.payloads[0].result.tools.map((t: { name: string }) => t.name)).toContain('fixture_echo');

    const call = await postMcp(
      base,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture_echo', arguments: { text: 'hi' } } },
      { 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-03-26' },
    );
    expect(call.status).toBe(200);
    expect(call.payloads[0].result.content[0].text).toBe('hi');
    await transport.close();
    await server.close();
  });

  it('runs the current-version stateful flow through the SDK Client', async () => {
    const server = fixtureServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    const base = await listen((req, res) => void transport.handleRequest(req, res));

    const client = new Client({ name: 'dmrx-fixture-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('fixture_echo');
    const result = await client.callTool({ name: 'fixture_echo', arguments: { text: 'current' } });
    expect(JSON.stringify(result)).toContain('current');
    await client.close();
    await transport.close();
    await server.close();
  });

  it('runs stateless requests without advertising or requiring a session', async () => {
    const server = fixtureServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const base = await listen((req, res) => void transport.handleRequest(req, res));

    const init = await postMcp(base, initialize(MCP_LATEST_PROTOCOL_VERSION));
    expect(init.status).toBe(200);
    // Stateless mode issues no session id and fakes no initialized state.
    expect(init.headers.get('mcp-session-id')).toBeNull();

    await clientStatelessRoundTrip(base);
    await transport.close();
    await server.close();
  });

  async function clientStatelessRoundTrip(base: string) {
    const client = new Client({ name: 'dmrx-fixture-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('fixture_echo');
    await client.close();
  }

  it('keeps legacy SSE initialize/list/call working', async () => {
    const server = fixtureServer();
    let transport: SSEServerTransport | undefined;
    const base = await listen((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/sse' && req.method === 'GET') {
        transport = new SSEServerTransport('/messages', res);
        void server.connect(transport);
        return;
      }
      if (url.pathname === '/messages' && req.method === 'POST') {
        void transport?.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404).end();
    });

    const client = new Client({ name: 'dmrx-fixture-client', version: '1.0.0' });
    await client.connect(new SSEClientTransport(new URL(`${base}/sse`)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('fixture_echo');
    const result = await client.callTool({ name: 'fixture_echo', arguments: { text: 'sse' } });
    expect(JSON.stringify(result)).toContain('sse');
    await client.close();
    await server.close();
  });

  it('documents raw-SDK leniency: unknown versions negotiate latest (why the gate exists)', async () => {
    const server = fixtureServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    const base = await listen((req, res) => void transport.handleRequest(req, res));

    // Evidence, not endorsement: the bare SDK upgrades '1999-12-31' to latest
    // and mints a session. Production listeners must NOT expose this — see
    // the production-order test below.
    const init = await postMcp(base, initialize('1999-12-31'));
    expect(init.status).toBe(200);
    expect(init.payloads[0].result.protocolVersion).toBe(MCP_LATEST_PROTOCOL_VERSION);
    expect(init.headers.get('mcp-session-id')).toBeTruthy();
    await transport.close();
    await server.close();
  });

  it('production order (header gate, then body gate, then transport) fails unsupported versions clearly', async () => {
    const server = fixtureServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    // Same order as the production /mcp listener: no auth on fixtures, but
    // the version gates run before the transport sees the request.
    const base = await listen((req, res) => {
      if (!checkMcpProtocolVersion(req, res, false)) return;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        void (async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
          }
          const header = req.headers['mcp-protocol-version'];
          if (!checkMcpInitializeBody(res, parsed, Array.isArray(header) ? undefined : header)) return;
          await transport.handleRequest(req, res, parsed);
        })();
      });
    });

    const rejected = await postMcp(base, initialize('1999-12-31'));
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get('mcp-session-id')).toBeNull();
    expect(JSON.stringify(rejected.payloads[0])).toMatch(/support/i);

    const agreed = await postMcp(base, initialize('2025-06-18'), { 'mcp-protocol-version': '2025-06-18' });
    expect(agreed.status).toBe(200);
    expect(agreed.payloads[0].result.protocolVersion).toBe('2025-06-18');
    expect(agreed.headers.get('mcp-session-id')).toBeTruthy();

    const disagreed = await postMcp(base, initialize('2025-06-18'), { 'mcp-protocol-version': '2025-11-25' });
    expect(disagreed.status).toBe(400);
    await transport.close();
    await server.close();
  });
});
