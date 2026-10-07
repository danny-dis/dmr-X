/**
 * Authoritative inference accounting seams (FreeLLM integration).
 *
 * The quota core owns admission + settlement (`quotaService.beginInferenceAttempt`)
 * and the gateway/router must drive it around EVERY upstream dispatch:
 *
 *   begin  →  upstream execute  →  settle(actual usage + canonical per-1k cost)
 *                    └→ on a failed / pre-output attempt: release()
 *
 * Two seams live here, both LLM-only (non-LLM modalities keep their existing
 * behaviour — paid multimodal scalar billing is out of scope for this task):
 *
 * - {@link wrapAccountedExecutor} wraps the router's adapter executor ONCE so
 *   the sticky path, the composite/worker-pool path and the fallback chain all
 *   dispatch through the same accounted executor and none of them can bypass
 *   the lease. A `WeakSet` of accounted executors lets `fallback-executor`
 *   skip its legacy `quotaService.recordUsage(..., 0)` +
 *   `recordProviderBudgetUsage` (a second debit for the same tokens) while
 *   leaving every UNWRAPPED executor (legacy direct-executor unit tests,
 *   fake quota classes without a `beginInferenceAttempt` method) untouched.
 *
 * - {@link accountedLLMStream} wraps the chat streaming `executeStream` call:
 *   the factory is NOT opened until `begin` succeeds, the lease stays active
 *   for the whole iterator lifetime (including a yielded `done` chunk), and it
 *   settles exactly once at EOF / iterator `return()`.
 *
 * Nothing here falls back to unaccounted execution once a real boundary is
 * attached: a rejected `begin` fails the attempt (no dispatch), and a rejected
 * `settle` is surfaced as {@link InferenceSettlementError} so callers never
 * re-dispatch a provider that already produced a result.
 */
import type { StreamChunk, TokenUsage, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

import type { AdapterExecutor } from './fallback/fallback-executor.js';

// ---------------------------------------------------------------------------
// Boundary contract (implemented by services/quota QuotaService)
// ---------------------------------------------------------------------------

export interface InferenceAttemptLease {
  /** Settle the dispatched attempt with the ACTUAL measured usage. */
  settle(response: UnifiedResponse): Promise<void>;
  /** Abandon the reservation without debiting (failed / pre-output attempt). */
  release(): Promise<void>;
}

export interface InferenceAttemptOptions {
  requestId?: string;
  /** Trusted server-side agent reservation owns the tenant debit already. */
  externalAccounting?: boolean;
  keyId?: string;
}

export interface InferenceAccountingBoundary {
  beginInferenceAttempt(
    tenantId: string | undefined,
    providerId: string,
    modelId: string,
    request: UnifiedRequest,
    options?: InferenceAttemptOptions,
  ): Promise<InferenceAttemptLease>;
}

/** Structural check: a legacy/fake quota class simply has no `begin`. */
export function supportsInferenceAccounting(boundary: unknown): boundary is InferenceAccountingBoundary {
  return (
    typeof (boundary as InferenceAccountingBoundary | undefined)?.beginInferenceAttempt === 'function'
  );
}

/** The helper is LLM-only; every other modality keeps its legacy path. */
export function isLLMRequest(request: Pick<UnifiedRequest, 'modality'> | undefined): boolean {
  return (request?.modality ?? 'llm') === 'llm';
}

function requestMetadata(request: UnifiedRequest | undefined): Record<string, unknown> {
  const metadata = (request as { metadata?: unknown } | undefined)?.metadata;
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

function stringMetadata(request: UnifiedRequest | undefined, key: string): string | undefined {
  const value = requestMetadata(request)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function tenantIdOf(request: UnifiedRequest | undefined): string | undefined {
  const tenant = requestMetadata(request).tenant as { id?: unknown } | undefined;
  return tenant && typeof tenant.id === 'string' ? tenant.id : undefined;
}

// ---------------------------------------------------------------------------
// Errors — tagged with a registry symbol so the tag survives module duplication
// (vitest can load the gateway and the router through different specifiers).
// ---------------------------------------------------------------------------

const SETTLEMENT_TAG = Symbol.for('dmrx.inference.settlement_error');
const ADMISSION_TAG = Symbol.for('dmrx.inference.admission_error');

/**
 * A dispatch SUCCEEDED upstream but the lease could not be settled. Callers
 * must never treat this as a provider failure: no failover, no second provider,
 * no penalty/cooldown against a healthy provider.
 */
export class InferenceSettlementError extends Error {
  readonly [SETTLEMENT_TAG] = true;
  readonly cause: unknown;

  constructor(cause: unknown, phase: 'settle' | 'release' = 'settle') {
    super(`inference lease ${phase} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'InferenceSettlementError';
    this.cause = cause;
  }
}

/**
 * Admission (`begin`) rejected the attempt BEFORE dispatch. Not a provider
 * failure: no penalty, no cooldown, no circuit-breaker failure — exactly like
 * the local admission rejections the fallback already models.
 */
export class InferenceAdmissionError extends Error {
  readonly [ADMISSION_TAG] = true;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`inference admission rejected: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'InferenceAdmissionError';
    this.cause = cause;
  }
}

export function isInferenceSettlementError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[SETTLEMENT_TAG] === true;
}

export function isInferenceAdmissionError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[ADMISSION_TAG] === true;
}

// ---------------------------------------------------------------------------
// Trusted external accounting marker
//
// A server-side agent run that ALREADY holds an owning reservation
// (`reserveAgentRun` → `settleAgentRun`) must not be debited a second time for
// the inference it drives, but it still consumes provider capacity — so the
// marker only flips `options.externalAccounting` on `begin`, never the
// capacity/admission half.
//
// The marker is a MODULE-PRIVATE Symbol stored as an enumerable own property
// of `request.metadata`:
//   - JSON (and therefore any client body/header) cannot carry symbol keys, so
//     `{ metadata: { externalAccounting: true } }` from a client is inert;
//   - enumerable so the two known request spreads
//     (`{ ...unifiedRequest, signal }` / the gateway's outbound
//     `{ ...request, model }`) copy it forward;
//   - double-checked against WeakSets of the objects THIS process stamped, so
//     a rebuilt metadata bag that merely carried the symbol is still refused.
// Marking is owned by `apps/gateway/src/lib/agent-admission.ts`.
// ---------------------------------------------------------------------------

const EXTERNAL_ACCOUNTING = Symbol('dmrx.inference.externalAccounting');
const stampedMetadata = new WeakSet<object>();
const stampedRequests = new WeakSet<object>();

/** Server-side only: grant the trusted external-accounting marker. */
export function markTrustedExternalAccounting(request: UnifiedRequest | undefined | null): boolean {
  if (!request || typeof request !== 'object') return false;
  let metadata = (request as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') {
    metadata = {};
    (request as { metadata?: unknown }).metadata = metadata;
  }
  const bag = metadata as Record<symbol, unknown>;
  bag[EXTERNAL_ACCOUNTING] = true;
  stampedMetadata.add(metadata as object);
  stampedRequests.add(request);
  return true;
}

/** True only for requests THIS process marked (never for string metadata). */
export function isTrustedExternalAccounting(request: UnifiedRequest | undefined | null): boolean {
  if (!request || typeof request !== 'object') return false;
  const metadata = (request as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if ((metadata as Record<symbol, unknown>)[EXTERNAL_ACCOUNTING] !== true) return false;
  // Symbol present: it can only have been written by markTrustedExternalAccounting,
  // but require our own stamp as well so a metadata bag rebuilt from a marked
  // source object cannot mint trust on its own.
  return stampedMetadata.has(metadata) || stampedRequests.has(request);
}

// ---------------------------------------------------------------------------
// Accounted executor
// ---------------------------------------------------------------------------

const accountedExecutors = new WeakSet<object>();

/** The executor carries canonical accounting — skip the legacy tenant debit. */
export function isAccountedExecutor(executor: unknown): boolean {
  return typeof executor === 'object' && executor !== null && accountedExecutors.has(executor);
}

export interface AccountedExecutorOptions {
  /** Resolved ONCE at wrap time so marking and dispatch can never disagree. */
  getBoundary: () => unknown;
  /** Tenant derivation override (defaults to `request.metadata.tenant.id`). */
  getTenantId?: (request: UnifiedRequest) => string | undefined;
}

/**
 * Wrap an adapter executor with an inference lease, ONE layer deep.
 *
 * - Non-LLM modalities and boundaries without a real `beginInferenceAttempt`
 *   (fake/legacy quota classes, quota-less deployments) pass straight through,
 *   are NOT registered as accounted, and therefore keep the legacy
 *   `recordUsage` bookkeeping in the fallback executor.
 * - With a real boundary the executor registers itself in `accountedExecutors`
 *   BEFORE dispatch, so the fallback's post-response legacy debit is skipped.
 * - `begin` rejecting fails the attempt closed: the upstream is never called,
 *   and there is no silent fall-through to unaccounted execution.
 * - `settle` rejecting after a successful dispatch throws
 *   {@link InferenceSettlementError} (no swallow, no second provider).
 */
export function wrapAccountedExecutor(
  executor: AdapterExecutor,
  options: AccountedExecutorOptions,
): AdapterExecutor {
  if (isAccountedExecutor(executor)) return executor; // wrap ONE time

  const boundary = options.getBoundary();
  const active = supportsInferenceAccounting(boundary);
  const liveBoundary = boundary as InferenceAccountingBoundary;

  const wrapper: AdapterExecutor = {
    async execute(providerId: string, modelId: string, request: UnifiedRequest): Promise<UnifiedResponse> {
      if (!active || !isLLMRequest(request)) {
        return executor.execute(providerId, modelId, request);
      }

      const lease = await beginOrThrow(liveBoundary, {
        tenantId: options.getTenantId ? options.getTenantId(request) : tenantIdOf(request),
        providerId,
        modelId,
        request,
      });

      let response: UnifiedResponse;
      try {
        response = await executor.execute(providerId, modelId, request);
      } catch (dispatchError) {
        // The dispatch itself failed, so the reservation is given back. A
        // failed release must NOT mask the provider error — that error is what
        // the fallback chain needs to choose its next candidate — so it is
        // logged (the quota core bounds an un-released hold by its TTL) and the
        // original dispatch error is rethrown.
        try {
          await lease.release();
        } catch (releaseError) {
          logger.warn(
            { err: releaseError, providerId, modelId },
            'inference lease release failed after a failed dispatch',
          );
        }
        throw dispatchError;
      }
      // Post-dispatch: settle may reject — surface it, never swallow it.
      await settleOrThrow(lease, 'settle', response);
      return response;
    },
  };

  if (active) accountedExecutors.add(wrapper);
  return wrapper;
}

async function beginOrThrow(
  boundary: InferenceAccountingBoundary,
  args: { tenantId: string | undefined; providerId: string; modelId: string; request: UnifiedRequest },
): Promise<InferenceAttemptLease> {
  try {
    return await boundary.beginInferenceAttempt(args.tenantId, args.providerId, args.modelId, args.request, {
      requestId: stringMetadata(args.request, 'requestId'),
      externalAccounting: isTrustedExternalAccounting(args.request),
      keyId: stringMetadata(args.request, 'apiKeyId'),
    });
  } catch (error) {
    if (isInferenceSettlementError(error) || isInferenceAdmissionError(error)) throw error;
    throw new InferenceAdmissionError(error);
  }
}

async function settleOrThrow(
  lease: InferenceAttemptLease,
  phase: 'settle' | 'release',
  response?: UnifiedResponse,
): Promise<void> {
  try {
    if (phase === 'release') await lease.release();
    else await lease.settle(response!);
  } catch (error) {
    logger.warn({ err: error, phase }, 'inference lease settlement failed');
    throw phase === 'release' ? error : new InferenceSettlementError(error, phase);
  }
}

// ---------------------------------------------------------------------------
// Accounted streaming helper
// ---------------------------------------------------------------------------

export interface AccountedStreamOptions {
  /** Live quota boundary (`server.quotaService`); absent = legacy pass-through. */
  boundary?: unknown;
  request: UnifiedRequest;
  providerId: string;
  modelId: string;
  tenantId?: string;
  requestId?: string;
  /** Kept for the caller's abort path; the factory closes its own iterator. */
  signal?: AbortSignal;
  /** Opens the upstream iterator ONLY after `begin` has succeeded. */
  factory: () => AsyncIterable<StreamChunk> | Promise<AsyncIterable<StreamChunk>>;
}

export type AccountedStream = AsyncIterable<StreamChunk> & {
  /** True when this stream carries a canonical inference lease. */
  readonly accounted: boolean;
};

interface StreamAccountingState {
  sawDone: boolean;
  usage?: TokenUsage;
  content: string[];
  toolCallFrames: number;
}

/**
 * LLM-only accounted stream. The lease is taken before the factory runs, held
 * across every yielded chunk (including `done`), and finalised exactly once in
 * the generator's `finally` — which covers natural EOF, a thrown upstream
 * error, and a consumer `return()` after the terminal chunk.
 *
 * Finalisation rules:
 *   - upstream failed / aborted BEFORE any output → `release()` (no refund of
 *     an attempt that never produced anything);
 *   - anything that already produced output (including a `done` frame) →
 *     `settle()` with the authoritative `done` usage when present, otherwise a
 *     conservative response with NO `usage` (core estimates) — a dispatched
 *     generation is never refunded;
 *   - an upstream error is never replaced by a settlement error;
 *   - a settlement error on an otherwise successful stream is rethrown as
 *     {@link InferenceSettlementError} so callers must not fail over.
 */
export function accountedLLMStream(options: AccountedStreamOptions): AccountedStream {
  const accounted = supportsInferenceAccounting(options.boundary) && isLLMRequest(options.request);
  const iterable: AsyncIterable<StreamChunk> = {
    [Symbol.asyncIterator]: () => runAccountedStream(options, accounted)[Symbol.asyncIterator](),
  };
  return Object.assign(iterable, { accounted });
}

async function* runAccountedStream(
  options: AccountedStreamOptions,
  accounted: boolean,
): AsyncGenerator<StreamChunk> {
  if (!accounted) {
    const source = await options.factory();
    yield* source;
    return;
  }

  const boundary = options.boundary as InferenceAccountingBoundary;
  const startedAt = Date.now();
  // begin BEFORE the factory: a denied reservation must never open the upstream.
  const lease = await beginOrThrow(boundary, {
    tenantId: options.tenantId ?? tenantIdOf(options.request),
    providerId: options.providerId,
    modelId: options.modelId,
    request: options.request,
  });

  const state: StreamAccountingState = { sawDone: false, content: [], toolCallFrames: 0 };
  let failure: unknown;
  let failed = false;
  let eof = false;
  let finalized = false;
  let finalizeFailed = false;
  let finalizeError: unknown;

  const buildResponse = (): UnifiedResponse => {
    const response: UnifiedResponse = {
      modality: 'llm',
      requestId: options.requestId ?? stringMetadata(options.request, 'requestId') ?? '',
      providerId: options.providerId,
      modelId: options.modelId,
      latencyMs: Date.now() - startedAt,
      message: { role: 'assistant', content: state.content.join('') },
    };
    // Authoritative usage only: a partial/cancelled stream omits `usage` so the
    // core can apply its conservative estimate instead of inventing numbers.
    if (state.sawDone && state.usage) response.usage = state.usage;
    return response;
  };

  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    const producedOutput = state.sawDone || state.content.length > 0 || state.toolCallFrames > 0;
    const preOutput = !producedOutput && (failed || options.signal?.aborted === true);
    try {
      if (preOutput) await lease.release();
      else await lease.settle(buildResponse());
    } catch (error) {
      finalizeFailed = true;
      finalizeError = error;
      // Always logged: the consumer may legally swallow a `return()` rejection.
      logger.warn({ err: error, provider: options.providerId, model: options.modelId }, 'inference lease finalisation failed');
    }
  };

  let sourceIterator: AsyncIterator<StreamChunk> | undefined;
  try {
    const source = await options.factory();
    sourceIterator = source[Symbol.asyncIterator]();
    while (true) {
      const next = await sourceIterator.next();
      if (next.done) {
        eof = true;
        break;
      }
      const chunk = next.value;
      collectStreamChunk(chunk, state);
      yield chunk;
    }
    await finalize();
    if (finalizeFailed) throw new InferenceSettlementError(finalizeError, 'settle');
  } catch (error) {
    failed = true;
    failure = error;
    await finalize(); // never replaces the upstream error (logged above)
    throw failure;
  } finally {
    if (sourceIterator && !eof) {
      try {
        await sourceIterator.return?.();
      } catch {
        /* uncooperative upstream — its own deadline bounds it */
      }
    }
    await finalize();
    // A settlement failure must reach the consumer that is CLOSING the
    // iterator (a `break` after the terminal chunk): `finally` is the only
    // place that can raise it there, and it only fires on an
    // otherwise-successful stream (`!failed`).
    // eslint-disable-next-line no-unsafe-finally
    if (!failed && finalizeFailed) throw new InferenceSettlementError(finalizeError, 'settle');
  }
}

function collectStreamChunk(chunk: StreamChunk | undefined, state: StreamAccountingState): void {
  if (!chunk || typeof chunk.type !== 'string') return;
  if (chunk.type === 'token') {
    const data = chunk.data as { content?: unknown; tool_calls?: unknown[] } | undefined;
    if (typeof data?.content === 'string' && data.content.length > 0) state.content.push(data.content);
    if (Array.isArray(data?.tool_calls) && data.tool_calls.length > 0) state.toolCallFrames += data.tool_calls.length;
  }
  if (chunk.type === 'done') {
    state.sawDone = true;
    const usage = (chunk.data as { usage?: TokenUsage } | undefined)?.usage;
    if (usage && typeof usage === 'object') state.usage = usage;
  }
}
