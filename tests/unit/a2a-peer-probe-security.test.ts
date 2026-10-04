import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('../../apps/gateway/src/routes/admin-ssrf.js', () => ({ validateBaseUrlForSSRF: mocks.validate }));
import { a2aProxyRoutes } from '../../apps/gateway/src/routes/a2a-proxy.routes.js';

let app: FastifyInstance;
const servers: Server[] = [];
async function fixture(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://dmrx-fixture.invalid:${(server.address() as { port: number }).port}/card.json`;
  // Only the validator is mocked: a previously validated destination is pinned
  // to a local fixture. Production validation still forbids loopback addresses.
  mocks.validate.mockResolvedValue({ url, hostname: 'dmrx-fixture.invalid', ip: '127.0.0.1', family: 4,
    lookup: (_host: unknown, options: { all?: boolean }, callback: Function) => callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4),
  });
  return url;
}
async function probe(url: string) {
  return app.inject({ method: 'POST', url: '/admin/a2a/peers/probe', payload: { url } });
}

describe('A2A peer probe real transport security', () => {
  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(a2aProxyRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
      server.close(() => resolve()); server.closeAllConnections();
    })));
  });
  it('reaches the pinned IP rather than resolving the supplied hostname again', async () => {
    const url = await fixture((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'Pinned Peer', skills: [] })); });
    const response = await probe(url);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, summary: { name: 'Pinned Peer' } });
  });
  it('does not follow redirects to a private endpoint', async () => {
    let hits = 0;
    const url = await fixture((req, res) => {
      hits++;
      res.writeHead(302, { location: `http://${req.headers.host}/internal` }); res.end();
    });
    expect((await probe(url)).statusCode).toBe(502);
    expect(hits).toBe(1);
  });
  it('rejects oversized declared responses without waiting for the body', async () => {
    const url = await fixture((_req, res) => { res.writeHead(200, { 'content-length': '2000000' }); res.flushHeaders(); });
    expect((await probe(url)).statusCode).toBe(502);
  });
  it('rejects oversized chunked responses', async () => {
    const url = await fixture((_req, res) => { res.writeHead(200); res.end('x'.repeat(1048577)); });
    expect((await probe(url)).statusCode).toBe(502);
  });
});
