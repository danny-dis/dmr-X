/**
 * Authoritative inference accounting — cross-boundary integration.
 *
 * Contract under test (services/router/src/inference-accounting.ts):
 *
 *   quotaService.beginInferenceAttempt(tenant, provider, model, request, opts)
 *     -> lease.settle(response) / lease.release()
 *
 *   begin BEFORE upstream execute → settle ACTUAL usage exactly once after a
 *   result → release on a failed / pre-output attempt. A rejected `settle`
 *   after a dispatch that already produced output must never be swallowed and
 *   must never trigger a second provider dispatch.
 *
 * The quota boundary here is a FAKE implementing the exact contract — the real
 * `QuotaService.beginInferenceAttempt` is owned by the quota worker and is
 * TDD'd in its own suite; nothing in this file imports it.
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.js';
import { markAdmittedAgentRequest, preflightModelRun } from '../../apps/gateway/src/lib/agent-admission.js';
import {
  executeWithFallback,
  resetModelErrorCache,
} from '../../services/router/src/fallback/fallback-executor.js';
import {
  accountedLLMStream,
  isAccountedExecutor,
  isInferenceAdmissionError,
  isInferenceSettlementError,
  isTrustedExternalAccounting,
  markTrustedExternalAccounting,
  wrapAccountedExecutor,
} from '../../services/router/src/inference-accounting.js';
import { Router } from '../../services/router/src/router.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface BoundaryOptions {
  /** `begin` rejects → the attempt is denied before any dispatch. */
  deny?: boolean;
  /** `settle` rejects → post-dispatch accounting failure. */
  settleFails?: boolean;
  /** `release` rejects → the reservation could not be given back. */
  releaseFails?: boolean;
}

interface BoundaryFixture {
  boundary: any;
  /** Ordered trace of `begin` / `execute` / `yield-done` / `settle` / `release`. */
  events: string[];
  leases: Array<{ settle: any; release: any }>;
}

/** Quota boundary faking the exact contract the quota worker implements. */
function makeBoundary(options: BoundaryOptions = {}): BoundaryFixture {
  const events: string[] = [];
  const leases: Array<{ settle: any; release: any }> = [];
  const boundary = {
    beginInferenceAttempt: vi.fn(async (_tenantId: unknown, _providerId: unknown, _modelId: unknown, _req: unknown, _opts: unknown) => {
      events.push('begin');
      if (options.deny) throw new Error('tenant budget exhausted');
      const lease = {
        settle: vi.fn(async (_response: unknown) => {
          events.push('settle');
          if (options.settleFails) throw new Error('ledger write failed');
        }),
        release: vi.fn(async () => {
          events.push('release');
          if (options.releaseFails) throw new Error('release failed');
        }),
      };
      leases.push(lease);
      return lease;
    }),
    // Legacy quota surface: a read-only admission check stays, the money
    // debits (`recordUsage` / `recordProviderBudgetUsage`) must NOT run once
    // the dispatch was canonical-accounted.
    checkQuota: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    recordProviderBudgetUsage: vi.fn(async () => undefined),
  };
  return { boundary, events, leases };
}

/** A boundary with NO `beginInferenceAttempt` — legacy / fake quota classes. */
function makeLegacyQuota() {
  return {
    checkQuota: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    recordProviderBudgetUsage: vi.fn(async () => undefined),
  };
}

function makeRequest(overrides: Record<string, unknown> = {}): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'model-a',
    messages: [{ role: 'user', content: 'hi' }],
    metadata: { requestId: 'req-1', tenant: { id: 'tenant-1' } },
    ...overrides,
  } as unknown as UnifiedRequest;
}

function makeResponse(overrides: Record<string, unknown> = {}): UnifiedResponse {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'prov-a',
    modelId: 'model-a',
    latencyMs: 5,
    message: { role: 'assistant', content: 'ok' },
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    ...overrides,
  } as unknown as UnifiedResponse;
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    primary: { providerId: 'prov-a', modelId: 'model-a', adapterType: 'test', score: 1 },
    chain: [
      {
        provider: { providerId: 'prov-b', modelId: 'model-b', adapterType: 'test', score: 0.8 },
        trigger: 'error',
        waitMs: 0,
      },
    ],
    timeoutMs: 30_000,
    maxRetries: 0,
    ...overrides,
  } as any;
}

function makeRawExecutor(execute: (providerId: string, modelId: string, request: UnifiedRequest) => Promise<UnifiedResponse>) {
  return { execute: vi.fn(execute) };
}

/** Drain an async iterable of chunks. */
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

beforeEach(() => {
  resetModelErrorCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Executor seam: begin → execute → settle/release
// ---------------------------------------------------------------------------

describe('accounted executor (begin → execute → settle)', () => {
  it('reserves before dispatch and settles exactly once with the actual usage', async () => {
    const { boundary, events } = makeBoundary();
    const raw = makeRawExecutor(async () => {
      events.push('execute');
      return makeResponse();
    });
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });
    const request = makeRequest();

    const response = await executor.execute('prov-a', 'model-a', request);

    // Reserve strictly precedes the upstream call; settlement follows the result.
    expect(events).toEqual(['begin', 'execute', 'settle']);
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0].slice(0, 4)).toEqual([
      'tenant-1',
      'prov-a',
      'model-a',
      request,
    ]);
    expect(response.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  });

  it('never opens the upstream when the reservation is denied (fails closed, no legacy fallback)', async () => {
    const { boundary } = makeBoundary({ deny: true });
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    const error = await executor.execute('prov-a', 'model-a', makeRequest()).catch((e: unknown) => e);

    expect(isInferenceAdmissionError(error)).toBe(true);
    expect(raw.execute).not.toHaveBeenCalled();
    // No silent fall-through to unaccounted execution: nothing is debited
    // either, because nothing was dispatched.
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    expect(boundary.recordProviderBudgetUsage).not.toHaveBeenCalled();
  });

  it('releases the reservation when the dispatch throws and rethrows the provider error', async () => {
    const { boundary, events, leases } = makeBoundary();
    const raw = makeRawExecutor(async () => {
      events.push('execute');
      throw new Error('provider exploded');
    });
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    const error = await executor.execute('prov-a', 'model-a', makeRequest()).catch((e: unknown) => e);

    expect((error as Error).message).toBe('provider exploded');
    expect(events).toEqual(['begin', 'execute', 'release']);
    expect(leases[0].release).toHaveBeenCalledTimes(1);
    expect(leases[0].settle).not.toHaveBeenCalled();
  });

  it('keeps the provider error even when the release itself fails', async () => {
    const { boundary, leases } = makeBoundary({ releaseFails: true });
    const raw = makeRawExecutor(async () => {
      throw new Error('provider exploded');
    });
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    const error = await executor.execute('prov-a', 'model-a', makeRequest()).catch((e: unknown) => e);

    expect((error as Error).message).toBe('provider exploded');
    expect(leases[0].release).toHaveBeenCalledTimes(1);
    expect(isInferenceSettlementError(error)).toBe(false);
  });

  it('skips non-LLM modalities entirely (LLM-only helper)', async () => {
    const { boundary } = makeBoundary();
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    await executor.execute('prov-a', 'model-a', makeRequest({ modality: 'diffusion' }));

    expect(boundary.beginInferenceAttempt).not.toHaveBeenCalled();
    expect(raw.execute).toHaveBeenCalledTimes(1);
  });

  it('treats a boundary without beginInferenceAttempt as legacy (unaccounted pass-through)', async () => {
    const broken = { ...makeBoundary(), beginInferenceAttempt: undefined };
    const raw = makeRawExecutor(async () => makeResponse());
    // No `beginInferenceAttempt` at all → structurally legacy: pass through.
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => broken });
    await executor.execute('prov-a', 'model-a', makeRequest());
    expect(isAccountedExecutor(executor)).toBe(false);
    expect(raw.execute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Fallback chain: legacy debit skip + no failover after a settlement failure
// ---------------------------------------------------------------------------

describe('executeWithFallback with an accounted executor', () => {
  it('settles once and skips the legacy tenant debit for the same tokens', async () => {
    const { boundary } = makeBoundary();
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    const response = await executeWithFallback(makePlan(), makeRequest(), executor, {
      quotaService: boundary,
      tenantId: 'tenant-1',
      requestId: 'req-1',
    });

    expect(response.providerId).toBe('prov-a');
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.checkQuota).toHaveBeenCalled(); // read-only admission stays
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    expect(boundary.recordProviderBudgetUsage).not.toHaveBeenCalled();
  });

  it('never retries another provider after a post-dispatch settlement failure', async () => {
    const { boundary, leases } = makeBoundary({ settleFails: true });
    const raw = makeRawExecutor(async (providerId) => makeResponse({ providerId }));
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });
    const onFailure = vi.fn();
    const onSuccess = vi.fn();

    const error = await executeWithFallback(makePlan(), makeRequest(), executor, {
      quotaService: boundary,
      tenantId: 'tenant-1',
      requestId: 'req-1',
      onFailure,
      onSuccess,
    }).catch((e: unknown) => e);

    expect(isInferenceSettlementError(error)).toBe(true);
    // Exactly one dispatch: the answered provider, and never the fallback.
    expect(raw.execute).toHaveBeenCalledTimes(1);
    expect(raw.execute.mock.calls[0][0]).toBe('prov-a');
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    // A settlement failure is not a provider fault → no penalty bookkeeping.
    expect(onFailure).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('dispatches nothing at all when the reservation is refused pre-dispatch', async () => {
    const { boundary } = makeBoundary({ deny: true });
    const raw = makeRawExecutor(async (providerId) => makeResponse({ providerId }));
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    const error = await executeWithFallback(makePlan(), makeRequest(), executor, {
      quotaService: boundary,
      tenantId: 'tenant-1',
      requestId: 'req-1',
    }).catch((e: unknown) => e);

    // Denied admission is not a provider failure: no upstream is ever opened,
    // the chain only re-asks for a reservation (never re-dispatches), and the
    // failure is not misreported as a settlement problem.
    expect(error).toBeInstanceOf(Error);
    expect(isInferenceSettlementError(error)).toBe(false);
    expect(raw.execute).not.toHaveBeenCalled();
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(2); // prov-a, prov-b
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    expect(boundary.recordProviderBudgetUsage).not.toHaveBeenCalled();
  });

  it('preserves the legacy tenant debit for unwrapped executors / boundaryless fakes', async () => {
    const legacyQuota = makeLegacyQuota();
    const raw = makeRawExecutor(async () => makeResponse());
    // Fake quota class without `beginInferenceAttempt`: stays unaccounted, so
    // every existing direct-executor unit test keeps its old bookkeeping.
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => legacyQuota });
    expect(isAccountedExecutor(executor)).toBe(false);

    await executeWithFallback(makePlan(), makeRequest(), executor, {
      quotaService: legacyQuota as any,
      tenantId: 'tenant-1',
      requestId: 'req-1',
    });

    expect(legacyQuota.recordUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 7, 0);
    expect(legacyQuota.recordProviderBudgetUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 7);
  });
});

// ---------------------------------------------------------------------------
// 3. Trusted external-accounting marker (client cannot forge it)
// ---------------------------------------------------------------------------

describe('trusted external accounting marker', () => {
  it('ignores a client-supplied string `externalAccounting` metadata key', async () => {
    const { boundary } = makeBoundary();
    const request = makeRequest({ metadata: { requestId: 'req-1', tenant: { id: 'tenant-1' }, externalAccounting: true } });
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    await executor.execute('prov-a', 'model-a', request);

    expect(isTrustedExternalAccounting(request)).toBe(false);
    expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(false);
  });

  it('marks only a server-side trusted request and still reserves capacity', async () => {
    const { boundary } = makeBoundary();
    const request = makeRequest();
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    expect(markTrustedExternalAccounting(request)).toBe(true);
    await executor.execute('prov-a', 'model-a', request);

    // Capacity/admission half still runs — only the tenant debit is skipped
    // (the quota core's job, driven by this flag).
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(true);
    expect(raw.execute).toHaveBeenCalledTimes(1);
  });

  it('survives the known request spread but not a rebuilt metadata bag', () => {
    const request = makeRequest();
    markTrustedExternalAccounting(request);
    expect(isTrustedExternalAccounting({ ...request, model: 'model-b' })).toBe(true);

    // A copy that merely re-hosts the symbol in a fresh bag is NOT trusted.
    const forged = makeRequest();
    const symbols = Object.getOwnPropertySymbols(request.metadata);
    expect(symbols.length).toBeGreaterThan(0);
    (forged.metadata as Record<symbol, unknown>)[symbols[0]] = true;
    expect(isTrustedExternalAccounting(forged)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Router.setAdapterExecutor seam (real Router, all three consumers)
// ---------------------------------------------------------------------------

describe('Router.setAdapterExecutor seam', () => {
  it('wraps ONCE and hands the SAME accounted executor to all three consumers', async () => {
    const { boundary } = makeBoundary();
    const router = new Router({ quotaService: boundary as any });
    const raw = makeRawExecutor(async () => makeResponse());

    router.setAdapterExecutor(raw as any);

    const wrapped = (router as any).adapterExecutor;
    expect(wrapped).not.toBe(raw);
    expect(isAccountedExecutor(wrapped)).toBe(true);
    expect((router as any).workerPool.adapterExecutor).toBe(wrapped);
    expect((router as any).compositeExecutor.adapterExecutor).toBe(wrapped);
    // Raw executor is NOT itself registered — only the wrapper layer is.
    expect(isAccountedExecutor(raw)).toBe(false);
  });

  it('dispatches through the real router with one settlement and no legacy debit', async () => {
    const { boundary, leases } = makeBoundary();
    const router = new Router({ quotaService: boundary as any });
    const raw = makeRawExecutor(async () => makeResponse());
    router.setAdapterExecutor(raw as any);

    const response = await (router as any).executePlan(makePlan(), makeRequest(), 'tenant-1', 'req-1');

    expect(response.providerId).toBe('prov-a');
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0][0]).toBe('tenant-1');
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    expect(boundary.recordProviderBudgetUsage).not.toHaveBeenCalled();
  });

  it('keeps the legacy path untouched when the quota boundary has no begin method', async () => {
    const legacyQuota = makeLegacyQuota();
    const router = new Router({ quotaService: legacyQuota as any });
    const raw = makeRawExecutor(async () => makeResponse());

    router.setAdapterExecutor(raw as any);

    expect(isAccountedExecutor((router as any).adapterExecutor)).toBe(false);
    await (router as any).executePlan(makePlan(), makeRequest(), 'tenant-1', 'req-1');
    expect(legacyQuota.recordUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 7, 0);
    expect(legacyQuota.recordProviderBudgetUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 7);
  });
});

// ---------------------------------------------------------------------------
// 5. Accounted streaming helper: lease lifetime, cancellation, EOF
// ---------------------------------------------------------------------------

describe('accountedLLMStream', () => {
  function tokenChunk(content: string): StreamChunk {
    return { type: 'token', data: { content } } as unknown as StreamChunk;
  }
  function doneChunk(): StreamChunk {
    return {
      type: 'done',
      data: { requestId: 'req-1', modelId: 'model-a', usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    } as unknown as StreamChunk;
  }

  it('holds the lease across the terminal chunk and settles only at EOF', async () => {
    const { boundary, events, leases } = makeBoundary();
    const stream = accountedLLMStream({
      boundary,
      request: makeRequest(),
      providerId: 'prov-a',
      modelId: 'model-a',
      tenantId: 'tenant-1',
      factory: async function* () {
        events.push('open');
        yield tokenChunk('hello');
        events.push('yield-done');
        yield doneChunk();
      },
    });

    expect(stream.accounted).toBe(true);
    const iterator = stream[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    // Factory never opens before the reservation exists.
    expect(events[0]).toBe('begin');
    expect(events[1]).toBe('open');
    expect(leases[0].settle).not.toHaveBeenCalled();

    const terminal = await iterator.next();
    expect((terminal.value as StreamChunk).type).toBe('done');
    // Still held AFTER the terminal chunk: settlement waits for EOF.
    expect(leases[0].settle).not.toHaveBeenCalled();

    const end = await iterator.next();
    expect(end.done).toBe(true);
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    const settled = leases[0].settle.mock.calls[0][0] as UnifiedResponse;
    expect(settled.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
    expect(settled.message).toEqual({ role: 'assistant', content: 'hello' });
    expect(leases[0].release).not.toHaveBeenCalled();
  });

  it('releases when the upstream fails before any output and preserves the error', async () => {
    const { boundary, leases } = makeBoundary();
    const stream = accountedLLMStream({
      boundary,
      request: makeRequest(),
      providerId: 'prov-a',
      modelId: 'model-a',
      tenantId: 'tenant-1',
      // eslint-disable-next-line require-yield -- fails before producing anything
      factory: async function* () {
        throw new Error('upstream refused');
      },
    });

    const error = await collect(stream).catch((e: unknown) => e);

    expect((error as Error).message).toBe('upstream refused');
    expect(isInferenceSettlementError(error)).toBe(false);
    expect(leases[0].release).toHaveBeenCalledTimes(1);
    expect(leases[0].settle).not.toHaveBeenCalled();
  });

  it('settles the partial generation on cancellation (no refund, no usage invented)', async () => {
    const { boundary, leases } = makeBoundary();
    const stream = accountedLLMStream({
      boundary,
      request: makeRequest(),
      providerId: 'prov-a',
      modelId: 'model-a',
      tenantId: 'tenant-1',
      factory: async function* () {
        yield tokenChunk('partial');
        await new Promise(() => {}); // never reaches EOF — consumer walks away
      },
    });

    for await (const _chunk of stream) break;

    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    expect(leases[0].release).not.toHaveBeenCalled();
    const settled = leases[0].settle.mock.calls[0][0] as UnifiedResponse;
    expect(settled.message).toEqual({ role: 'assistant', content: 'partial' });
    // Partial/cancelled: no authoritative `done` usage → omit it so the core
    // applies its conservative estimate instead of inventing numbers.
    expect(settled.usage).toBeUndefined();
  });

  it('surfaces a settlement failure instead of hiding it behind a successful stream', async () => {
    const { boundary, leases } = makeBoundary({ settleFails: true });
    const stream = accountedLLMStream({
      boundary,
      request: makeRequest(),
      providerId: 'prov-a',
      modelId: 'model-a',
      tenantId: 'tenant-1',
      factory: async function* () {
        yield tokenChunk('hello');
        yield doneChunk();
      },
    });

    const error = await collect(stream).catch((e: unknown) => e);

    expect(isInferenceSettlementError(error)).toBe(true);
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
  });

  it('is a pass-through when the quota boundary has no begin method', async () => {
    const legacyQuota = makeLegacyQuota();
    const stream = accountedLLMStream({
      boundary: legacyQuota,
      request: makeRequest(),
      providerId: 'prov-a',
      modelId: 'model-a',
      factory: async function* () {
        yield tokenChunk('legacy');
        yield doneChunk();
      },
    });

    expect(stream.accounted).toBe(false);
    const chunks = await collect(stream);
    expect(chunks).toHaveLength(2);
    expect(legacyQuota.recordUsage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Gateway chat streaming seam (real Fastify route)
// ---------------------------------------------------------------------------

interface StreamHarness {
  attempted: string[];
  response: Awaited<ReturnType<Fastify['inject']>>;
  rateLimitRecordUsage: any;
}

async function streamChat(
  options: {
    boundary?: unknown;
    adapterStream: (signal?: AbortSignal) => AsyncIterable<StreamChunk>;
    body?: Record<string, unknown>;
    tenant?: string;
    withRateLimit?: boolean;
  },
): Promise<StreamHarness> {
  const router = new Router();
  vi.spyOn(router, 'route').mockResolvedValue({
    plan: {
      primary: { providerId: 'prov-a', modelId: 'model-a', adapterType: 'test', score: 1 },
      chain: [
        { provider: { providerId: 'prov-b', modelId: 'model-b', adapterType: 'test', score: 0.8 }, trigger: 'error', waitMs: 0 },
      ],
      timeoutMs: 30_000,
      maxRetries: 1,
    },
  } as never);

  const attempted: string[] = [];
  const rateLimitRecordUsage = vi.fn(async () => undefined);
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    (req as any).tenant = { id: options.tenant ?? 'tenant-1' };
  });
  app.decorate('router', router);
  if (options.boundary !== undefined) app.decorate('quotaService', options.boundary);
  if (options.withRateLimit !== false) {
    app.decorate('rateLimitService', {
      checkLimit: () => ({ allowed: true }),
      recordUsage: rateLimitRecordUsage,
      acquireConcurrencySlot: () => undefined,
      releaseConcurrencySlot: () => undefined,
    });
  }
  app.decorate('getAdapter', (providerId: string) => ({
    executeStream: (_request: unknown, opts?: { signal?: AbortSignal }) => {
      attempted.push(providerId);
      return options.adapterStream(opts?.signal);
    },
  }));
  await app.register(chatRoutes);

  const response = await app.inject({
    method: 'POST',
    url: '/chat/completions',
    payload: {
      model: 'auto',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      ...options.body,
    },
  });
  await app.close();
  return { attempted, response, rateLimitRecordUsage };
}

function okStream(events?: string[]): (signal?: AbortSignal) => AsyncIterable<StreamChunk> {
  return async function* () {
    events?.push('open');
    yield { type: 'token', data: { content: 'streamed answer' } } as unknown as StreamChunk;
    events?.push('yield-done');
    yield {
      type: 'done',
      data: { requestId: 'req-1', modelId: 'model-a', usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } },
    } as unknown as StreamChunk;
  };
}

describe('chat streaming seam (accounted executeStream)', () => {
  it('reserves before opening the upstream, settles at EOF and skips the legacy chat debit', async () => {
    const { boundary, events, leases } = makeBoundary();
    const { attempted, response, rateLimitRecordUsage } = await streamChat({
      boundary,
      adapterStream: okStream(events),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('streamed answer');
    expect(attempted).toEqual(['prov-a']);
    expect(events[0]).toBe('begin');
    expect(events[1]).toBe('open');
    expect(events).toContain('yield-done');
    expect(events.indexOf('yield-done')).toBeLessThan(events.indexOf('settle'));

    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0][0]).toBe('tenant-1');
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    const settled = leases[0].settle.mock.calls[0][0] as UnifiedResponse;
    expect(settled.usage).toEqual({ prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 });
    // OLD chat `recordUsage(..., 0)` must not double the canonical entry.
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    // Reliability bookkeeping is not money — it stays.
    expect(rateLimitRecordUsage).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when the upstream fails before any output (failover still allowed)', async () => {
    const { boundary, leases } = makeBoundary();
    const { attempted, response } = await streamChat({
      boundary,
      // eslint-disable-next-line require-yield -- fails before producing anything
      adapterStream: async function* () {
        throw new Error('upstream refused');
      },
    });

    // Pre-output failure: the walk MAY try the next candidate — but every
    // abandoned attempt must hand its reservation back first.
    expect(attempted).toEqual(['prov-a', 'prov-b']);
    expect(leases).toHaveLength(2);
    for (const lease of leases) {
      expect(lease.release).toHaveBeenCalledTimes(1);
      expect(lease.settle).not.toHaveBeenCalled();
    }
    expect(boundary.recordUsage).not.toHaveBeenCalled();
    expect(response.body).toContain('upstream refused');
  });

  it('never falls over to a second provider when settlement fails after a good stream', async () => {
    const { boundary, leases } = makeBoundary({ settleFails: true });
    const { attempted, response } = await streamChat({
      boundary,
      adapterStream: okStream(),
    });

    // The answered provider is never re-dispatched and prov-b is never tried.
    expect(attempted).toEqual(['prov-a']);
    expect(leases[0].settle).toHaveBeenCalledTimes(1);
    // The client already received the terminal frame: no synthetic failure.
    expect(response.body).toContain('streamed answer');
    expect(response.body).not.toContain('routing_error');
  });

  it('treats a client-supplied metadata.externalAccounting as ordinary billing', async () => {
    const { boundary } = makeBoundary();
    const { response } = await streamChat({
      boundary,
      adapterStream: okStream(),
      body: { metadata: { externalAccounting: true } },
    });

    expect(response.statusCode).toBe(200);
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Agent admission → trusted marker (the only producer of externalAccounting)
// ---------------------------------------------------------------------------

function agentQuota() {
  return {
    checkQuota: vi.fn(async () => undefined),
    reserveAgentRun: vi.fn(async () => ({ ok: true, holdId: 'hold-1' })),
    releaseAgentHold: vi.fn(async () => undefined),
    settleAgentHold: vi.fn(async () => undefined),
  };
}

describe('agent admission marker', () => {
  it('marks the request only when the run owns a reservation', async () => {
    const request = makeRequest();
    const result = await preflightModelRun({
      model: 'prov-a/model-a',
      estimatedTokens: 1000,
      tenantId: 'tenant-1',
      requestId: 'req-1',
      getPricing: async () => ({ providerId: 'prov-a', modelId: 'model-a', inputPricePer1kTokens: 1, outputPricePer1kTokens: 2 }),
      quotaService: agentQuota() as any,
      request,
    });

    expect(result.admitted).toBe(true);
    if (result.admitted) expect(result.holdId).toBe('hold-1');
    expect(isTrustedExternalAccounting(request)).toBe(true);
  });

  it('never marks an admission that reserved nothing (legacy checkQuota-only)', async () => {
    const request = makeRequest();
    const result = await preflightModelRun({
      model: 'prov-a/model-a',
      estimatedTokens: 1000,
      tenantId: 'tenant-1',
      getPricing: async () => ({ providerId: 'prov-a', modelId: 'model-a', inputPricePer1kTokens: 1, outputPricePer1kTokens: 2 }),
      quotaService: { checkQuota: async () => undefined } as any,
      request,
    });

    expect(result.admitted).toBe(true);
    if (result.admitted) expect(result.holdId).toBeUndefined();
    expect(isTrustedExternalAccounting(request)).toBe(false);
  });

  it('markAdmittedAgentRequest is a no-op without a holdId', () => {
    const request = makeRequest();
    expect(markAdmittedAgentRequest(request, undefined)).toBe(false);
    expect(markAdmittedAgentRequest(request, '')).toBe(false);
    expect(isTrustedExternalAccounting(request)).toBe(false);
    expect(markAdmittedAgentRequest(request, 'hold-9')).toBe(true);
    expect(isTrustedExternalAccounting(request)).toBe(true);
  });

  it('a trusted agent run still reserves provider capacity through begin', async () => {
    const { boundary } = makeBoundary();
    const request = makeRequest();
    markAdmittedAgentRequest(request, 'hold-1');
    const raw = makeRawExecutor(async () => makeResponse());
    const executor = wrapAccountedExecutor(raw, { getBoundary: () => boundary });

    await executor.execute('prov-a', 'model-a', request);

    // Capacity/admission half runs; the tenant debit is delegated (flag=true).
    expect(boundary.beginInferenceAttempt).toHaveBeenCalledTimes(1);
    expect(boundary.beginInferenceAttempt.mock.calls[0][4].externalAccounting).toBe(true);
    expect(raw.execute).toHaveBeenCalledTimes(1);
  });
});
