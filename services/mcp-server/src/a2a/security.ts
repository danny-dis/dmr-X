import { createHash } from 'node:crypto';
import { buildHttpBearerPolicy } from '../http-auth-session.js';
import type { McpConfigFile } from '../config.js';

import type { IncomingHttpHeaders, ServerResponse } from 'node:http';

import { authenticateBearer, type AuthenticationResult, type BearerAuthPolicy } from '../auth-runtime.js';
import { assertWebhookUrlAllowed, WebhookPolicyError } from './egress.js';

const A2A_VERSION = '1.0';
const LEGACY_VERSION = '0.3';
const MAX_RATE_BUCKETS = 10_000;

interface Bucket { started: number; count: number; }

const buckets = new Map<string, Bucket>();

/**
 * OPTIONAL external override of the A2A bearer policy.
 *
 * The authoritative source is `configuredKeys()` below, which is IDENTICAL to
 * the set the MCP boundary and the installed A2A owner resolver use
 * (`DMRX_A2A_API_KEY || DMRX_MCP_API_KEY`) so authentication and ownership can
 * never disagree. `setA2ABearerPolicy` exists so a caller that has already built
 * a policy from the same set can pin it explicitly (e.g. a listener wiring the
 * A2A boundary to its own MCP policy object).
 */
let policyOverride: BearerAuthPolicy | null = null;

/** Install (or clear, with `null`) an explicit A2A bearer policy override. */
export function setA2ABearerPolicy(policy: BearerAuthPolicy | null): void {
  policyOverride = policy;
}

/**
 * THE credential source for the A2A boundary.
 *
 * `DMRX_A2A_API_KEY` is the A2A-specific key; `DMRX_MCP_API_KEY` is accepted so
 * a deployment that only ever configured an MCP key keeps working. The two
 * layers that must agree — `authenticateA2A()` here and the owner resolver
 * installed in index.ts (`buildHttpBearerPolicy`, same `||` precedence) — now
 * read the same expression, so an A2A-only deployment derives ownership from its
 * validated A2A principal instead of falling back to a header-asserted identity.
 *
 * This is A2A-only: an A2A key is never folded into the MCP policy, so it can
 * never act as an MCP credential (see `buildHttpBearerPolicy`).
 */
export function buildA2ABearerPolicy(configFile: McpConfigFile | null = null): BearerAuthPolicy {
  if (policyOverride) return policyOverride;
  const mcp = buildHttpBearerPolicy(configFile);
  if (mcp.malformed) return mcp;
  const a2a = (process.env.DMRX_A2A_API_KEY || '').split(',').map(key => key.trim()).filter(Boolean);
  if (a2a.length === 0) return mcp;
  // Existing MCP restrictions win if a credential appears in both sources.
  return {
    configured: true,
    malformed: false,
    keys: [...mcp.keys, ...a2a.filter(key => !mcp.keys.some(record => record.key === key)).map(key => ({ key }))],
  };
}


export function a2aAuthRequired(): boolean {
  const explicit = process.env.DMRX_A2A_REQUIRE_AUTH;
  if (explicit !== undefined) return explicit !== 'false';
  return process.env.NODE_ENV === 'production';
}


export function authenticateA2A(headers: IncomingHttpHeaders): { ok: boolean; principal?: string; reason?: string; allowedTools?: string[] } {
  return authenticateA2ARequest(headers);
}

/**
 * Validate one A2A request through the SAME policy the owner resolver uses, so
 * the authenticated principal and the owner digest are derived from an identical
 * credential set (and identical tool-restriction rules). Falls back to the
 * legacy `authenticateA2A` answer when no policy is configured, preserving the
 * unauthenticated-development behaviour.
 */
export function authenticateA2ARequest(
  headers: IncomingHttpHeaders,
): { ok: boolean; principal?: string; reason?: string; allowedTools?: string[] } {
  const policy = buildA2ABearerPolicy();
  if (!a2aAuthRequired() && !policy.configured && !policy.malformed) {
    return { ok: true, principal: 'anonymous' };
  }
  if (policy.malformed) return { ok: false, reason: 'A2A authentication is misconfigured' };
  if (!policy.configured) return { ok: false, reason: 'A2A authentication is required but no API key is configured' };
  const result: AuthenticationResult = authenticateBearer({ headers: headers as Record<string, string | string[] | undefined> }, policy);
  if (!result.authorized) return { ok: false, reason: 'Invalid credentials' };
  // A tool-restricted key can never reach A2A: the shared HTTP guard refuses it
  // and the owner seam refuses to mint an owner for it. Kept here too so the
  // rule holds even if this boundary is called directly.
  if (result.allowedTools !== undefined) return { ok: false, reason: 'Tool-restricted keys cannot access A2A' };
  return {
    ok: true,
    principal: createHash('sha256').update(result.principalId).digest('hex').slice(0, 32),
    allowedTools: result.allowedTools,
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
  return !version || version === LEGACY_VERSION ? LEGACY_VERSION : A2A_VERSION;
}

/**
 * Webhook URL check kept for callers that only need a yes/no answer.
 *
 * The ADDRESS policy is NOT re-implemented here any more. This module used to
 * carry its own `isPrivateAddress` + `lookup` pass that was strictly weaker than
 * the egress guard actually used at registration and delivery: it let multicast,
 * reserved and obfuscated IPv4 through, ignored IPv4-mapped IPv6 entirely, and
 * had no scheme-pinning to the address that would actually be dialled — so a
 * future caller adopting it would have quietly shipped a weaker SSRF policy. The
 * check now delegates to `assertWebhookUrlAllowed`, which is the single policy
 * and the one whose verdict matches what delivery will do.
 *
 * Kept as a wrapper (rather than deleted) so existing exports and callers keep
 * working, and to preserve the one rule that is genuinely local to this module:
 * plaintext HTTP is refused in production.
 */
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
  try {
    await assertWebhookUrlAllowed(raw);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof WebhookPolicyError ? err.message : 'Webhook URL could not be validated',
    };
  }
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
