import { describe, expect, it } from 'vitest';

import type {
  ResourceCell,
  ResourceCellIdentity,
  normalizeQuotaPoolId,
} from '@dmr-x/core';
import {
  inferPricingTier,
  getProviderTemplate,
  getVerifiedFreeOffers,
  PROVIDER_CATALOG,
} from '@dmr-x/provider-catalog';
import {
  CapacityManager,
  type CapacityStore,
} from '@dmr-x/quota';
import type { DemandVector, QuotaUnit } from '@dmr-x/quota';

describe('Universal inference resource fleet', () => {
  it('keeps quota-pool identity separate from credential identity', () => {
    const pool = normalizeQuotaPoolId({
      providerId: 'groq',
      scope: 'organization',
      scopeId: 'org-1',
      keyId: 'credential-a',
    });

    expect(pool).toBe('groq::organization::org-1');
    expect(pool).not.toContain('credential-a');
  });

  it('models a local/device resource as a first-class schedulable cell', () => {
    const identity: ResourceCellIdentity = {
      providerId: 'browser-webgpu',
      credentialId: 'device-session',
      quotaPoolId: 'browser::device::device-1',
      endpointId: 'webgpu',
      modelId: 'gemma-4-26b',
      resourceKind: 'webgpu',
    };

    const cell: ResourceCell = {
      identity,
      capabilities: ['text_generation', 'embeddings'],
      modalities: ['text'],
      economics: [{
        unit: 'usd',
        unitCost: 0,
        freeOffer: 'device_local',
        confidence: 1,
      }],
      policy: {
        dataRetention: 'no_retention',
        trainingUse: 'not_used',
        productionAllowed: true,
      },
      online: true,
      lastObservedAtMs: Date.now(),
    };

    expect(cell.economics[0].freeOffer).toBe('device_local');
    expect(cell.identity.resourceKind).toBe('webgpu');
  });

  it('adds the current Z.ai coding trial as a distinct execution surface', () => {
    const provider = getProviderTemplate('zai-coding');
    expect(provider?.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(provider?.models.map((m) => m.id)).toEqual([
      'glm-5.3',
      'glm-5.3-flash',
    ]);

    const offers = getVerifiedFreeOffers('zai-coding');
    expect(offers).toHaveLength(2);
    expect(offers.reduce((n, offer) => n + (offer.amount ?? 0), 0)).toBe(8_000_000);
    expect(offers.every((offer) => offer.expiresAfterDays === 5)).toBe(true);
  });

  it('keeps recurring free, promo credits and local resources distinct', () => {
    const z = getVerifiedFreeOffers('zai-coding');
    const fireworks = getVerifiedFreeOffers('fireworks');
    const aws = getVerifiedFreeOffers('aws-bedrock');
    const inception = getVerifiedFreeOffers('inception');
    const alibaba = getVerifiedFreeOffers('alibaba-model-studio');
    const speechmatics = getVerifiedFreeOffers('speechmatics');
    const cloudflareSearch = getVerifiedFreeOffers('cloudflare-ai-search');
    expect(z[0].kind).toBe('trial');
    expect(fireworks[0].kind).toBe('startup_credits');
    expect(aws[0].kind).toBe('promo_credits');
    expect(inception[0].unit).toBe('tokens');
    expect(alibaba[0].expiresAfterDays).toBe(90);
    expect(speechmatics[0].amount).toBe(100);
    const embeddingOffers = alibaba.filter((o) => o.modelId?.includes('embedding'));
    expect(embeddingOffers).toHaveLength(2);
    expect(cloudflareSearch).toHaveLength(2);
  });

  it('does not treat missing pricing as free', () => {
    expect(inferPricingTier({
      id: 'unknown-model',
      modalities: ['llm'],
      capabilities: [],
      specializations: [],
    })).toBe('unknown');

    const replicate = getProviderTemplate('replicate');
    const unpriced = replicate?.models.find((m) => !m.freeTier && !m.inputCostPer1M && !m.outputCostPer1M);
    if (unpriced) {
      expect(unpriced.pricingTier).toBe('unknown');
    }
  });

  it('exposes the verified offer registry without duplicating provider identities', () => {
    const zaiMatches = PROVIDER_CATALOG.filter((p) => p.id === 'zai-coding');
    expect(zaiMatches).toHaveLength(1);
    expect(getVerifiedFreeOffers().length).toBeGreaterThanOrEqual(23);
  });
});

describe('Capacity manager reservation identity', () => {
  function makeStore() {
    let capturedId: string | undefined;
    let released = false;
    let committed = false;

    const store: CapacityStore = {
      async tryReserve(
        _dimensions: Array<{ unit: QuotaUnit; scopeId: string; amount: number; currentRemaining: number | null }>,
        reservationId?: string,
      ) {
        capturedId = reservationId;
        return [{ unit: 'requests' as QuotaUnit, scopeId: 'pool', newRemaining: 0 }];
      },
      async release() {
        released = true;
      },
      async commit() {
        committed = true;
      },
      async expireLeases() {
        return 0;
      },
    };

    return { store, getId: () => capturedId, getReleased: () => released, getCommitted: () => committed };
  }

  it('passes one stable id from manager to the capacity store', async () => {
    const fake = makeStore();
    const manager = new CapacityManager({
      store: fake.store,
      estimateDemand: (_request): DemandVector => ({
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        concurrency: 1,
      }),
    });

    manager.registerVector({
      providerId: 'p',
      modelId: 'm',
      keyId: 'pool',
      dimensions: [{
        unit: 'requests',
        scope: 'account',
        scopeId: 'pool',
        limit: 10,
        remaining: 10,
        replenishment: 'fixed_window',
        resetAtMs: Date.now() + 60_000,
        state: 'available',
        confidence: 1,
        observedAtMs: Date.now(),
        staleAfterMs: 60_000,
      }],
      lastObservedAtMs: Date.now(),
    });

    const result = await manager.reserve('p', 'm', 'pool', {});
    expect(result.success).toBe(true);
    expect(result.reservation?.id).toBeTruthy();
    expect(fake.getId()).toBe(result.reservation?.id);
  });
});
