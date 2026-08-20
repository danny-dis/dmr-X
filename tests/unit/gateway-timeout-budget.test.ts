import { describe, it, expect } from 'vitest';

import { SERVER_LIMITS } from '../../apps/gateway/src/server.js';

/**
 * Regression: the HTTP transport timeout must never be shorter than the work
 * budget it fronts.
 *
 * `requestTimeout` was 60s while the agentic loop allows
 * DMRX_AGENTIC_TURN_TIMEOUT_MS (default 120s) PER TURN across up to `maxSteps`
 * turns. Any agent task that legitimately ran past a minute had its socket
 * closed mid-flight, so the caller saw `RemoteDisconnected` — not an error
 * response — after the tokens had already been paid for.
 *
 * Measured against the real DMR-X agent fleet: 6 of 24 delegated tasks failed
 * at ~58s, every one of them a hard cluster around the 60s ceiling rather than
 * a random distribution.
 *
 * These assertions are deliberately relational, not hardcoded to 300s: raising
 * the per-turn ceiling without raising the transport ceiling should fail here.
 */

const TURN_TIMEOUT_DEFAULT_MS = 120_000; // agent-chat-loop.ts TURN_TIMEOUT_MS

describe('gateway server limits vs agentic work budget', () => {
  it('requestTimeout is at least one full agent turn', () => {
    expect(SERVER_LIMITS.requestTimeout).toBeGreaterThanOrEqual(TURN_TIMEOUT_DEFAULT_MS);
  });

  it('requestTimeout leaves room for a multi-turn task (>= 2 turns)', () => {
    expect(SERVER_LIMITS.requestTimeout).toBeGreaterThanOrEqual(2 * TURN_TIMEOUT_DEFAULT_MS);
  });

  it('keepAliveTimeout exceeds requestTimeout so idle reaping never pre-empts work', () => {
    expect(SERVER_LIMITS.keepAliveTimeout).toBeGreaterThan(SERVER_LIMITS.requestTimeout);
  });

  /**
   * `connectionTimeout` maps to Node's `server.timeout` — the SOCKET inactivity
   * timeout. It is NOT a handshake or slowloris guard (that job belongs to
   * `requestTimeout`, which bounds how long receiving a request may take, and to
   * `headersTimeout`). Because it fires on socket inactivity with no regard for
   * a running handler, a value below `requestTimeout` silently severs long agent
   * turns: the client gets a dropped connection instead of an error response,
   * and the provider tokens are already spent.
   *
   * This suite previously asserted `connectionTimeout <= 30_000` on the belief
   * that it guarded handshakes. That assertion encoded the bug: with
   * DMRX_CONNECTION_TIMEOUT=60000 fronting a 120s requestTimeout, 7 of 24 fleet
   * tasks died in a 56.5-60.4s band with RemoteDisconnected. The socket layer
   * always wins, so the ordering — not the magnitude — is what must hold.
   */
  it('connectionTimeout is at least requestTimeout so sockets outlive in-flight requests', () => {
    expect(SERVER_LIMITS.connectionTimeout).toBeGreaterThanOrEqual(SERVER_LIMITS.requestTimeout);
  });

  it('the three transport timeouts are correctly ordered', () => {
    // connection >= keepAlive >= request. Any inversion means the outer layer
    // kills a request the inner layer still considers valid.
    expect(SERVER_LIMITS.connectionTimeout).toBeGreaterThanOrEqual(SERVER_LIMITS.keepAliveTimeout);
    expect(SERVER_LIMITS.keepAliveTimeout).toBeGreaterThanOrEqual(SERVER_LIMITS.requestTimeout);
  });

  it('hardening limits remain sane', () => {
    expect(SERVER_LIMITS.bodyLimit).toBeGreaterThan(0);
    expect(SERVER_LIMITS.maxParamLength).toBeGreaterThan(0);
    expect(SERVER_LIMITS.memoryLimit).toBeGreaterThan(0);
  });
});
