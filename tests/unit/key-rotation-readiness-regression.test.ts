import { describe, expect, it, vi } from 'vitest';

const { getKeysWithQuota } = vi.hoisted(() => ({
  getKeysWithQuota: vi.fn(),
}));

vi.mock('../../services/quota/src/rate-limit-tracker.js', () => ({
  getRateLimitTracker: () => ({ getKeysWithQuota }),
}));

import { KeyRotationService } from '../../services/quota/src/key-rotation.service.js';

function quota(keyId: string, isExhausted: boolean, percentRemaining = 50) {
  return {
    keyId,
    providerId: 'provider',
    requestsRemaining: isExhausted ? 0 : 10,
    requestsLimit: 10,
    tokensRemaining: null,
    tokensLimit: null,
    resetAtMs: null,
    percentRemaining,
    isExhausted,
  };
}

describe('smart key rotation quota readiness', () => {
  it('keeps exhausted registered keys out while retaining healthy and unknown registered keys', () => {
    const single = new KeyRotationService();
    single.registerKeys('provider', ['exhausted-only']);
    getKeysWithQuota.mockReturnValue([quota('exhausted-only', true)]);

    expect(single.getNextKey('provider')).toBeNull();
    expect(single.getRotationStats()[0].selections).toEqual([
      { key: 'exha...only', count: 0 },
    ]);

    const hashed = new KeyRotationService();
    hashed.registerKeys('provider', ['hashed-exhausted']);
    getKeysWithQuota.mockReturnValue([quota(hashed.hashKey('hashed-exhausted'), true)]);
    expect(hashed.getNextKey('provider')).toBeNull();

    const mixed = new KeyRotationService();
    mixed.registerKeys('provider', ['spent-key', 'healthy-key']);
    getKeysWithQuota.mockReturnValue([
      quota('spent-key', true),
      quota(mixed.hashKey('healthy-key'), false, 80),
    ]);
    expect(mixed.getNextKey('provider')).toBe('healthy-key');

    const allSpent = new KeyRotationService();
    allSpent.registerKeys('provider', ['first-spent', 'second-spent']);
    getKeysWithQuota.mockReturnValue([
      quota('first-spent', true),
      quota(allSpent.hashKey('second-spent'), true),
    ]);
    expect(allSpent.getNextKey('provider')).toBeNull();

    const unknown = new KeyRotationService();
    unknown.registerKeys('provider', ['spent-known', 'unknown-key']);
    getKeysWithQuota.mockReturnValue([quota('spent-known', true)]);
    expect(unknown.getNextKey('provider')).toBe('unknown-key');

    const stale = new KeyRotationService();
    stale.registerKeys('provider', ['first-registered', 'second-registered']);
    getKeysWithQuota.mockReturnValue([quota('stale-unregistered', true)]);
    expect(stale.getNextKey('provider')).toBe('first-registered');

    const noQuotaData = new KeyRotationService();
    noQuotaData.registerKeys('provider', ['round-robin-first', 'round-robin-second']);
    getKeysWithQuota.mockReturnValue([]);
    expect(noQuotaData.getNextKey('provider')).toBe('round-robin-first');
  });
});
