/**
 * A2A push-notification egress security tests.
 *
 * `pushNotificationConfig.url` is attacker-controlled and fetched by the
 * server, so it is a direct SSRF primitive into whatever network the MCP server
 * can reach. These tests pin the policy: what is refused, that validation runs
 * at BOTH registration and delivery, and that a validated destination is dialed
 * by its pinned IP rather than by re-resolving the name.
 *
 * Nothing here contacts an arbitrary network address. Loopback fixtures are used
 * only after being explicitly authorized through the documented operator
 * allowlist, so the tests exercise the real transport without weakening policy.
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertWebhookUrlAllowed,
  deliverWebhook,
  isPublicAddress,
  isWebhookUrlAllowed,
  WebhookPolicyError,
} from '../../services/mcp-server/src/a2a/egress.js';

const originalAllowlist = process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
  else process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = originalAllowlist;
});

/** Assert a URL is refused, and report the policy message for the failure text. */
async function expectRefused(url: string, because: string): Promise<void> {
  await expect(assertWebhookUrlAllowed(url), `${url} must be refused (${because})`).rejects.toBeInstanceOf(
    WebhookPolicyError,
  );
}

describe('A2A webhook scheme and URL shape policy', () => {
  it.each([
    ['file:///etc/passwd', 'local file read'],
    ['gopher://127.0.0.1:6379/_SET', 'protocol smuggling'],
    ['data:text/plain,hi', 'inline payload'],
    ['ftp://example.com/x', 'unsupported scheme'],
    ['ws://example.com/x', 'websocket is not a webhook transport'],
  ])('refuses %s (%s)', async (url) => {
    await expectRefused(url, 'scheme not allowed');
  });

  it('refuses credentials embedded in the URL', async () => {
    await expectRefused('https://user:pass@example.com/hook', 'credentials leak into logs');
  });

  it('refuses a fragment', async () => {
    await expectRefused('https://example.com/hook#x', 'fragment is never sent');
  });

  it('refuses a malformed URL outright', async () => {
    await expectRefused('not a url', 'unparseable');
  });

  it('refuses an out-of-range port', async () => {
    await expectRefused('https://example.com:99999/hook', 'invalid port');
  });
});

describe('A2A webhook address policy blocks internal targets', () => {
  // Every one of these is refused on the address itself — no DNS is consulted,
  // so the test needs no network.
  it.each([
    ['http://127.0.0.1/hook', 'loopback'],
    ['http://127.0.0.1:8080/hook', 'loopback with port'],
    ['http://localhost/hook', 'loopback by name'],
    ['http://10.0.0.5/hook', 'RFC1918 10/8'],
    ['http://172.16.4.4/hook', 'RFC1918 172.16/12'],
    ['http://172.31.255.1/hook', 'RFC1918 172.16/12 upper edge'],
    ['http://192.168.1.1/hook', 'RFC1918 192.168/16'],
    ['http://0.0.0.0/hook', 'this network'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://169.254.1.1/hook', 'link-local'],
    ['http://100.64.0.1/hook', 'CGNAT'],
    ['http://198.18.0.1/hook', 'benchmarking'],
    ['http://203.0.113.9/hook', 'TEST-NET-3'],
    ['http://[::1]/hook', 'IPv6 loopback'],
    ['http://[::]/hook', 'IPv6 unspecified'],
    ['http://[fe80::1]/hook', 'IPv6 link-local'],
    ['http://[fc00::1]/hook', 'IPv6 unique-local'],
    ['http://[ff02::1]/hook', 'IPv6 multicast'],
    ['http://[::ffff:127.0.0.1]/hook', 'IPv4-mapped loopback'],
    ['http://[::ffff:169.254.169.254]/hook', 'IPv4-mapped metadata address'],
    ['http://224.0.0.1/hook', 'multicast'],
  ])('refuses %s (%s)', async (url) => {
    await expectRefused(url, 'non-public address');
  });

  it.each([
    ['http://2130706433/hook', 'decimal IPv4'],
    ['http://0x7f000001/hook', 'hex IPv4'],
    ['http://017700000001/hook', 'octal IPv4'],
    ['http://127.1/hook', 'short-dotted IPv4'],
    ['http://127.0.0.1.nip.io/hook', 'rebinding name resolving to loopback'],
  ])('refuses the non-canonical encoding %s (%s)', async (url) => {
    await expectRefused(url, 'ambiguous IP encoding');
  });

  it('refuses internal-only names without resolving them', async () => {
    await expectRefused('http://metadata.google.internal/hook', 'cloud metadata name');
    await expectRefused('http://db.internal/hook', 'internal TLD');
    await expectRefused('http://printer.local/hook', 'mDNS TLD');
    await expectRefused('http://singlelabel/hook', 'not fully qualified');
  });

  it('classifies public addresses correctly', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });
});

describe('A2A webhook operator allowlist is explicit and narrow', () => {
  it('does not allow loopback by default', async () => {
    delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
    expect(await isWebhookUrlAllowed('http://127.0.0.1:9/hook')).toBe(false);
  });

  it('allows ONLY the listed address, not the whole range', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    expect(await isWebhookUrlAllowed('http://127.0.0.1:9/hook')).toBe(true);
    // A neighbouring loopback address is still refused.
    expect(await isWebhookUrlAllowed('http://127.0.0.2:9/hook')).toBe(false);
    // And private space is still refused.
    expect(await isWebhookUrlAllowed('http://10.0.0.1/hook')).toBe(false);
  });

  it('ignores allowlist entries that are not literal IPs', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = 'localhost,10.0.0.0/8,,not-an-ip';
    expect(await isWebhookUrlAllowed('http://localhost/hook')).toBe(false);
    expect(await isWebhookUrlAllowed('http://10.0.0.1/hook')).toBe(false);
  });
});

describe('A2A webhook delivery is pinned, bounded and refuses redirects', () => {
  async function fixture(handler: Parameters<typeof createServer>[0]): Promise<{ url: string; server: Server }> {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/hook`, server };
  }

  const teardown = async (server: Server) => {
    server.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  };

  it('delivers to an allowlisted fixture and preserves the Host header', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    let seenHost = '';
    let seenBody = '';
    const { url, server } = await fixture((req, res) => {
      seenHost = req.headers.host ?? '';
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seenBody = Buffer.concat(chunks).toString();
        res.writeHead(200).end('ok');
      });
    });
    try {
      const result = await deliverWebhook(url, '{"hello":"world"}', { 'content-type': 'application/json' });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(seenBody).toBe('{"hello":"world"}');
      // The Host header carries the requested host:port, not the pinned IP, so
      // virtual hosting and any server-side host allowlist still work.
      expect(seenHost).toBe(new URL(url).host);
    } finally {
      await teardown(server);
    }
  });

  it('never dials a destination the policy refused', async () => {
    delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
    // The DELIVERY gate re-checks, so even a config stored by an older build (or
    // one that has since been re-pointed at an internal address) cannot be used.
    const result = await deliverWebhook('http://169.254.169.254/latest/meta-data/', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-public/i);
  });

  it('does not follow a redirect to an internal endpoint', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    let hits = 0;
    const { url, server } = await fixture((req, res) => {
      hits++;
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    try {
      const result = await deliverWebhook(url, '{}');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(302);
      expect(result.error).toMatch(/redirect/i);
      // Exactly one request: the redirect target is never contacted.
      expect(hits).toBe(1);
    } finally {
      await teardown(server);
    }
  });

  it('treats a non-2xx response as a delivery failure without throwing', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    const { url, server } = await fixture((_req, res) => {
      res.writeHead(500).end('boom');
    });
    try {
      const result = await deliverWebhook(url, '{}');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    } finally {
      await teardown(server);
    }
  });

  it('bounds an oversized response body instead of draining it', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    const { url, server } = await fixture((_req, res) => {
      // One synchronous 256KB write: backpressure-throttled streaming can end
      // at an awkward total and make this assertion racy.
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(256 * 1024, 0x61));
    });
    try {
      const result = await deliverWebhook(url, '{}');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/exceeded cap/i);
    } finally {
      await teardown(server);
    }
  });

  it('times out a fixture that never answers', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    const previousTimeout = process.env.DMRX_A2A_WEBHOOK_TIMEOUT_MS;
    process.env.DMRX_A2A_WEBHOOK_TIMEOUT_MS = '300';
    const { url, server } = await fixture((_req, res) => {
      void res; // accept and never respond
    });
    try {
      const result = await deliverWebhook(url, '{}');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out/i);
    } finally {
      if (previousTimeout === undefined) delete process.env.DMRX_A2A_WEBHOOK_TIMEOUT_MS;
      else process.env.DMRX_A2A_WEBHOOK_TIMEOUT_MS = previousTimeout;
      await teardown(server);
    }
  });

  it('aborts an in-flight delivery when given a signal', async () => {
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    const controller = new AbortController();
    const { url, server } = await fixture((_req, res) => {
      void res; // accept and never respond
    });
    try {
      const pending = deliverWebhook(url, '{}', {}, controller.signal);
      controller.abort();
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toBe('aborted');
    } finally {
      await teardown(server);
    }
  });
});
