/**
 * SSRF (Server-Side Request Forgery) defense with DNS-rebinding protection.
 *
 * The classic mistake is to validate the *literal hostname string* against
 * `localhost` / `127.0.0.1` / private-CIDR regexes. That fails in two
 * situations:
 *
 *   1. The attacker registers a name that resolves to a private IP
 *      (e.g. `localtest.me`, `127.0.0.1.nip.io`, `lvh.me`).
 *   2. The attacker DNS-rebinds — the hostname returns a public IP
 *      during validation, then `127.0.0.1` (or similar) when fetch
 *      resolves it again.
 *
 * The fix is to resolve the hostname ourselves, validate the *resolved
 * IP*, and hand the caller a `lookup` function that returns ONLY the
 * validated IP at fetch time. Passing that lookup to undici's
 * `Agent({ connect: { lookup } })` and then to `fetch` via
 * `dispatcher` pins the outbound connection to the validated address.
 *
 * IP-family normalization also matters: `::ffff:127.0.0.1` is an
 * IPv4-mapped IPv6 address that the OS routes to `127.0.0.1`, so we
 * fold it back to its IPv4 form before applying the blocklist.
 */
import dns from 'node:dns';
import net, { type IPVersion } from 'node:net';

export interface ValidatedURL {
  /** The original URL string we were given. */
  url: string;
  /** The hostname from the parsed URL (no IPv6 brackets). */
  hostname: string;
  /** The IP address we resolved / accepted after validation. */
  ip: string;
  /** `4` for IPv4, `6` for IPv6. */
  family: number;
  /**
   * Node-style DNS lookup that always returns the validated IP, regardless
   * of the actual hostname argument. Use this with undici's
   * `Agent({ connect: { lookup } })` and pass the Agent as the
   * `dispatcher` option on `fetch` — that pins the outbound connection
   * to the validated IP, preventing DNS rebinding between validation
   * and fetch.
   */
  lookup: (
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ) => void;
}

/** IP families we hand to `net.BlockList.check()`. */
type BlockListFamily = 'ipv4' | 'ipv6';

/**
 * Build a single BlockList covering every range we treat as "private /
 * loopback / link-local / non-routable" for SSRF purposes. The set is
 * deliberately generous: blocking one extra public range is a smaller
 * incident than allowing one private range through.
 */
function buildBlockList(): net.BlockList {
  const list = new net.BlockList();

  // ---- IPv4 -------------------------------------------------------------
  list.addSubnet('0.0.0.0', 8, 'ipv4');      // "this network" / 0.0.0.0/8
  list.addSubnet('10.0.0.0', 8, 'ipv4');     // RFC1918 private
  list.addSubnet('100.64.0.0', 10, 'ipv4');  // CGNAT
  list.addSubnet('127.0.0.0', 8, 'ipv4');    // loopback
  list.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. AWS metadata 169.254.169.254)
  list.addSubnet('172.16.0.0', 12, 'ipv4');  // RFC1918 private
  list.addSubnet('192.0.0.0', 24, 'ipv4');   // IETF protocol assignments
  list.addSubnet('192.0.2.0', 24, 'ipv4');   // TEST-NET-1 (documentation)
  list.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918 private
  list.addSubnet('198.18.0.0', 15, 'ipv4');  // Benchmarking (RFC2544)
  list.addSubnet('198.51.100.0', 24, 'ipv4'); // TEST-NET-2
  list.addSubnet('203.0.113.0', 24, 'ipv4');  // TEST-NET-3
  list.addSubnet('224.0.0.0', 4, 'ipv4');    // Multicast
  list.addSubnet('240.0.0.0', 4, 'ipv4');    // Reserved (includes 255.255.255.255)

  // ---- IPv6 -------------------------------------------------------------
  list.addAddress('::1', 'ipv6');            // loopback
  list.addSubnet('::', 128, 'ipv6');         // unspecified
  list.addSubnet('64:ff9b::', 96, 'ipv6');  // NAT64
  list.addSubnet('100::', 64, 'ipv6');       // Discard prefix
  list.addSubnet('2001::', 32, 'ipv6');      // Teredo (and ORCHID)
  list.addSubnet('2001:db8::', 32, 'ipv6');  // Documentation
  list.addSubnet('fc00::', 7, 'ipv6');       // Unique local (ULA)
  list.addSubnet('fe80::', 10, 'ipv6');      // Link-local
  list.addSubnet('ff00::', 8, 'ipv6');       // Multicast

  return list;
}

const IP_BLOCK_LIST = buildBlockList();

/**
 * Convert an IPv6 address to its embedded IPv4 form if it is a
 * IPv4-mapped IPv6 address (e.g. `::ffff:127.0.0.1` → `127.0.0.1`,
 * `::ffff:7f00:1` → `127.0.0.1`). Returns `null` if the address is
 * not IPv4-mapped.
 *
 * The OS routes IPv4-mapped IPv6 addresses to the corresponding IPv4
 * endpoint, so if we don't fold them back to IPv4 form the blocklist
 * check (which uses `family` from the resolver) would miss loopback /
 * private ranges.
 */
function ipv6MappedToIpv4(address: string): string | null {
  if (!net.isIPv6(address)) return null;
  const lower = address.toLowerCase();
  // Strip the v4-mapped prefix and look at what follows.
  if (lower === '::ffff:0:0' || lower === '::ffff:0') return '0.0.0.0';
  if (!lower.startsWith('::ffff:')) return null;
  const tail = lower.slice('::ffff:'.length);
  if (net.isIPv4(tail)) return tail;
  // Hex form: `::ffff:7f00:1` — two 16-bit groups => 4 IPv4 octets.
  const parts = tail.split(':');
  if (parts.length === 2) {
    const hi = parseInt(parts[0], 16);
    const lo = parseInt(parts[1], 16);
    if (
      Number.isFinite(hi) && hi >= 0 && hi <= 0xffff &&
      Number.isFinite(lo) && lo >= 0 && lo <= 0xffff
    ) {
      return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
    }
  }
  return null;
}

/** Returns true when the given IP belongs to a blocked range. */
function isPrivateIP(address: string, family: number): boolean {
  let normalized = address;
  let normalizedFamily: BlockListFamily = family === 6 ? 'ipv6' : 'ipv4';
  if (normalizedFamily === 'ipv6') {
    const mapped = ipv6MappedToIpv4(address);
    if (mapped) {
      normalized = mapped;
      normalizedFamily = 'ipv4';
    }
  }
  return IP_BLOCK_LIST.check(normalized, normalizedFamily as IPVersion);
}

/**
 * Parse + DNS-resolve + IP-validate a user-supplied base URL.
 *
 * Throws `ValidationError` if:
 *   - the URL is malformed
 *   - the protocol is not `http:` or `https:`
 *   - DNS resolution fails or returns no records
 *   - any resolved address belongs to a private / loopback / link-local
 *     range (including IPv4-mapped IPv6 forms)
 *
 * On success, returns the parsed URL plus a `lookup` function that
 * returns ONLY the validated IP — wire that into fetch's `dispatcher`
 * to make the outbound connection bind to the IP we just validated,
 * closing the DNS-rebinding window.
 *
 * Example (with undici):
 *   const v = await validateBaseUrlForSSRF('https://api.openai.com/v1');
 *   const dispatcher = new Agent({ connect: { lookup: v.lookup } });
 *   const res = await fetch(v.url, { dispatcher, headers: { ... } });
 */
export async function validateBaseUrlForSSRF(urlStr: string): Promise<ValidatedURL> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new ValidationError('Invalid base_url');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ValidationError('Only http and https protocols are allowed');
  }

  // URL parses IPv6 literals with brackets in `.hostname` (e.g. `[::1]`).
  // Strip the brackets so we can resolve / check the address directly.
  let hostname = parsedUrl.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  let resolvedIP: string;
  let resolvedFamily: number;

  if (net.isIP(hostname)) {
    // Hostname is already an IP literal — no DNS needed. The blocklist
    // check below still applies.
    resolvedIP = hostname;
    resolvedFamily = net.isIPv4(hostname) ? 4 : 6;
  } else {
    let records: dns.LookupAddress[];
    try {
      records = await dns.promises.lookup(hostname, { all: true });
    } catch {
      throw new ValidationError(`Could not resolve hostname: ${hostname}`);
    }
    if (!records || records.length === 0) {
      throw new ValidationError(`No DNS records for hostname: ${hostname}`);
    }
    // Reject if ANY resolved address is private/loopback. The OS may
    // pick any of them, so we must validate the whole set.
    for (const r of records) {
      if (isPrivateIP(r.address, r.family)) {
        throw new ValidationError('Fetching private/internal addresses is not allowed');
      }
    }
    resolvedIP = records[0].address;
    resolvedFamily = records[0].family;
  }

  // Final check on the chosen primary address — also catches the case
  // where the hostname is an IP literal we accepted above.
  if (isPrivateIP(resolvedIP, resolvedFamily)) {
    throw new ValidationError('Fetching private/internal addresses is not allowed');
  }

  const lookup: ValidatedURL['lookup'] = (_hostname, _options, callback) => {
    // We deliberately ignore the arguments and return the validated
    // IP/family. The caller has already authorised this destination.
    callback(null, resolvedIP, resolvedFamily);
  };

  return {
    url: urlStr,
    hostname,
    ip: resolvedIP,
    family: resolvedFamily,
    lookup,
  };
}

// ---------------------------------------------------------------------------
// Lightweight ValidationError — kept inline so this module has no app-level
// dependencies and can be unit-tested in isolation. The shape matches
// `@dmr-x/core` ValidationError, which the Fastify error handler recognises.
// ---------------------------------------------------------------------------
export class ValidationError extends Error {
  statusCode = 400;
  code = 'validation_error';
  details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}
