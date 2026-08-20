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

  it('connectionTimeout stays short — it guards handshakes, not request bodies', () => {
    // A long connectionTimeout is a slowloris foothold; it must NOT be raised
    // alongside requestTimeout.
    expect(SERVER_LIMITS.connectionTimeout).toBeLessThanOrEqual(30_000);
  });

  it('hardening limits remain sane', () => {
    expect(SERVER_LIMITS.bodyLimit).toBeGreaterThan(0);
    expect(SERVER_LIMITS.maxParamLength).toBeGreaterThan(0);
    expect(SERVER_LIMITS.memoryLimit).toBeGreaterThan(0);
  });
});
