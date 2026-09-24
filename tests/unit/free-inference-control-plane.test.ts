/**
 * Issue #16 — free inference control plane (Tasks 1, 2, 4, 5, 7, 8).
 *
 * Single vitest project-unit entrypoint covering:
 * - Task 1: atomic reserve→dispatch→reconcile (QuotaService)
 * - Task 2: fail-closed calculateQuotaStatus
 * - Task 4: provider adapters reconcile quota (onUsage hook)
 * - Task 5: retry classifier (dimension, Retry-After, budget)
 * - Task 7: metrics counters
 * - Task 8: streaming replay safety (idempotency keys)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaService } from '../../services/quota/src/quota.service.js';
import {
  InMemoryCapacityStore,
} from '../../services/quota/src/capacity-manager.js';
import {
  buildVector,
  buildDimension,
} from '../../services/quota/src/quota-vector.js';
import { calculateQuotaStatus } from '../../services/quota/src/dynamic-limits.js';
import {
  getProviderAdapter,
  getRegisteredProviders,
  reconcileAdapterResponse,
} from '../../services/quota/src/provider-adapters.js';
import {
  RetryClassifier,
  classify429Dimension,
  parseRetryAfterMs,
} from '../../services/quota/src/retry-classifier.js';
import {
  getFreeInferenceMetrics,
  resetFreeInferenceMetrics,
} from '../../services/quota/src/free-inference-metrics.js';
import {
  StreamingPolicy,
  generateStreamIdempotencyKey,
  streamHeaders,
} from '../../services/router/src/streaming/streaming-policy.js';

describe('Task 1: reserve→dispatch→reconcile', () => {
  it('reserves atomically, commits on success, releases on failure', async () => {
    const svc = new QuotaService();
    svc.configureCapacityStore(
      new InMemoryCapacityStore([
        { unit: 'requests', scopeId: 'key-1', remaining: 2 },
        { unit: 'concurrency', scopeId: 'key-1', remaining: 2 },
      ]),
    );
    svc.registerQuotaVector(
      buildVector({
        providerId: 'groq',
        modelId: 'm',
        keyId: 'key-1',
        dimensions: [
          buildDimension({ unit: 'requests', scope: 'key', scopeId: 'key-1', limit: 2, remaining: 2, state: 'available' }),
          buildDimension({ unit: 'concurrency', scope: 'key', scopeId: 'key-1', limit: 2, remaining: 2, state: 'available' }),
        ],
      }),
    );

    const ok = await svc.dispatchWithReservation(
      'groq', 'm', 'key-1',
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 },
      async () => 'done',
      () => ({ requests: 1, inputTokens: 5, outputTokens: 5, concurrency: 1 }),
    );
    expect(ok).toBe('done');
    expect(svc.getCapacityManager().getReservationCount()).toBe(0);

    await expect(
      svc.dispatchWithReservation('groq', 'm', 'key-1', {}, async () => {
        throw new Error('provider boom');
      }),
    ).rejects.toThrow('provider boom');
    expect(svc.getCapacityManager().getReservationCount()).toBe(0);
  });
});

describe('Task 2: fail-closed quota status', () => {
  it('fail-open (default) treats unknown as 100% available', () => {
    const s = calculateQuotaStatus({ keyId: 'k', providerId: 'groq', headers: {} });
    expect(s.isExhausted).toBe(false);
    expect(s.percentRemaining).toBe(100);
  });

  it('failClosed treats unknown and stale as exhausted', () => {
    const unknown = calculateQuotaStatus({ keyId: 'k', providerId: 'groq', headers: {}, failClosed: true });
    expect(unknown.isExhausted).toBe(true);
    expect(unknown.percentRemaining).toBe(0);

    const stale = calculateQuotaStatus({
      keyId: 'k', providerId: 'groq',
      headers: { requestsRemaining: 10, requestsLimit: 100 },
      failClosed: true, isStale: true,
    });
    expect(stale.isExhausted).toBe(true);

    const known = calculateQuotaStatus({
      keyId: 'k', providerId: 'groq',
      headers: { requestsRemaining: 10, requestsLimit: 100 },
      failClosed: true,
    });
    expect(known.isExhausted).toBe(false);
  });
});

describe('Task 4: adapters reconcile quota', () => {
  it('every registered adapter exposes a reconcile path invoking onUsage', () => {
    for (const providerId of getRegisteredProviders()) {
      const adapter = getProviderAdapter(providerId);
      expect(typeof adapter.parseHeaders).toBe('function');
      expect(typeof adapter.reconcileResponse).toBe('function');
    }
    expect(typeof getProviderAdapter('nope-unknown').reconcileResponse).toBe('function');
  });

  it('reconcileAdapterResponse parses headers and calls onUsage', () => {
    const adapter = getProviderAdapter('groq');
    let observed = -1;
    const dims = reconcileAdapterResponse(adapter, {
      headers: { 'x-ratelimit-limit-requests': '30', 'x-ratelimit-remaining-requests': '29' },
      scopeInfo: { keyId: 'k', modelId: 'm' },
      promptTokens: 100,
      completionTokens: 50,
      onUsage: (tokens) => { observed = tokens; },
    });
    expect(dims.length).toBeGreaterThan(0);
    expect(observed).toBe(150);
  });
});

describe('Task 5: retry classifier', () => {
  it('classifies 429 dimensions from messages', () => {
    expect(classify429Dimension({ message: 'tokens per minute exceeded' })).toBe('TPM');
    expect(classify429Dimension({ message: 'Limit 30000 tokens per day' })).toBe('TPD');
    expect(classify429Dimension({ message: 'requests per minute' })).toBe('RPM');
    expect(classify429Dimension({ message: 'requests per day quota' })).toBe('RPD');
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' })).toBe(2000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfterMs({ 'retry-after': future });
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeGreaterThan(0);
    expect(parseRetryAfterMs({})).toBeNull();
  });

  it('honors Retry-After and bounds budgets', () => {
    const classifier = new RetryClassifier({ maxRetries: 1, windowMs: 60_000 });
    const first = classifier.classify({
      status: 429, message: 'rpm exceeded',
      headers: { 'retry-after': '1' }, providerId: 'groq', modelId: 'm',
    });
    expect(first.retryable).toBe(true);
    expect(first.dimension).toBe('RPM');
    expect(first.retryAfterHonored).toBe(true);

    const second = classifier.classify({
      status: 429, message: 'rpm exceeded', headers: {},
      providerId: 'groq', modelId: 'm',
    });
    expect(second.budgetAllowed).toBe(false);

    const nonRetryable = classifier.classify({ status: 400, providerId: 'groq' });
    expect(nonRetryable.retryable).toBe(false);
  });
});

describe('Task 7: metrics counters', () => {
  beforeEach(() => resetFreeInferenceMetrics());

  it('tracks reservations and stays zero for violations', async () => {
    const svc = new QuotaService();
    svc.configureCapacityStore(
      new InMemoryCapacityStore([{ unit: 'requests', scopeId: 'k', remaining: 1 }]),
    );
    svc.registerQuotaVector(
      buildVector({
        providerId: 'p', modelId: 'm', keyId: 'k',
        dimensions: [
          buildDimension({ unit: 'requests', scope: 'key', scopeId: 'k', limit: 1, remaining: 1, state: 'available' }),
        ],
      }),
    );
    await svc.reserveForDispatch('p', 'm', 'k', {});
    const snap = getFreeInferenceMetrics();
    expect(snap.reservationsAttempted).toBe(1);
    expect(snap.reservationsSucceeded).toBe(1);
    expect(snap.freeOnlyViolations).toBe(0);
  });
});

describe('Task 8: streaming replay safety', () => {
  it('pre-token disconnects replay with the same idempotency key; partial output never replays', () => {
    const policy = new StreamingPolicy();
    const key = generateStreamIdempotencyKey();
    expect(key.startsWith('stream_')).toBe(true);

    const headers = streamHeaders({}, { requestId: 'req-1' });
    expect(headers['x-request-id']).toBe('req-1');
    expect(headers['idempotency-key']).toMatch(/^stream_/);

    const safe = policy.shouldReplayWithIdempotency({
      requestId: 'req-1', idempotencyKey: key, bytesReceived: 0, ttftMs: null,
    });
    expect(safe.replay).toBe(true);
    expect(safe.idempotencyKey).toBe(key);
    expect(policy.isDuplicateIdempotencyKey(key)).toBe(true);

    const unsafe = policy.shouldReplayWithIdempotency({
      requestId: 'req-1', idempotencyKey: key, bytesReceived: 1024, ttftMs: 400,
    });
    expect(unsafe.replay).toBe(false);
  });
});
