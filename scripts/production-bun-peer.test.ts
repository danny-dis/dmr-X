// Run separately: bun test scripts/production-bun-peer.test.ts
// Real Bun networking; only DNS validation is replaced by a loopback fixture.
import { test, expect, mock } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const Fastify = createRequire(new URL('../apps/gateway/package.json', import.meta.url))('fastify');

let fixtureUrl = '';
mock.module('../apps/gateway/src/routes/admin-ssrf.js', () => ({
  validateBaseUrlForSSRF: async () => ({ url: fixtureUrl, hostname: 'dmrx-fixture.invalid', ip: '127.0.0.1', family: 4 }),
}));
const { a2aProxyRoutes } = await import('../apps/gateway/src/routes/a2a-proxy.routes.js');

test('Bun peer probe pins DNS, refuses redirects, and bounds response size', async () => {
  let mode = 'ok';
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    if (mode === 'redirect') { res.writeHead(302, { location: '/internal' }); res.end(); }
    else if (mode === 'oversize') { res.writeHead(200, { 'content-length': '2000000' }); res.flushHeaders(); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'Bun fixture', skills: [] })); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  fixtureUrl = `http://dmrx-fixture.invalid:${(server.address() as { port: number }).port}/card.json`;
  const app = Fastify({ logger: false });
  await app.register(a2aProxyRoutes);
  try {
    const probe = () => app.inject({ method: 'POST', url: '/admin/a2a/peers/probe', payload: { url: fixtureUrl } });
    const ok = await probe();
    expect(ok.statusCode).toBe(200);
    expect(ok.json().summary.name).toBe('Bun fixture');
    mode = 'redirect'; hits = 0;
    expect((await probe()).statusCode).toBe(502);
    expect(hits).toBe(1);
    mode = 'oversize';
    expect((await probe()).statusCode).toBe(502);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
