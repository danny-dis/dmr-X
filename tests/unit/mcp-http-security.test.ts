import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardHttpRequest } from '../../services/mcp-server/src/http-security.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function fixture(allowedTools?: string[], configuredOrigins = 'https://company.example') {
  const dispatch = vi.fn();
  const authenticate = vi.fn((req: { headers: Record<string, unknown> }, res: any) => {
    if (req.headers.authorization === 'Bearer fixture-key') return { authorized: true, allowedTools };
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return { authorized: false };
  });
  const server = createServer((req, res) => {
    if (!guardHttpRequest(req, res, configuredOrigins, authenticate)) return;
    dispatch(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, dispatch, authenticate };
}

describe('MCP/A2A HTTP security boundary', () => {
  it('fails closed for empty or wildcard browser allowlists but permits native clients', async () => {
    for (const origins of ['', '*']) {
      const f = await fixture(undefined, origins);
      expect((await fetch(`${f.base}/health`, { headers: { origin: 'https://company.example' } })).status).toBe(403);
      expect((await fetch(`${f.base}/health`)).status).toBe(200);
    }
  });
  it('rejects an invalid Origin before protocol dispatch, even with a valid bearer', async () => {
    const f = await fixture();
    const response = await fetch(`${f.base}/mcp`, { method: 'POST', headers: { origin: 'https://evil.invalid', authorization: 'Bearer fixture-key' } });
    expect(response.status).toBe(403);
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.authenticate).not.toHaveBeenCalled();
  });

  it('accepts exact allowed Origins and permits non-browser clients without Origin', async () => {
    const f = await fixture();
    const browser = await fetch(`${f.base}/mcp`, { method: 'POST', headers: { origin: 'https://company.example' } });
    expect(browser.status).toBe(200);
    expect(browser.headers.get('access-control-allow-origin')).toBe('https://company.example');
    const native = await fetch(`${f.base}/health`);
    expect(native.status).toBe(200);
  });

  it('rejects unauthenticated RPC and legacy A2A access before dispatch', async () => {
    const f = await fixture();
    for (const path of ['/a2a', '/a2a/tasks', '/a2a/tasks/id', '/a2a/tasks/cancel']) {
      const response = await fetch(`${f.base}${path}`, { method: path.endsWith('cancel') || path === '/a2a' ? 'POST' : 'GET' });
      expect(response.status).toBe(401);
    }
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('keeps public discovery public but requires bearer auth for task access', async () => {
    const f = await fixture();
    expect((await fetch(`${f.base}/.well-known/agent-card.json`)).status).toBe(200);
    expect(f.authenticate).not.toHaveBeenCalled();
    expect((await fetch(`${f.base}/a2a`, { method: 'POST', headers: { authorization: 'Bearer fixture-key' } })).status).toBe(200);
    expect(f.authenticate).toHaveBeenCalledTimes(1);
  });

  it('does not let a tool-restricted MCP key bypass its policy through A2A', async () => {
    const f = await fixture(['dmrx_status']);
    const response = await fetch(`${f.base}/a2a`, { method: 'POST', headers: { authorization: 'Bearer fixture-key' } });
    expect(response.status).toBe(403);
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('validates Origin on preflight and advertises required protocol headers', async () => {
    const f = await fixture();
    expect((await fetch(`${f.base}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.invalid' } })).status).toBe(403);
    const response = await fetch(`${f.base}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://company.example' } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('MCP-Protocol-Version');
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});
