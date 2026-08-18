import type { RoutingPlan, UnifiedRequest, UnifiedResponse, ModelBinding } from '@dmr-x/core';
import { AllProvidersFailedError, ProviderError, ProviderUnavailableError, QuotaExhaustedError } from '@dmr-x/core';
import type { RateLimitService, QuotaService, KeyRotationService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';

// Model error tracking: temporarily skip models that returned 404/410
// TTL: a 404 "model not found" means the model was removed upstream and will
// NOT come back on its own — skipping it for a year (effectively permanent)
// prevents the router from re-selecting a dead model and burning a fallback
// slot every hour. `auth_error` (bad/expired key) may recover, so 24h. Others 5m.
/**
 * How long a provider/model pair stays on cooldown after a failure.
 *
 * These are recovery windows, not verdicts. The cache is in-memory, so a
 * long TTL is effectively permanent for the lifetime of the process, and
 * both of the long ones were reachable from a single transient failure:
 *
 *   model_not_found — was ~1 year. A 404 does not reliably mean "the model
 *     was removed". Measured on Google's free tier, five keys list the same
 *     57 models but only some can actually call a given one, so one unlucky
 *     key 404'd `gemini-2.5-flash` and the model was gone for the process's
 *     whole life even though four other keys served it. Cohere's working
 *     `command-r-plus` was blacklisted for a year the same way. Six hours is
 *     long enough to stop wasting retries on a genuinely dead model and
 *     short enough that a wrong call self-heals.
 *
 *   auth_error — was 24 hours. The usual cause is a mis-set key, and the
 *     usual fix is the operator correcting it within minutes; blinding the
 *     router to that model for a day afterwards turns a two-minute config
 *     error into a day-long outage.
 */
const MODEL_ERROR_TTL: Record<string, number> = {
  'model_not_found': 6 * 60 * 60_000, // 6 hours
  'auth_error': 15 * 60_000,          // 15 minutes
  'provider_overloaded': 5 * 60_000,  // 5 minutes
};
const modelErrorCache = new Map<string, { category: string; expiresAt: number }>();

/**
 * Failure categories that are a property of the *credential*, not the model.
 * A 401 or an exhausted account quota fails identically on every model the
 * provider serves, so cooling one model down leaves the rest to burn fallback
 * slots one at a time. Measured against a dead OpenRouter key: it serves six
 * meta-models, each got tried and cooled separately, and because a request
 * only gets a couple of fallback attempts the router surfaced intermittent
 * "All providers failed" while healthy free candidates sat further down the
 * chain. These categories cool the whole provider instead.
 */
const PROVIDER_WIDE_CATEGORIES = new Set(['auth_error', 'quota', 'insufficient_quota']);
const providerErrorCache = new Map<string, { category: string; expiresAt: number }>();

/** Reset the model error cache. Exported for testing only. */
export function resetModelErrorCache(): void {
  modelErrorCache.clear();
  providerErrorCache.clear();
}

export interface AdapterExecutor {
  execute(
    providerId: string,
    modelId: string,
    request: UnifiedRequest
  ): Promise<UnifiedResponse>;
}

export interface FallbackStepConfig {
  /** Trigger: when to use this fallback */
  trigger: 'error' | 'timeout' | 'rate_limit' | 'context_window' | 'content_policy';
  /** Provider/model to fallback to */
  providerId: string;
  modelId: string;
  /** Delay before trying this fallback (ms) */
  waitMs?: number;
}

export interface FallbackOptions {
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  tenantId?: string;
  requestId?: string;
  onSuccess?: (providerId: string) => void;
  onFailure?: (providerId: string) => void;
  /** Optional configured fallback chain (from config.yaml) */
  configuredFallbacks?: FallbackStepConfig[];
  /** Key rotation service for same-provider key retry */
  keyRotationService?: KeyRotationService;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 429;
  }
  return false;
}

function isPaymentRequiredError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 402;
  }
  return false;
}

function isForbiddenError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 403;
  }
  return false;
}

function isProviderOverloadedError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 529 || error.statusCode === 530;
  }
  return false;
}

function isModelNotFoundError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    // Some adapters surface model-not-found as a plain Error/NotFoundError
    // without a ProviderError wrapper. Catch the well-known Google/OpenAI
    // "The requested resource does not exist" / "model not found" phrasing
    // so broken model IDs get evicted from the candidate pool instead of
    // being retried on every turn (which exhausts the fallback chain and
    // makes `auto` report "All providers currently unavailable").
    const msg = String((error as any)?.message ?? '').toLowerCase();
    return (
      msg.includes('requested resource does not exist') ||
      msg.includes('model not found') ||
      msg.includes('model_not_found') ||
      msg.includes('model does not exist') ||
      msg.includes('unknown model') ||
      msg.includes('the model') && msg.includes('does not exist')
    );
  }
  if (error.statusCode === 404 || error.statusCode === 410) return true;
  if (error.statusCode === 400) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('model not found') ||
      msg.includes('model_not_found') ||
      msg.includes('model not supported') ||
      msg.includes('model_required') ||
      msg.includes('unknown model') ||
      msg.includes('model does not exist') ||
      msg.includes('requested resource does not exist')
    );
  }
  return false;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 401;
  }
  return false;
}

function isInsufficientQuotaError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient quota') ||
    msg.includes('quota_exhausted') ||
    msg.includes('out of credits') ||
    msg.includes('payment_required') ||
    // Billing exhaustion is phrased differently by every gateway, and each
    // phrasing below was observed on this deployment failing EVERY model the
    // provider serves. Classifying them as generic 'error' cooled one model
    // at a time, so a provider with no balance burned a fallback slot per
    // model and surfaced "All providers failed" while payable candidates sat
    // further down the chain:
    //   gitlawb      -> "Insufficient credits — top up your balance at ..."
    //   opencode-zen -> "No payment method. Add a payment method here: ..."
    //   tokenrouter  -> "User's credit limit is insufficient, remaining ..."
    msg.includes('insufficient credits') ||
    msg.includes('no payment method') ||
    msg.includes('credit limit is insufficient') ||
    msg.includes('top up your balance') ||
    msg.includes('add a payment method')
  );
}

function isQuotaError(error: unknown): boolean {
  return error instanceof QuotaExhaustedError;
}

/**
 * Failures that LOOK permanent but were observed to succeed on an immediate
 * retry of the same provider+model.
 *
 * Deliberately narrow. A 400 usually means the request really is malformed and
 * retrying is waste — so this only matches the two generic phrasings seen
 * flapping on this deployment, and explicitly defers to the specific
 * classifiers first: a context-window overflow, a content-policy block or a
 * model-not-found 400 is a real verdict and must NOT be retried, because the
 * second attempt would fail identically.
 */
function isAmbiguousTransientError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (isContextWindowError(error) || isContentPolicyError(error) || isModelNotFoundError(error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  // "200 with empty content" — the upstream accepted the request and returned
  // a well-formed but empty completion. Never a property of the request.
  if (msg.includes('empty content') || msg.includes('empty_output') || msg.includes('without a usable completion')) {
    return true;
  }
  // Generic, detail-free 400. A provider that genuinely dislikes the payload
  // says which field; this phrasing carries no field at all and flaps.
  if (error.statusCode === 400 && msg.includes('invalid request parameters')) {
    return true;
  }
  return false;
}

/**
 * Detect context-window errors (input too long).
 * Providers return 400/413/422 with messages about context length, max tokens, etc.
 */
function isContextWindowError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.statusCode !== 400 && error.statusCode !== 413 && error.statusCode !== 422) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('context_length') ||
    msg.includes('context window') ||
    msg.includes('maximum context') ||
    msg.includes('token limit') ||
    msg.includes('too many tokens') ||
    msg.includes('input is too long') ||
    msg.includes('max_tokens') ||
    msg.includes('request too large') ||
    msg.includes('payload too large')
  );
}

/**
 * Detect content-policy / moderation errors.
 * Providers return 400/422 with messages about content filtering.
 */
function isContentPolicyError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.statusCode !== 400 && error.statusCode !== 422) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('content_policy') ||
    msg.includes('content policy') ||
    msg.includes('safety') ||
    msg.includes('blocked') ||
    msg.includes('content filter') ||
    msg.includes('moderation') ||
    msg.includes('flagged') ||
    msg.includes('harmful') ||
    msg.includes('violates')
  );
}

/**
 * Determine the error category for fallback routing.
 */
function classifyError(error: unknown): 'rate_limit' | 'context_window' | 'content_policy' | 'quota' | 'model_not_found' | 'auth_error' | 'provider_overloaded' | 'insufficient_quota' | 'error' {
  if (isRateLimitError(error)) return 'rate_limit';
  if (isContextWindowError(error)) return 'context_window';
  if (isContentPolicyError(error)) return 'content_policy';
  if (isQuotaError(error)) return 'quota';
  if (isModelNotFoundError(error)) return 'model_not_found';
  if (isAuthError(error)) return 'auth_error';
  if (isProviderOverloadedError(error)) return 'provider_overloaded';
  if (isInsufficientQuotaError(error)) return 'insufficient_quota';
  return 'error';
}

function trackModelError(providerId: string, modelId: string, category: string): void {
  const ttl = MODEL_ERROR_TTL[category] || 5 * 60_000;
  const key = `${providerId}:${modelId}`;
  modelErrorCache.set(key, { category, expiresAt: Date.now() + ttl });
  logger.warn({ providerId, modelId, category, ttl }, 'Tracked model error — will skip for cooldown period');

  if (PROVIDER_WIDE_CATEGORIES.has(category)) {
    providerErrorCache.set(providerId, { category, expiresAt: Date.now() + ttl });
    logger.warn({ providerId, category, ttl }, 'Tracked provider-wide error — skipping every model on this provider for the cooldown period');
  }
}

/**
 * Whether a provider/model is currently on an error cooldown (404/410, bad
 * auth, overload). Exported so callers that build chain-less plans — notably
 * the sticky-session fast path — can avoid re-calling a model already known
 * to be dead, which would otherwise fail with no fallback available.
 */
export function isModelOnErrorCooldown(providerId: string, modelId: string): boolean {
  const providerEntry = providerErrorCache.get(providerId);
  if (providerEntry) {
    if (Date.now() > providerEntry.expiresAt) {
      providerErrorCache.delete(providerId);
    } else {
      return true;
    }
  }

  const key = `${providerId}:${modelId}`;
  const entry = modelErrorCache.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    modelErrorCache.delete(key);
    return false;
  }
  return true;
}

export async function executeWithFallback(
  plan: RoutingPlan,
  request: UnifiedRequest,
  executor: AdapterExecutor,
  options?: FallbackOptions
): Promise<UnifiedResponse> {
  const tried: string[] = [];
  const triedErrors: { provider: string; status?: number; message: string }[] = [];

  // Capture a per-provider error for root-cause surfacing (F-4).
  function recordTriedError(providerId: string, error: unknown): void {
    if (triedErrors.some((e) => e.provider === providerId)) return;
    if (error instanceof ProviderError) {
      triedErrors.push({ provider: providerId, status: error.statusCode, message: error.message });
    } else if (error instanceof Error) {
      triedErrors.push({ provider: providerId, message: error.message });
    } else {
      triedErrors.push({ provider: providerId, message: String(error) });
    }
  }
  const rls = options?.rateLimitService;
  const qs = options?.quotaService;
  const tenantId = options?.tenantId;
  let anyNonRateLimitError = false;
  let primaryErrorRaw: unknown = null;
  const requestId = options?.requestId || crypto.randomUUID();

  // Helper: acquire concurrency slot for a provider, release on completion via finally
  async function withConcurrencySlot<T>(
    providerId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const slotId = `${providerId}:${requestId}`;
    if (rls) {
      rls.acquireConcurrencySlot(providerId, slotId);
    }
    try {
      return await fn();
    } finally {
      if (rls) {
        rls.releaseConcurrencySlot(providerId, slotId);
      }
    }
  }

  // Try primary
  try {
    // Check rate limit before executing
    if (rls) {
      const limitCheck = rls.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
      if (!limitCheck.allowed) {
        logger.info({ provider: plan.primary.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Primary provider rate-limited, skipping');
        tried.push(plan.primary.providerId);
        throw new Error(`Rate limited: ${limitCheck.reason}`);
      }
    }

    // Check quota before executing
    if (qs && tenantId) {
      await qs.checkQuota(tenantId, plan.primary.providerId, 0, 0);
    }
    tried.push(plan.primary.providerId);
    // Some upstreams intermittently reject a request they will accept on the
    // very next attempt. Measured on this deployment: the SAME google model,
    // the same trivial prompt, six serial attempts -> FAIL/OK/OK/OK/FAIL/FAIL,
    // alternating between HTTP 400 "Invalid request parameters" and "HTTP 200
    // with empty content". Both look like hard, request-shaped errors, so the
    // model was cooled down and the caller got a 502 for a model that works.
    // One immediate in-place retry converts that class of flake into a success
    // without consuming a cross-provider fallback slot.
    const response = await withConcurrencySlot(plan.primary.providerId, async () => {
      try {
        return await executor.execute(plan.primary.providerId, plan.primary.modelId, request);
      } catch (err) {
        if (!isAmbiguousTransientError(err)) throw err;
        logger.warn(
          { provider: plan.primary.providerId, modelId: plan.primary.modelId, err },
          'Primary provider returned an ambiguous transient failure — retrying the same model once'
        );
        return await executor.execute(plan.primary.providerId, plan.primary.modelId, request);
      }
    });
    // Record circuit breaker success (wrapped in try/catch)
    try { options?.onSuccess?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
    // Record successful usage (fire-and-forget, never fail the request)
    try {
      if (rls) {
        const tokens = response.usage?.total_tokens || 0;
        await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, tokens);
      }
      if (qs && tenantId) {
        const tokens = response.usage?.total_tokens || 0;
        await qs.recordUsage(tenantId, plan.primary.providerId, tokens, 0);
        await qs.recordProviderBudgetUsage(tenantId, plan.primary.providerId, tokens);
      }
    } catch (usageErr) {
      logger.warn({ err: usageErr, provider: plan.primary.providerId, requestId: options?.requestId }, 'Failed to record usage for primary provider');
    }
    return response;
  } catch (error) {
    primaryErrorRaw = error;
    recordTriedError(plan.primary.providerId, error);
    // Record circuit breaker failure (wrapped in try/catch to prevent callback errors from breaking fallback chain)
    try { options?.onFailure?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
    if (!isRateLimitError(error)) {
      anyNonRateLimitError = true;
    }
    if (isQuotaError(error)) {
      logger.warn({ provider: plan.primary.providerId, requestId: options?.requestId }, 'Primary provider quota exhausted');
    } else {
      logger.warn({ err: error, provider: plan.primary.providerId, requestId: options?.requestId }, 'Primary provider failed');
    }
    // On 429, add penalty and record usage
    if (rls && isRateLimitError(error)) {
      rls.addPenalty(plan.primary.providerId, plan.primary.modelId);
      try {
        await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, 0);
      } catch (usageErr) {
        logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record rate limit usage');
      }
    }
    // On 402 (Payment Required), apply 24h cooldown — model needs credit to work
    if (rls && isPaymentRequiredError(error)) {
      rls.setPaymentRequiredCooldown(plan.primary.providerId, plan.primary.modelId);
      logger.warn(
        { provider: plan.primary.providerId, modelId: plan.primary.modelId },
        'Payment required (402) — applying 24h cooldown'
      );
    }
    // On 403 (Forbidden), apply 24h cooldown — model is not accessible
    if (rls && isForbiddenError(error)) {
      rls.setModelForbiddenCooldown(plan.primary.providerId, plan.primary.modelId);
      logger.warn(
        { provider: plan.primary.providerId, modelId: plan.primary.modelId },
        'Model forbidden (403) — applying 24h cooldown'
      );
    }
    // On 529/530 (Provider Overloaded), apply 5-minute cooldown
    if (rls && isProviderOverloadedError(error)) {
      rls.setCooldown(plan.primary.providerId, plan.primary.modelId, 5 * 60_000);
      logger.warn(
        { provider: plan.primary.providerId, statusCode: error instanceof ProviderError ? error.statusCode : 'unknown' },
        'Provider overloaded — applying 5-minute cooldown'
      );
    }
  }

  // Same-provider key retry: if primary failed with rate limit, try next key on same provider
  if (isRateLimitError(primaryErrorRaw) && options?.keyRotationService) {
    const nextKey = options.keyRotationService.getNextKey(plan.primary.providerId, plan.primary.modelId);
    if (nextKey) {
      try {
        logger.info({ provider: plan.primary.providerId }, 'Trying next key on same provider');
        const response = await withConcurrencySlot(plan.primary.providerId, () =>
          executor.execute(plan.primary.providerId, plan.primary.modelId, request)
        );
        try { options?.onSuccess?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
        try {
          if (rls) {
            const tokens = response.usage?.total_tokens || 0;
            await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, tokens);
          }
          if (qs && tenantId) {
            const tokens = response.usage?.total_tokens || 0;
            await qs.recordUsage(tenantId, plan.primary.providerId, tokens, 0);
            await qs.recordProviderBudgetUsage(tenantId, plan.primary.providerId, tokens);
          }
        } catch (usageErr) {
          logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record usage for key retry');
        }
        return response;
      } catch (keyRetryError) {
        logger.warn({ err: keyRetryError, provider: plan.primary.providerId }, 'Key retry also failed, falling through to cross-provider fallback');
        try { options?.onFailure?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
      }
    }
  }

  // Classify the primary error for smart fallback selection
  const errorCategory = classifyError(primaryErrorRaw);
  // Track model-level errors so we skip them on subsequent attempts.
  // Previously only model_not_found / auth_error were tracked; a provider
  // returning a generic transient error (5xx, timeout, connection reset — e.g.
  // a temporarily dead candidate like gemini-2.5-flash) was retried on EVERY
  // turn, burning a fallback slot and surfacing "All providers failed" even
  // when healthy candidates existed. Now we also track provider_overloaded and
  // generic 'error' with a short cooldown (default 5m) so the meta-router
  // self-heals by skipping the dead candidate instead of re-hitting it.
  if (errorCategory === 'model_not_found' || errorCategory === 'auth_error' ||
      errorCategory === 'provider_overloaded' || errorCategory === 'error') {
    trackModelError(plan.primary.providerId, plan.primary.modelId, errorCategory);
  }

  // Try configured fallbacks first (from config.yaml), then built-in chain
  const configuredSteps = options?.configuredFallbacks || [];
  const allFallbackSteps = [
    // Configured fallbacks filtered by error category
    ...configuredSteps
      .filter(f => f.trigger === errorCategory || f.trigger === 'error')
      .map(f => ({
        provider: { providerId: f.providerId, modelId: f.modelId, adapterType: '', score: 0 },
        trigger: f.trigger as any,
        waitMs: f.waitMs || 0,
      })),
    // Built-in fallback chain
    ...plan.chain,
  ];

  // Deduplicate by providerId:modelId
  const seen = new Set<string>();
  const deduplicated = allFallbackSteps.filter(step => {
    const key = `${step.provider.providerId}:${step.provider.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Parallel probe: race the first N immediate (waitMs=0) fallbacks concurrently.
  // Cuts fallback latency from ~Nx to ~1x when the leading candidates are dead.
  // On failure, errors are tracked so the main loop skips them.
  // Raised 2 → 3 to match the wider chain (see buildFallbackChain maxFallbacks):
  // with one upstream dominating the top scores, racing only 2 meant both probes
  // routinely hit the SAME dead provider.
  const immediateSteps = deduplicated.filter(s => !s.waitMs || s.waitMs === 0).slice(0, 3);
  if (immediateSteps.length > 1) {
    const probePromises = immediateSteps.map(step =>
      (async (): Promise<{ step: typeof immediateSteps[0]; response: UnifiedResponse }> => {
        if (isModelOnErrorCooldown(step.provider.providerId, step.provider.modelId)) {
          throw new Error('on cooldown');
        }
        if (rls) {
          const limitCheck = rls.checkLimit(step.provider.providerId, step.provider.modelId, 0);
          if (!limitCheck.allowed) throw new Error('rate-limited');
        }
        if (qs && tenantId) {
          await qs.checkQuota(tenantId, step.provider.providerId, 0, 0);
        }
        tried.push(step.provider.providerId);
        const response = await withConcurrencySlot(step.provider.providerId, () =>
          executor.execute(step.provider.providerId, step.provider.modelId, request)
        );
        return { step, response };
      })()
    );

    const results = await Promise.allSettled(probePromises);
    let winner: { step: typeof immediateSteps[0]; response: UnifiedResponse } | null = null;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && !winner) {
        winner = result.value;
      } else if (result.status === 'rejected') {
        const step = immediateSteps[i];
        const category = classifyError(result.reason);
        trackModelError(step.provider.providerId, step.provider.modelId, category);
        recordTriedError(step.provider.providerId, result.reason);
      }
    }

    if (winner) {
      try { options?.onSuccess?.(winner.step.provider.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
      try {
        if (rls) {
          const tokens = winner.response.usage?.total_tokens || 0;
          await rls.recordUsage(winner.step.provider.providerId, winner.step.provider.modelId, tokens);
        }
        if (qs && tenantId) {
          const tokens = winner.response.usage?.total_tokens || 0;
          await qs.recordUsage(tenantId, winner.step.provider.providerId, tokens, 0);
          await qs.recordProviderBudgetUsage(tenantId, winner.step.provider.providerId, tokens);
        }
      } catch (usageErr) {
        logger.warn({ err: usageErr, provider: winner.step.provider.providerId }, 'Failed to record usage for parallel fallback');
      }
      winner.response.fallback = {
        fromProviderId: plan.primary.providerId,
        fromModelId: plan.primary.modelId,
        attempts: tried.length,
        reason: errorCategory,
        errors: [...triedErrors],
      };
      return winner.response;
    }
  }

  for (const step of deduplicated) {
    try {
      // Skip models on error cooldown (deprecated, auth errors, etc.)
      if (isModelOnErrorCooldown(step.provider.providerId, step.provider.modelId)) {
        logger.info({ provider: step.provider.providerId, model: step.provider.modelId }, 'Skipping model on error cooldown');
        continue;
      }

      // Re-check rate limit before executing fallback
      if (rls) {
        const limitCheck = rls.checkLimit(step.provider.providerId, step.provider.modelId, 0);
        if (!limitCheck.allowed) {
          logger.info({ provider: step.provider.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Fallback provider rate-limited, skipping');
          continue;
        }
      }

      if (step.waitMs && step.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs));
      }

      // Check quota before executing fallback
      if (qs && tenantId) {
        await qs.checkQuota(tenantId, step.provider.providerId, 0, 0);
      }
      tried.push(step.provider.providerId);
      const response = await withConcurrencySlot(step.provider.providerId, () =>
        executor.execute(step.provider.providerId, step.provider.modelId, request)
      );
      // Record circuit breaker success (wrapped in try/catch)
      try { options?.onSuccess?.(step.provider.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
      // Record successful usage (fire-and-forget, never fail the request)
      try {
        if (rls) {
          const tokens = response.usage?.total_tokens || 0;
          await rls.recordUsage(step.provider.providerId, step.provider.modelId, tokens);
        }
        if (qs && tenantId) {
          const tokens = response.usage?.total_tokens || 0;
          await qs.recordUsage(tenantId, step.provider.providerId, tokens, 0);
          await qs.recordProviderBudgetUsage(tenantId, step.provider.providerId, tokens);
        }
      } catch (usageErr) {
        logger.warn({ err: usageErr, provider: step.provider.providerId, requestId: options?.requestId }, 'Failed to record usage for fallback provider');
      }
      logger.info(
        { provider: step.provider.providerId, modelId: step.provider.modelId, errorCategory, trigger: step.trigger },
        'Fallback succeeded'
      );
      // Tell the caller this was not the model they were first routed to.
      // Without it the switch is invisible: a different model answers, with
      // different latency and cost, and nothing in the response says so.
      response.fallback = {
        fromProviderId: plan.primary.providerId,
        fromModelId: plan.primary.modelId,
        attempts: tried.length,
        reason: errorCategory,
        errors: [...triedErrors],
      };
      return response;
    } catch (error) {
      // Record circuit breaker failure (wrapped in try/catch)
      try { options?.onFailure?.(step.provider.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
      recordTriedError(step.provider.providerId, error);
      if (!isRateLimitError(error)) {
        anyNonRateLimitError = true;
      }
      if (isQuotaError(error)) {
        logger.warn({ provider: step.provider.providerId, requestId: options?.requestId }, 'Fallback provider quota exhausted');
      } else {
        logger.warn(
          { err: error, provider: step.provider.providerId, requestId: options?.requestId },
          'Fallback provider failed'
        );
      }
      // On 429, add penalty and record usage
      if (rls && isRateLimitError(error)) {
        rls.addPenalty(step.provider.providerId, step.provider.modelId);
        try {
          await rls.recordUsage(step.provider.providerId, step.provider.modelId, 0);
        } catch (usageErr) {
          logger.warn({ err: usageErr, provider: step.provider.providerId }, 'Failed to record rate limit usage');
        }
      }
      // On 402 (Payment Required), apply 24h cooldown — model needs credit to work
      if (rls && isPaymentRequiredError(error)) {
        rls.setPaymentRequiredCooldown(step.provider.providerId, step.provider.modelId);
        logger.warn(
          { provider: step.provider.providerId, modelId: step.provider.modelId },
          'Payment required (402) on fallback — applying 24h cooldown'
        );
      }
      // On 403 (Forbidden), apply 24h cooldown — model is not accessible
      if (rls && isForbiddenError(error)) {
        rls.setModelForbiddenCooldown(step.provider.providerId, step.provider.modelId);
        logger.warn(
          { provider: step.provider.providerId, modelId: step.provider.modelId },
          'Model forbidden (403) on fallback — applying 24h cooldown'
        );
      }
      // On 529/530 (Provider Overloaded), apply 5-minute cooldown
      if (rls && isProviderOverloadedError(error)) {
        rls.setCooldown(step.provider.providerId, step.provider.modelId, 5 * 60_000);
        logger.warn(
          { provider: step.provider.providerId, statusCode: error instanceof ProviderError ? error.statusCode : 'unknown' },
          'Provider overloaded — applying 5-minute cooldown'
        );
      }
      // Track model-level errors so we skip them on subsequent attempts.
      // Mirror the primary-provider handling: also track provider_overloaded
      // and generic transient 'error' (not just model_not_found / auth_error)
      // so a dead candidate is skipped instead of retried every turn.
      const fallbackErrorCategory = classifyError(error);
      if (fallbackErrorCategory === 'model_not_found' || fallbackErrorCategory === 'auth_error' ||
          fallbackErrorCategory === 'provider_overloaded' || fallbackErrorCategory === 'error') {
        trackModelError(step.provider.providerId, step.provider.modelId, fallbackErrorCategory);
      }
    }
  }

  if (!anyNonRateLimitError && tried.length > 0) {
    throw new ProviderUnavailableError(tried, 5000);
  }
  throw new AllProvidersFailedError(tried, triedErrors);
}

/**
 * Execute a request with cross-binding multi-binding failover support.
 *
 * Tries each binding (primary + fallbacks) in order. For each binding,
 * the standard fallback chain is attempted. When all retries on the
 * current binding are exhausted and crossBindingFailover is enabled,
 * the next binding is tried instead of failing immediately.
 */
export async function executeWithMultiBindingFallback(
  plan: RoutingPlan,
  request: UnifiedRequest,
  executor: AdapterExecutor,
  bindings: ModelBinding | undefined,
  options?: FallbackOptions,
): Promise<UnifiedResponse> {
  // No multi-binding config — delegate to standard fallback
  if (!bindings || !bindings.crossBindingFailover) {
    return executeWithFallback(plan, request, executor, options);
  }

  const allBindings = [bindings.primary, ...bindings.fallbacks];
  const triedProviders: string[] = [];

  for (const entry of allBindings) {
    const bindingPlan: RoutingPlan = {
      ...plan,
      primary: {
        ...plan.primary,
        providerId: entry.providerId,
        modelId: entry.modelId,
      },
    };

    try {
      return await executeWithFallback(bindingPlan, request, executor, {
        ...options,
        onFailure: (providerId: string) => {
          triedProviders.push(providerId);
          options?.onFailure?.(providerId);
        },
      });
    } catch (error) {
      logger.warn(
        { providerId: entry.providerId, modelId: entry.modelId },
        'Binding exhausted, trying next binding',
      );
    }
  }

  logger.error(
    { bindingsTried: triedProviders },
    'All bindings exhausted, no more fallbacks available',
  );
  throw new AllProvidersFailedError(triedProviders);
}
