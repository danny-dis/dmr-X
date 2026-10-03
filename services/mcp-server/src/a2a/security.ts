import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

import type { IncomingHttpHeaders, ServerResponse } from 'node:http';

const A2A_VERSION = '1.0';
const LEGACY_VERSION = '0.3';
const MAX_RATE_BUCKETS = 10_000;

interface Bucket { started: number; count: number; }

const buckets = new Map<string, Bucket>();

function configuredKeys(): string[] {
  const raw = process.env.DMRX_A2A_API_KEY || process.env.DMRX_MCP_API_KEY || '';
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

export function a2aAuthRequired(): boolean {
  const explicit = process.env.DMRX_A2A_REQUIRE_AUTH;
  if (explicit !== undefined) return explicit !== 'false';
  return process.env.NODE_ENV === 'production';
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function authenticateA2A(headers: IncomingHttpHeaders): { ok: boolean; principal?: string; reason?: string } {
  const keys = configuredKeys();
  if (!a2aAuthRequired() && keys.length === 0) return { ok: true, principal: 'anonymous' };
  if (keys.length === 0) return { ok: false, reason: 'A2A authentication is required but no API key is configured' };

  const raw = headers.authorization;
  if (typeof raw !== 'string' || !/^Bearer\s+/i.test(raw)) {
    return { ok: false, reason: 'Missing Bearer authentication' };
  }

  const token = raw.replace(/^Bearer\s+/i, '').trim();
  const index = keys.findIndex((key) => safeEqual(token, key));
  if (index < 0) return { ok: false, reason: 'Invalid credentials' };

  return {
    ok: true,
    // Never persist or log the credential. A stable opaque principal is enough
    // for task ownership and rate limiting.
    principal: createHash('sha256').update(token).digest('hex').slice(0, 32),
  };
}

export function checkA2ARateLimit(principal: string, limit = Number(process.env.DMRX_A2A_RATE_LIMIT || 120)): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return true;
  const now = Date.now();
  const bucket = buckets.get(principal);
  if (!bucket || now - bucket.started >= 60_000) {
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [key, value] of buckets) {
        if (now - value.started >= 60_000) buckets.delete(key);
      }
    }
    buckets.set(principal, { started: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export function supportedA2AVersion(raw: string | string[] | undefined): boolean {
  const version = Array.isArray(raw) ? raw[0] : raw;
  // 0.3 peers are explicitly supported for compatibility. Empty is treated as
  // 0.3 by the protocol, but production clients should send A2A-Version.
  return !version || version === A2A_VERSION || version === LEGACY_VERSION;
}

export function negotiatedA2AVersion(raw: string | string[] | undefined): '1.0' | '0.3' {
  const version = Array.isArray(raw) ? raw[0] : raw;
  return version === LEGACY_VERSION ? LEGACY_VERSION : A2A_VERSION;
}

function isPrivateAddress(address: string): boolean {
  const ip = net.isIP(address);
  if (ip === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (ip === 6) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') ||
      lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb');
  }
  return false;
}

export async function validateWebhookUrl(raw: string): Promise<{ ok: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid webhook URL' };
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    return { ok: false, reason: 'Webhook URL must use HTTP(S)' };
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Production webhook URLs must use HTTPS' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Webhook URL credentials are not allowed' };

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    return { ok: false, reason: 'Private/metadata webhook destinations are not allowed' };
  }

  if (isPrivateAddress(host)) return { ok: false, reason: 'Private/link-local webhook destinations are not allowed' };

  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, reason: 'Webhook hostname resolves to a private/link-local address' };
    }
  } catch {
    return { ok: false, reason: 'Webhook hostname could not be resolved' };
  }

  return { ok: true };
}

export function sendAuthError(res: ServerResponse, status = 401, message = 'Unauthorized'): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: message }));
}

export function resetA2ASecurityState(): void {
  buckets.clear();
}
