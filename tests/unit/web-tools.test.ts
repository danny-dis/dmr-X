import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * web_fetch / web_search — the two LLM-driven web tools added to the coding
 * tool registry (registerCodingToolHandlers in tools.routes.ts).
 *
 * Security posture these tests pin:
 *   - EVERY outbound fetch is validated through validateBaseUrlForSSRF() and
 *     the returned pinned lookup is wired into the undici Agent dispatcher, so
 *     the connection can only reach the IP that was validated (DNS-rebinding
 *     proof). Private / loopback / link-local hosts are refused up front.
 *   - Redirects are followed manually (`redirect: 'manual'`) and EACH hop is
 *     re-validated (max 3). A redirect to a private IP is refused.
 *   - Bodies are streamed with a 2MB cap and aborted past it — truncated, not
 *     buffered whole — and HTML is stripped to plain text capped at ~20k chars.
 *   - web_search degrades honestly: no key => explicit error, no fabrication,
 *     no scraping an HTML search-engine page.
 *   - Failures return { error } objects, never throw.
 */

// The admin-ssrf module is mocked so handler tests need no DNS/network. The
// REAL implementation is re-exposed through the mock as
// `__realValidateBaseUrlForSSRF` (importOriginal inside the factory), used for
// direct SSRF-rejection assertions — IP literals and non-http schemes need no
// DNS. NOTE: object-property writes made inside a vi.mock factory do NOT
// persist to the test body in vitest 3.2.6, hence the dynamic-import accessor
// instead of a stashed reference.
const mockState = vi.hoisted(() => ({ validate: vi.fn() }));

vi.mock('../../apps/gateway/src/routes/admin-ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/gateway/src/routes/admin-ssrf.js')>();
  return {
    ...actual,
    __realValidateBaseUrlForSSRF: actual.validateBaseUrlForSSRF,
    validateBaseUrlForSSRF: mockState.validate,
  };
});

import { registerCodingToolHandlers, executeToolCall, htmlToText } from '../../apps/gateway/src/routes/tools.routes.js';
import { normalizeAllowedTools } from '../../packages/core/src/agent-tools.js';

// The mocked admin-ssrf module still carries the real function under a
// non-colliding export name.
const { __realValidateBaseUrlForSSRF: realValidateBaseUrlForSSRF } =
  (await import('../../apps/gateway/src/routes/admin-ssrf.js')) as unknown as {
    __realValidateBaseUrlForSSRF: (url: string) => Promise<unknown>;
  };

function callTool(name: string, args: Record<string, unknown>) {
  return executeToolCall(
    { id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
    { requestId: 'req-web-test' },
  );
}

describe('web_fetch / web_search tool registration', () => {
  beforeAll(() => {
    registerCodingToolHandlers();
  });

  beforeEach(() => {
    process.env.DMRX_SEARCH_API_KEY = 'test-key';
    // Default validator: reject non-http(s) schemes and private IP literals
    // via the REAL blocklist logic; accept public hostnames without DNS.
    mockState.validate.mockImplementation(async (url: string) => {
      const u = new URL(url);
      let host = u.hostname;
      if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
      // Non-http(s) schemes and IP literals go to the REAL implementation
      // (no DNS needed for literals). Only bare public hostnames are faked.
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || /^[\d.]+$/.test(host) || host.includes(':')) {
        return realValidateBaseUrlForSSRF(url);
      }
      const fakeIp = '93.184.216.34'; // public-looking; never actually connected to
      return {
        url,
        hostname: host,
        ip: fakeIp,
        family: 4,
        lookup: (_h: string, _o: unknown, cb: (err: Error | null, addr: string, fam: number) => void) =>
          cb(null, fakeIp, 4),
      };
    });
  });

  afterEach(() => {
    delete process.env.DMRX_SEARCH_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------- SSRF REJECTION

  describe('SSRF rejection (real validateBaseUrlForSSRF)', () => {
    it('rejects http://127.0.0.1 (loopback)', async () => {
      await expect(realValidateBaseUrlForSSRF('http://127.0.0.1/')).rejects.toThrow(/private|internal/i);
    });

    it('rejects http://169.254.169.254 (cloud metadata link-local)', async () => {
      await expect(realValidateBaseUrlForSSRF('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        /private|internal/i,
      );
    });

    it('rejects file:///etc/passwd (non-http scheme)', async () => {
      await expect(realValidateBaseUrlForSSRF('file:///etc/passwd')).rejects.toThrow(/http and https/i);
    });

    it('rejects http://[::1] (IPv6 loopback)', async () => {
      await expect(realValidateBaseUrlForSSRF('http://[::1]/')).rejects.toThrow(/private|internal/i);
    });
  });

  describe('web_fetch handler', () => {
    it('refuses a redirect that targets a private IP, without fetching the target', async () => {
      const fetchMock = vi.fn(
        async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await callTool('web_fetch', { url: 'http://example.com/page' });

      // Only the initial hop was fetched; the redirect target was rejected
      // during re-validation and never hit the wire.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.result).toMatchObject({ error: expect.stringMatching(/private|internal/i) });
      expect(res.error).toBeUndefined();
    });

    it('truncates an oversized body instead of buffering it whole', async () => {
      const chunks = [
        new Uint8Array(1024 * 1024).fill(97), // 'a'
        new Uint8Array(1024 * 1024).fill(98), // 'b'
        new Uint8Array(1024 * 1024).fill(99), // 'c'
      ];
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (chunks.length === 0) {
            controller.close();
            return;
          }
          controller.enqueue(chunks.shift()!);
        },
      });
      const fetchMock = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }));
      vi.stubGlobal('fetch', fetchMock);

      const res = await callTool('web_fetch', { url: 'http://example.com/big' });

      expect(res.result.truncated).toBe(true);
      // Exactly the 2MB cap was retained — the third chunk was discarded, so
      // the body was truncated rather than buffered whole (3MB).
      expect(res.result.bytes).toBe(2 * 1024 * 1024);
      expect(String(res.result.text)).not.toContain('c');
      expect(String(res.result.text).length).toBeLessThanOrEqual(20_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('strips script/style/tags down to plain text', async () => {
      const html =
        '<html><head><script>alert("x");</script><style>body{color:red}</style></head>' +
        '<body><h1>Hello</h1><p>World &amp; more</p></body></html>';

      // Pure function, no network.
      expect(htmlToText(html)).toBe('Hello World & more');

      // And through the handler with a mocked fetch.
      const fetchMock = vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
      vi.stubGlobal('fetch', fetchMock);
      const res = await callTool('web_fetch', { url: 'http://example.com/page' });

      expect(res.result.status).toBe(200);
      expect(res.result.text).toBe('Hello World & more');
      expect(String(res.result.text)).not.toContain('<script');
      expect(String(res.result.text)).not.toContain('<style');
      expect(res.result.truncated).toBe(false);
    });

    it('returns an error object (never throws) for an invalid URL', async () => {
      const res = await callTool('web_fetch', { url: 'not-a-url' });
      // 'not-a-url' fails the scheme check inside validateBaseUrlForSSRF.
      expect(res.result).toMatchObject({ error: expect.any(String) });
    });

    it('returns an error object when url is missing', async () => {
      const res = await callTool('web_fetch', {});
      expect(res.result).toEqual({ error: 'url is required' });
    });
  });

  describe('web_search handler', () => {
    it('returns the explicit error when DMRX_SEARCH_API_KEY is missing', async () => {
      delete process.env.DMRX_SEARCH_API_KEY;
      const res = await callTool('web_search', { query: 'test query' });
      expect(res.result).toEqual({
        error: 'web_search unavailable: DMRX_SEARCH_API_KEY not configured',
      });
    });

    it('queries the search API and maps ranked results', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              web: {
                results: [
                  { title: 'First Result', url: 'https://example.com/1', description: 'First snippet' },
                  { title: 'Second Result', url: 'https://example.com/2', description: 'Second snippet' },
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await callTool('web_search', { query: 'dmr-x gateway' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [fetchedUrl, init] = fetchMock.mock.calls[0];
      expect(String(fetchedUrl)).toContain('api.search.brave.com/res/v1/web/search');
      expect(String(fetchedUrl)).toContain('q=dmr-x+gateway'); // URLSearchParams encodes space as '+'
      expect((init as RequestInit).dispatcher).toBeDefined(); // pinned lookup wired in
      expect(res.result.total).toBe(2);
      expect(res.result.results[0]).toEqual({
        title: 'First Result',
        url: 'https://example.com/1',
        snippet: 'First snippet',
      });
    });

    it('returns an error object when query is missing', async () => {
      process.env.DMRX_SEARCH_API_KEY = 'key';
      const res = await callTool('web_search', {});
      expect(res.result).toEqual({ error: 'query is required' });
    });
  });

  describe('alias resolution for imported agents', () => {
    it("resolves 'WebFetch, WebSearch, Read, Write, Edit' to 5 registered names", () => {
      const out = normalizeAllowedTools('WebFetch, WebSearch, Read, Write, Edit');
      expect(out).toEqual(['web_fetch', 'web_search', 'read_file', 'write_file', 'edit_file']);
      expect(out).toHaveLength(5);
    });

    it('maps lowercase and mixed-case aliases identically', () => {
      expect(normalizeAllowedTools(['webfetch', 'WebSearch'])).toEqual(['web_fetch', 'web_search']);
    });
  });
});