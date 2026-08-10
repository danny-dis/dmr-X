import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the v2 MCP client SDK so the registry's 'http' transport branch can be
// exercised without a live network call. The mock records every constructed
// transport/client so tests can assert on the exact constructor arguments.
//
// NOTE: the mock must be keyed on the *resolved* module path, not the bare
// `@modelcontextprotocol/client` specifier. The v2 package is installed only
// under services/mcp-client/node_modules (not hoisted to the root), so a test
// living in tests/unit resolving the bare specifier would point at a different
// module than the one registry.ts imports — and vi.mock would silently miss.
// Keying on the resolved dist/index.mjs path makes both importers share one
// module ID. (No live network call is made: every class is replaced by a stub.)
const mocks = vi.hoisted(() => {
  const httpTransports: any[] = [];
  const sseTransports: any[] = [];
  const clients: any[] = [];
  // connect() runs synchronously up to its first `await client.connect(...)`,
  // so a spy can't be primed after the call starts. Instead, behaviors are
  // queued here BEFORE connect() is invoked and drained when the call runs.
  const connectQueue: Array<{ reject?: unknown }> = [];

  class MockSdkHttpError extends Error {
    status: number;
    statusText?: string;
    constructor(_code: string, message: string, data: { status: number; statusText?: string }) {
      super(message);
      this.name = 'SdkHttpError';
      this.status = data.status;
      this.statusText = data.statusText;
    }
  }

  class MockStreamableHTTPClientTransport {
    constructor(public url: URL, public opts?: any) {
      httpTransports.push(this);
    }
    start = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    setProtocolVersion = vi.fn();
  }

  class MockSSEClientTransport {
    constructor(public url: URL, public opts?: any) {
      sseTransports.push(this);
    }
    start = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    setProtocolVersion = vi.fn();
  }

  class MockClient {
    constructor(public clientInfo: any, public options?: any) {
      clients.push(this);
    }
    connect = vi.fn(async () => {
      const next = connectQueue.shift();
      if (next && 'reject' in next) {
        throw next.reject;
      }
    });
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    httpTransports,
    sseTransports,
    clients,
    connectQueue,
    MockSdkHttpError,
    MockStreamableHTTPClientTransport,
    MockSSEClientTransport,
    MockClient,
  };
});

vi.mock(
  '../../services/mcp-client/node_modules/@modelcontextprotocol/client/dist/index.mjs',
  () => ({
    Client: mocks.MockClient,
    SdkHttpError: mocks.MockSdkHttpError,
    SSEClientTransport: mocks.MockSSEClientTransport,
    StreamableHTTPClientTransport: mocks.MockStreamableHTTPClientTransport,
  })
);

vi.mock(
  '../../services/mcp-client/node_modules/@modelcontextprotocol/client/dist/stdio.mjs',
  () => ({
    StdioClientTransport: class MockStdioClientTransport {
      start = vi.fn();
      close = vi.fn().mockResolvedValue(undefined);
      setProtocolVersion = vi.fn();
    },
  })
);

import { MCPServerRegistry } from '../../services/mcp-client/src/registry.js';

describe('MCPServerRegistry http transport branch', () => {
  beforeEach(() => {
    mocks.httpTransports.length = 0;
    mocks.sseTransports.length = 0;
    mocks.clients.length = 0;
    mocks.connectQueue.length = 0;
  });

  it('builds a StreamableHTTPClientTransport with Accept and Bearer headers', async () => {
    const registry = new MCPServerRegistry();

    await registry.connect({
      id: 'http-srv',
      name: 'HTTP Server',
      transport: 'http',
      url: 'https://example.com/mcp',
      apiKey: 'sk-test',
    });

    expect(mocks.httpTransports).toHaveLength(1);
    const transport = mocks.httpTransports[0];
    expect(transport).toBeInstanceOf(mocks.MockStreamableHTTPClientTransport);
    expect(transport.url.href).toBe('https://example.com/mcp');
    expect(transport.opts.requestInit.headers).toEqual({
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer sk-test',
    });

    expect(mocks.sseTransports).toHaveLength(0);
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0].connect).toHaveBeenCalledTimes(1);
    expect(registry.has('http-srv')).toBe(true);
  });

  it('omits the Authorization header when no apiKey is set', async () => {
    const registry = new MCPServerRegistry();

    await registry.connect({
      id: 'http-anon',
      name: 'Anonymous',
      transport: 'http',
      url: 'https://example.com/mcp',
    });

    expect(mocks.httpTransports).toHaveLength(1);
    expect(mocks.httpTransports[0].opts.requestInit.headers).toEqual({
      Accept: 'application/json, text/event-stream',
    });
  });

  it('falls back to the legacy SSE transport when the server responds 405', async () => {
    const registry = new MCPServerRegistry();
    mocks.connectQueue.push({
      reject: new mocks.MockSdkHttpError('method-not-allowed', 'HTTP 405', { status: 405 }),
    });

    await registry.connect({
      id: 'legacy-http',
      name: 'Legacy over HTTP',
      transport: 'http',
      url: 'https://example.com/mcp',
      apiKey: 'sk-fallback',
    });

    expect(mocks.sseTransports).toHaveLength(1);
    const sse = mocks.sseTransports[0];
    expect(sse.url.href).toBe('https://example.com/mcp');
    expect(sse.opts.requestInit.headers).toEqual({ Authorization: 'Bearer sk-fallback' });

    const client = mocks.clients[0];
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalled();
    expect(registry.has('legacy-http')).toBe(true);
  });

  it('does not fall back for non-4xx rejections and surfaces the error', async () => {
    const registry = new MCPServerRegistry();
    mocks.connectQueue.push({ reject: new Error('network down') });

    await expect(
      registry.connect({
        id: 'http-fail',
        name: 'Fail',
        transport: 'http',
        url: 'https://example.com/mcp',
      })
    ).rejects.toThrow('network down');

    expect(mocks.sseTransports).toHaveLength(0);
    expect(registry.has('http-fail')).toBe(false);
  });
});
