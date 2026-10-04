/**
 * Final egress review regressions (reviewer-confirmed gaps).
 *
 * - IPv6 link-local fe80::/10 covers fe80..febf in EVERY spelling, not just the
 *   literal `fe80` prefix (fe81::1, febf::1 were accepted).
 * - Deprecated site-local fec0::/10 (fec0..feff) is internal, not public.
 * - Production requires HTTPS at the ACTUAL registration+delivery gate
 *   (`assertWebhookUrlAllowed`), not only in the unused `validateWebhookUrl`
 *   wrapper: http://8.8.8.8 in NODE_ENV=production must be refused.
 *   The explicit operator allowlist (`DMRX_A2A_WEBHOOK_ALLOWED_IPS`) still
 *   permits an allowlisted literal (documented opt-in, e.g. loopback fixtures).
 * - Numeric IPv4 obfuscation is judged on the ORIGINAL authority before WHATWG
 *   URL normalization: 0x08080808 / 134744072 / 010.010.010.010 all normalize
 *   to 8.8.8.8 and were accepted; the documented no-obfuscated-IP policy
 *   refuses them. Canonical public literals still follow the NODE_ENV contract
 *   (http allowed outside production, refused in production).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertWebhookUrlAllowed,
  isPublicAddress,
  WebhookPolicyError,
} from '../../services/mcp-server/src/a2a/egress.js';

const originalAllowlist = process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
  else process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = originalAllowlist;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  vi.unstubAllEnvs();
});

async function expectRefused(url: string): Promise<string> {
  const err = await assertWebhookUrlAllowed(url).then(
    () => null,
    (e) => e,
  );
  expect(err, `${url} must be refused`).toBeInstanceOf(WebhookPolicyError);
  return String((err as Error).message);
}

describe('final egress review: IPv6 link-local and site-local are internal', () => {
  it.each([
    ['fe81::1'],
    ['febf::1'],
    ['fe90::1'],
    ['fea0::1'],
    ['FE81::1'],
    ['fe80:0:0:0:0:0:0:1'],
  ])('isPublicAddress(%s) is false (fe80::/10)', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([['fec0::1'], ['fed0::1'], ['feff::1'], ['FEC0::1']])(
    'isPublicAddress(%s) is false (fec0::/10 deprecated site-local)',
    (ip) => {
      expect(isPublicAddress(ip)).toBe(false);
    },
  );

  it.each([
    ['http://[fe81::1]/hook'],
    ['http://[febf::1]/hook'],
    ['http://[fec0::1]/hook'],
    ['http://[feff::1]/hook'],
  ])('refuses webhook literal %s', async (url) => {
    await expectRefused(url);
  });
});

describe('final egress review: production HTTPS enforced at the actual gate', () => {
  it('refuses public canonical http in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const message = await expectRefused('http://8.8.8.8/hook');
    expect(message).toMatch(/https/i);
  });

  it('allows public canonical http outside production (NODE_ENV contract)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const target = await assertWebhookUrlAllowed('http://8.8.8.8/hook');
    expect(target.ip).toBe('8.8.8.8');
  });

  it('preserves the explicit operator opt-in for an allowlisted literal in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    const target = await assertWebhookUrlAllowed('http://127.0.0.1:9/hook');
    expect(target.ip).toBe('127.0.0.1');
  });
});

describe('final egress review: obfuscated IPv4 judged before URL normalization', () => {
  it.each([
    ['http://0x08080808/hook'],
    ['http://134744072/hook'],
    ['http://010.010.010.010/hook'],
  ])('refuses %s even though WHATWG normalizes it to 8.8.8.8', async (url) => {
    const message = await expectRefused(url);
    expect(message).toMatch(/non-canonical/i);
  });

  it('still allows the canonical public literal outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const target = await assertWebhookUrlAllowed('http://8.8.8.8/hook');
    expect(target.ip).toBe('8.8.8.8');
  });
});
