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
 *     IPv4-mapped IPv6 forms, and including the transition prefixes whose real
 *     destination is a hidden IPv4: NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and
 *     Teredo (2001:0000::/32).
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

/**
 * IPv6 prefixes whose addresses carry a hidden IPv4 destination, so the address
 * itself can never be validated by inspection: NAT64 (64:ff9b::/96 and the
 * local-use 64:ff9b:1::/48) synthesises v4 traffic, and Teredo (2001:0000::/32)
 * tunnels through a relay whose server IPv4 is bit-flipped inside the address.
 *
 * These are the STRING-prefix fallbacks for a literal our expander cannot parse
 * (see `parseIpv6Groups`); the primary check is done on the expanded 16-bit
 * groups, where the prefix — not a spelling — decides. The compressed Teredo
 * spelling `2001::` has no zero group between its two colons, so the original
 * `/^2001:0{1,4}:/` never matched it; `/^2001:(0{1,4}:|:)/` covers it.
 */
const NAT64_RE = /^64:ff9b:/i;
const NAT64_LOCAL_RE = /^64:ff9b:1:/i;
const TEREDO_RE = /^2001:(0{1,4}:|:)/i;

/** Default ceiling on the DNS lookup performed at registration (ms). */
const DEFAULT_DNS_TIMEOUT_MS = 5_000;

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

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or null when the string
 * is not a well-formed IPv6 address.
 *
 * The policy below decides on the ADDRESS (the numeric prefix), never on a
 * spelling — that is what closed the compressed-form blind spots. A single
 * leading `::` run and a single trailing `::` run are supported, which is every
 * spelling a URL can carry into this function. A second `::`, more than eight
 * groups, or a malformed group returns null, and the caller then falls back to
 * the (more conservative, spelling-based) refusal prefixes.
 */
function parseIpv6Groups(addr: string): number[] | null {
  const lower = addr.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(lower)) return null;
  const doubleColon = lower.indexOf('::');
  if (doubleColon !== lower.lastIndexOf('::')) return null; // more than one '::'
  const split = (part: string): string[] => (part === '' ? [] : part.split(':'));
  let head: string[];
  let tail: string[];
  if (doubleColon === -1) {
    head = split(lower);
    tail = [];
  } else {
    head = split(lower.slice(0, doubleColon));
    tail = split(lower.slice(doubleColon + 2));
  }
  if (head.length + tail.length > 8) return null;
  const groups: number[] = [];
  for (const group of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  if (doubleColon === -1 && groups.length !== 8) return null;
  if (doubleColon !== -1) {
    while (groups.length < 8) groups.splice(head.length, 0, 0);
  }
  return groups;
}

function isPublicIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // drop zone id
  const groups = parseIpv6Groups(addr);

  // Transition mechanisms that tunnel an IPv4 target. Neither is ever the
  // literal destination of a webhook — both rewrite the address — and the
  // rewritten address is never visible to this check, so a NAT64/Teredo host
  // resolved as "public" while its real endpoint was an internal one.
  //   NAT64  64:ff9b::/96 (well-known) and 64:ff9b:1::/48 (local-use)
  //   Teredo 2001:0000::/32
  // Decided on the expanded groups so EVERY spelling of the prefix is caught,
  // including the fully-compressed `2001::` form the old regex missed.
  if (groups) {
    if (groups[0] === 0x64 && groups[1] === 0xff9b) return false; // NAT64 (well-known + local-use)
    if (groups[0] === 0x2001 && groups[1] === 0x0000) return false; // Teredo /32
    // Deprecated IPv4-compatible `::/96` (and any other leading-zero-compressed
    // literal that is neither `::` nor `::1`): the trailing 32 bits may hide a
    // private IPv4, and there is no legitimate public webhook written this way.
    // Refuse the whole class rather than enumerate every embedding spelling.
    // `::` and `::1` are covered by this same refusal.
    if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0) {
      return false;
    }
    // Numeric prefix checks so EVERY spelling of the range is caught, not just
    // the canonical `fe80`/`fc00`/`ff02` text. String-prefix tests missed
    // fe81::1..febf::1 (all of fe80::/10, whose first group runs fe80-febf)
    // and every fec0::/10 spelling (first group fec0-feff, deprecated
    // site-local but still routed internally where it matters for SSRF).
    if ((groups[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((groups[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
    if ((groups[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((groups[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  } else if (NAT64_RE.test(addr) || NAT64_LOCAL_RE.test(addr) || TEREDO_RE.test(addr)) {
    return false;
  } else {
    // Unparsable literal: fail closed on the spelling fallback for the ranges
    // above (covers a literal our expander rejects outright).
    if (/^fe[89ab]/i.test(addr)) return false; // fe80::/10
    if (/^fe[c-f]/i.test(addr)) return false; // fec0::/10
    if (/^f[cd]/i.test(addr)) return false; // fc00::/7
    if (/^ff/i.test(addr)) return false; // ff00::/8
  }

  // A trailing DOTTED-quad can appear in any IPv6 spelling (mapped, compatible,
  // or fully expanded). When it does, the embedded IPv4 decides reachability —
  // this closes the `::127.0.0.1` form that URL normalises to `::7f00:1` (handled
  // by the group check above) as well as a dotted literal handed straight to
  // `isPublicAddress` (e.g. from a DNS answer).
  const dottedQuad = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedQuad) return isPublicIpv4(dottedQuad[1]);

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
 * The authority host exactly as written by the caller, BEFORE `new URL()`
 * normalises it. WHATWG URL turns `0x08080808`, `134744072` and
 * `010.010.010.010` into `8.8.8.8`, so judging only the parsed hostname
 * accepts an obfuscated literal the documented policy refuses. Returns null
 * when the input has no parseable authority.
 */
function rawAuthorityHost(input: string): string | null {
  const match = input.trim().match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/);
  if (!match) return null;
  let authority = match[1];
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end === -1 ? authority : authority.slice(0, end + 1);
  }
  const colon = authority.lastIndexOf(':');
  if (colon !== -1 && /^\d*$/.test(authority.slice(colon + 1))) {
    authority = authority.slice(0, colon);
  }
  return authority;
}

/** True only for a canonical dotted-quad (`8.8.8.8`, no hex/octal/decimal tricks). */
function isCanonicalIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/.test(part)) return false;
  }
  return true;
}

/**
 * Resolve + validate a webhook URL, returning a target with a PINNED ip.
 * Throws `WebhookPolicyError` when any part of the destination is unacceptable.
 */
export async function assertWebhookUrlAllowed(url: string): Promise<ResolvedWebhookTarget> {
  // Judge obfuscation on the ORIGINAL authority: a numeric-looking host that is
  // not a canonical dotted-quad is refused even when WHATWG URL would
  // normalise it into a public literal (0x08080808 / 134744072 /
  // 010.010.010.010 all become 8.8.8.8 after parsing). Real hostnames contain
  // characters outside [0-9a-fx.] (or are canonical IPv4) and pass through.
  const rawAuthority = rawAuthorityHost(url);
  if (rawAuthority && !rawAuthority.startsWith('[')) {
    const lowered = rawAuthority.toLowerCase();
    if (/^[0-9a-fx.]+$/i.test(lowered) && /[0-9]/.test(lowered) && !isCanonicalIpv4(rawAuthority)) {
      throw new WebhookPolicyError(`Webhook host uses a non-canonical IP encoding: ${rawAuthority}`);
    }
  }

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

  // Production requires HTTPS at the ACTUAL registration+delivery gate, not just
  // in the `validateWebhookUrl` wrapper (which the registration path never
  // called, so `http://8.8.8.8` was stored and delivered in production). The
  // explicit operator opt-in is preserved: an allowlisted literal IP may still
  // use plaintext HTTP, and a hostname whose EVERY answer is allowlisted may
  // too — that is the documented escape hatch for cluster-internal collectors,
  // and it is logged below. No second resolution is introduced: the single
  // `resolveAll` below serves both the address check and this decision, and
  // redirects are still never followed (see `deliverWebhook`).
  const requiresHttps = process.env.NODE_ENV === 'production';

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
    if (requiresHttps && parsed.protocol !== 'https:' && !allowPrivate) {
      throw new WebhookPolicyError('Production webhook URLs must use HTTPS');
    }
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
  // Hostname production-HTTPS decision on the SAME single resolution: plaintext
  // HTTP is refused unless every answer is operator-allowlisted (the explicit
  // opt-in above), so no second lookup and no TOCTOU between the two checks.
  if (requiresHttps && parsed.protocol !== 'https:') {
    const allAllowlisted = addresses.every((addr) => allowlist.has(addr.address));
    if (!allAllowlisted) {
      throw new WebhookPolicyError('Production webhook URLs must use HTTPS');
    }
    loggerWarn(`[a2a] webhook ${host} uses plaintext HTTP under operator allowlist in production`);
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

/**
 * Resolve every A/AAAA record, IPv4 first for fixture determinism.
 *
 * BOUNDED: the lookup used to be awaited unbounded, so a slow or hostile
 * resolver held the registration request open indefinitely (and, on the inline
 * message/send path, held it open on work that could not proceed anyway). The
 * timeout surfaces as a `WebhookPolicyError`, i.e. the URL is refused rather
 * than the process being parked on one request. The pending lookup is not
 * cancelled — nothing else observes it — but its timer is always cleared, and it
 * is `unref`ed so a pending lookup can never hold the process open.
 */
async function resolveAll(host: string): Promise<LookupAddress[]> {
  const limit = dnsTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new WebhookPolicyError(`Webhook host did not resolve within ${limit}ms: ${host}`));
    }, limit);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    const rows = await Promise.race([
      dnsLookup(host, { all: true, family: 0, verbatim: false }),
      guard,
    ]);
    return [...rows].sort((a, b) => (a.family === b.family ? 0 : a.family === 4 ? -1 : 1));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dnsTimeoutMs(): number {
  const raw = Number(process.env.DMRX_A2A_DNS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DNS_TIMEOUT_MS;
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
