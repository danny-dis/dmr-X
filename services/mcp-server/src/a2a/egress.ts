/**
 * A2A push-notification egress guard.
 *
 * `pushNotificationConfig.url` is attacker-supplied and is fetched by the server
 * (classic SSRF). Two independent gates use the same policy:
 *
 *   1. REGISTRATION — `assertWebhookUrlAllowed()` runs in
 *      `tasks/pushNotificationConfig/set` and for the inline config on
 *      message/send|stream, so an obviously hostile URL is never stored at all.
 *   2. DELIVERY — `deliverWebhook()` re-resolves and re-validates immediately
 *      before the socket is opened. A URL that passed at registration time can
 *      still have been re-pointed at an internal address since (DNS rebinding),
 *      so the delivery-time check is not redundant.
 *
 * Policy enforced by both gates:
 *   - `http:` and `https:` only — no file:, gopher:, data:, ftp:, unix: sockets.
 *   - No embedded credentials (`https://user:pass@host`) — they leak into logs
 *     and are a classic parser-confusion vector.
 *   - No fragments; a fragment is never sent and silently changes the request.
 *   - Host must be a public address. Loopback, private, link-local (incl. the
 *     169.254.169.254 cloud-metadata address), CGNAT, multicast, reserved and
 *     unspecified ranges are refused. IPv4 and IPv6 alike, including
 *     IPv4-mapped IPv6 forms.
 *   - Obscure IP encodings are refused rather than normalised: decimal, octal,
 *     hexadecimal and short-dotted IPv4 literals (`http://2130706433/`,
 *     `http://0x7f.0.0.1/`, `http://127.1/`) are all rejected outright, because
 *     each is parsed differently by different URL/IP parsers.
 *   - DNS results are ALL validated, and the address actually dialled is pinned
 *     to the validated IP. The name is never resolved a second time, so a
 *     rebinding answer cannot slip between validation and connect.
 *   - Redirects are not followed: a 3xx is reported as a delivery failure.
 *   - TLS hostname is preserved — SNI and certificate verification still use the
 *     original hostname even though the socket targets the pinned IP.
 *
 * Delivery is bounded on every axis that a hostile peer controls: connect +
 * response timeout, and a hard cap on the response body that is drained.
 *
 * Operators that genuinely need an internal webhook (a cluster-internal
 * collector, say) can allowlist exact IPs via `DMRX_A2A_WEBHOOK_ALLOWED_IPS`
 * (comma-separated). That is an explicit, documented opt-in which is logged at
 * registration time — it is never enabled implicitly by a test or a request.
 */

import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** A validated, dial-ready webhook destination with its resolved IP pinned. */
export interface ResolvedWebhookTarget {
  url: string;
  protocol: 'http:' | 'https:';
  /** Original hostname — used for the Host header, SNI and cert verification. */
  hostname: string;
  port: number;
  /** The single validated IP to dial. Never re-resolved. */
  ip: string;
  family: 4 | 6;
}

/** Why a webhook URL was refused. */
export class WebhookPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookPolicyError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Hostnames that must never resolve, regardless of what DNS answers. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
]);

/**
 * IPv4 literals that dodge dotted-quad parsing. Any hostname that is *entirely*
 * numeric/octal/hex is refused, because the intended address is ambiguous.
 */
const OBFUSCATED_IPV4 = /^[0-9a-fx.]+$/i;

/** Extract the port, applying the scheme default, and reject odd ports. */
function readPort(url: URL): number {
  if (!url.port) return url.protocol === 'https:' ? 443 : 80;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WebhookPolicyError(`Invalid port: ${url.port}`);
  }
  return port;
}

/** Operator allowlist of exact IPs (never hostnames, never ranges). */
function allowedIps(): Set<string> {
  const raw = process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS ?? '';
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const ip = part.trim();
    if (ip && isIP(ip)) out.add(ip);
  }
  return out;
}

/**
 * True when an address is routable on the public internet.
 *
 * `allowPrivate` is only ever true for an operator-allowlisted IP, which keeps
 * the exception explicit and auditable instead of a silent hole in the policy.
 */
export function isPublicAddress(ip: string, allowPrivate = false): boolean {
  if (allowPrivate) return true;
  if (isIP(ip) === 4) return isPublicIpv4(ip);
  if (isIP(ip) === 6) return isPublicIpv6(ip);
  return false;
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 88) return false; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false; // TEST-NET-2
  if (a === 203 && b === 0) return false; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // drop zone id

  // IPv4-embedded forms tunnel a v4 target, so the embedded address decides
  // reachability. `URL` normalizes these to HEX (::ffff:127.0.0.1 becomes
  // ::ffff:7f00:1), so both the dotted and the hex spellings must be handled —
  // matching only the dotted form let ::ffff:a9fe:a9fe (169.254.169.254, the
  // cloud metadata address) through as "public IPv6".
  const embedded = extractEmbeddedIpv4(addr);
  if (embedded !== null) return isPublicIpv4(embedded);

  if (addr === '::' || addr === '::1') return false; // unspecified, loopback
  if (addr.startsWith('fe80')) return false; // link-local
  if (/^f[cd]/.test(addr)) return false; // unique-local fc00::/7
  if (addr.startsWith('ff')) return false; // multicast
  if (addr.startsWith('2002:')) {
    // 6to4: 2002:<v4-hex>::/48
    const relay = extractEmbeddedIpv4(addr.replace(/^2002:/, '').padEnd(8, '0'));
    return relay !== null && isPublicIpv4(relay);
  }
  return true;
}

/**
 * Extract the IPv4 address embedded in an IPv6 form, in either the dotted
 * (`::ffff:169.254.169.254`) or hex (`::ffff:a9fe:a9fe`) spelling.
 * Returns null when the address is not IPv4-embedded.
 */
function extractEmbeddedIpv4(addr: string): string | null {
  const dotted = addr.match(/^(?:::ffff:|:)(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  // Hex form: the final two 16-bit groups are the embedded v4 address.
  const hex = addr.match(/^(?:::ffff:|:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

/**
 * Resolve + validate a webhook URL, returning a target with a PINNED ip.
 * Throws `WebhookPolicyError` when any part of the destination is unacceptable.
 */
export async function assertWebhookUrlAllowed(url: string): Promise<ResolvedWebhookTarget> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookPolicyError('Malformed webhook URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookPolicyError(`Unsupported scheme: ${parsed.protocol.replace(':', '')}`);
  }
  if (parsed.username || parsed.password) {
    throw new WebhookPolicyError('Credentials must not be embedded in the webhook URL');
  }
  if (parsed.hash) {
    throw new WebhookPolicyError('Webhook URL must not contain a fragment');
  }

  // `URL.hostname` keeps IPv6 literals bracketed; strip for isIP/lookup.
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = readPort(parsed);
  const allowlist = allowedIps();
  const allowPrivate = allowlist.has(rawHost);

  if (allowPrivate) {
    loggerWarn(`[a2a] webhook ${rawHost} is operator-allowlisted via DMRX_A2A_WEBHOOK_ALLOWED_IPS`);
  }

  // An IP literal needs no DNS — validate it directly.
  const literalFamily = isIP(rawHost);
  if (literalFamily !== 0) {
    if (!isPublicAddress(rawHost, allowPrivate)) {
      throw new WebhookPolicyError(`Webhook host resolves to a non-public address: ${rawHost}`);
    }
    return {
      url: parsed.toString(),
      protocol: parsed.protocol as 'http:' | 'https:',
      hostname: rawHost,
      port,
      ip: rawHost,
      family: literalFamily as 4 | 6,
    };
  }

  const host = rawHost.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new WebhookPolicyError(`Webhook host is not allowed: ${host}`);
  }
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new WebhookPolicyError(`Webhook host is not a public name: ${host}`);
  }
  // Refuse numeric-looking hostnames outright (decimal/octal/hex/short-dotted
  // IPv4). Normalising them would mean picking one of several plausible parses.
  if (OBFUSCATED_IPV4.test(host)) {
    throw new WebhookPolicyError(`Webhook host uses a non-canonical IP encoding: ${host}`);
  }
  // A bare label with no dot cannot be a public FQDN.
  if (!host.includes('.')) {
    throw new WebhookPolicyError(`Webhook host must be a fully-qualified public name: ${host}`);
  }

  const addresses = await resolveAll(rawHost);
  if (addresses.length === 0) {
    throw new WebhookPolicyError(`Webhook host did not resolve: ${host}`);
  }
  // Validate EVERY answer, not just the one we plan to use: a host with one
  // public and one private A record must be refused outright.
  for (const addr of addresses) {
    if (!isPublicAddress(addr.address, allowlist.has(addr.address))) {
      throw new WebhookPolicyError(
        `Webhook host resolves to a non-public address (${addr.family}): ${host}`,
      );
    }
  }
  const chosen = addresses[0];

  return {
    url: parsed.toString(),
    protocol: parsed.protocol as 'http:' | 'https:',
    hostname: host,
    port,
    ip: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

/** Resolve every A/AAAA record, IPv4 first for fixture determinism. */
async function resolveAll(host: string): Promise<LookupAddress[]> {
  const rows = await dnsLookup(host, { all: true, family: 0, verbatim: false });
  return [...rows].sort((a, b) => (a.family === b.family ? 0 : a.family === 4 ? -1 : 1));
}

function timeoutMs(): number {
  const raw = Number(process.env.DMRX_A2A_WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function loggerWarn(message: string): void {
  console.warn(message);
}

export interface WebhookDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Deliver a webhook body to a URL, re-validating at delivery time.
 *
 * The connection targets the pinned IP while `Host`/SNI carry the original
 * hostname, so TLS verification stays correct and no second DNS answer can be
 * substituted between validation and connect.
 */
export async function deliverWebhook(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<WebhookDeliveryResult> {
  let target: ResolvedWebhookTarget;
  try {
    target = await assertWebhookUrlAllowed(url);
  } catch (err) {
    return { ok: false, error: err instanceof WebhookPolicyError ? err.message : 'egress policy check failed' };
  }

  const limit = timeoutMs();
  return new Promise<WebhookDeliveryResult>((resolve) => {
    let settled = false;
    const finish = (result: WebhookDeliveryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => {
      requestRef.destroy(new Error('aborted'));
      finish({ ok: false, error: 'aborted' });
    };

    const payload = Buffer.from(body, 'utf8');
    const requestHeaders: Record<string, string> = {
      ...headers,
      'content-length': String(payload.byteLength),
      // Preserve the caller's hostname for virtual hosting / TLS SNI.
      host: target.family === 6 ? `[${target.hostname}]:${target.port}` : `${target.hostname}:${target.port}`,
    };

    const requestRef =
      target.protocol === 'https:'
        ? httpsRequest({
            protocol: target.protocol,
            hostname: target.ip,
            port: target.port,
            method: 'POST',
            path: new URL(target.url).pathname + new URL(target.url).search,
            headers: requestHeaders,
            // Keep certificate verification against the real hostname while the
            // socket is pointed at the pinned IP.
            servername: target.hostname,
            timeout: limit,
            agent: false,
          })
        : httpRequest({
            protocol: target.protocol,
            hostname: target.ip,
            port: target.port,
            method: 'POST',
            path: new URL(target.url).pathname + new URL(target.url).search,
            headers: requestHeaders,
            timeout: limit,
            agent: false,
          });

    const timer = setTimeout(() => {
      requestRef.destroy(new Error('webhook timeout'));
      finish({ ok: false, error: `timed out after ${limit}ms` });
    }, limit);
    (timer as unknown as { unref?: () => void }).unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });

    requestRef.on('timeout', () => requestRef.destroy(new Error('webhook timeout')));
    requestRef.on('error', (err) => finish({ ok: false, error: err.message }));
    requestRef.on('response', (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      // Redirects are a delivery failure, never followed: the target of a 302 is
      // an unvalidated address by construction.
      if (status >= 300 && status < 400) {
        res.destroy();
        finish({ ok: false, status, error: 'redirect not followed' });
        return;
      }
      // Drain under a hard cap so a hostile endpoint cannot stream forever.
      let read = 0;
      res.on('data', (chunk: Buffer) => {
        read += chunk.length;
        if (read > MAX_RESPONSE_BYTES) {
          res.destroy();
          finish({ ok: false, status, error: 'response body exceeded cap' });
        }
      });
      res.on('end', () => finish({ ok: status >= 200 && status < 300, status }));
      res.on('error', (err) => finish({ ok: false, status, error: err.message }));
    });

    // The caller may have aborted while we were resolving DNS above, before the
    // abort listener existed — check the latched state rather than missing it.
    // Placed AFTER the error handlers so the destroy cannot surface unhandled.
    if (signal?.aborted) {
      onAbort();
      return;
    }

    requestRef.end(payload);
  });
}

/** True when a webhook URL passes the policy (registration gate). */
export async function isWebhookUrlAllowed(url: string): Promise<boolean> {
  try {
    await assertWebhookUrlAllowed(url);
    return true;
  } catch {
    return false;
  }
}
