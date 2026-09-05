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
  // 429 is usually transient (upstream throttling window), so a SHORT cooldown
  // keeps the model out of the next few picks without locking it out for long.
  'rate_limit': 2 * 60_000,           // 2 minutes
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
  /**
   * Global timeout in ms for the entire fallback chain. When the timer fires
   * the request fails fast with ProviderUnavailableError instead of walking
   * every dead candidate sequentially. Default 12_000 (12s). Set 0 to disable.
   */
  globalTimeoutMs?: number;
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
 * Shared failure bookkeeping for a failed provider/model step: 429 → penalty +
 * escalating cooldown + usage(0); 402 → 24h payment cooldown; 403 → 24h
 * forbidden cooldown; 529/530 → 5m overload cooldown.
 *
 * Used by BOTH the sequential fallback loop and the parallel-probe rejection
 * path. Before this helper existed, a step probed concurrently that lost the
 * race to a sibling only got its model error tracked — never a penalty or
 * cooldown — so it was re-selected hot on the next request even though it had
 * 429'd/402'd moments earlier.
 */
async function applyFailurePenalties(
  rls: RateLimitService | undefined,
  providerId: string,
  modelId: string,
  error: unknown,
): Promise<void> {
  // On 429, add penalty and record usage
  if (rls && isRateLimitError(error)) {
    rls.addPenalty(providerId, modelId);
    // Escalating cooldown (2m -> 10m -> 1h -> 24h) so a repeatedly 429'd
    // provider/model backs off progressively instead of being retried hot.
    rls.recordRateLimitHit?.(providerId, modelId);
    // Self-correcting limits: parse the provider's reported ceiling from the
    // error message and push it into the live config (only ever lowers).
    try {
      rls.learnLimitFromError?.(providerId, modelId, error instanceof Error ? error : { message: String(error) });
    } catch (learnErr) {
      logger.warn({ err: learnErr, provider: providerId }, 'Failed to learn limit from error');
    }
    try {
      await rls.recordUsage(providerId, modelId, 0);
    } catch (usageErr) {
      logger.warn({ err: usageErr, provider: providerId }, 'Failed to record rate limit usage');
    }
  }
  // On 402 (Payment Required), apply 24h cooldown — model needs credit to work
  if (rls && isPaymentRequiredError(error)) {
    rls.setPaymentRequiredCooldown(providerId, modelId);
    logger.warn(
      { provider: providerId, modelId: modelId },
      'Payment required (402) on fallback — applying 24h cooldown'
    );
  }
  // On 403 (Forbidden), apply 24h cooldown — model is not accessible
  if (rls && isForbiddenError(error)) {
    rls.setModelForbiddenCooldown(providerId, modelId);
    logger.warn(
      { provider: providerId, modelId: modelId },
      'Model forbidden (403) on fallback — applying 24h cooldown'
    );
  }
  // On 529/530 (Provider Overloaded), apply 5-minute cooldown
  if (rls && isProviderOverloadedError(error)) {
    rls.setCooldown(providerId, modelId, 5 * 60_000);
    logger.warn(
      { provider: providerId, statusCode: error instanceof ProviderError ? error.statusCode : 'unknown' },
      'Provider overloaded — applying 5-minute cooldown'
    );
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

  // Global timeout: bound the entire fallback chain so a string of slow-failing
  // providers can't stall the request past the client's patience. When the
  // timer fires we fail fast with ProviderUnavailableError (retryable) instead
  // of walking every dead candidate sequentially.
  const globalTimeoutMs = options?.globalTimeoutMs ?? 12_000;
  const globalDeadline = globalTimeoutMs > 0 ? Date.now() + globalTimeoutMs : 0;

  // Pool health check: if the vast majority of candidates are on cooldown,
  // fail fast instead of probing them one by one. This turns a 30s sequential
  // walk into a 1-2s fast-fail when the pool is genuinely unhealthy.
  const totalChainLength = 1 + plan.chain.length; // primary + fallbacks
  const deadChainMembers = plan.chain.filter(step =>
    isModelOnErrorCooldown(step.provider.providerId, step.provider.modelId)
  ).length;
  const primaryDead = isModelOnErrorCooldown(plan.primary.providerId, plan.primary.modelId) ? 1 : 0;
  const deadRatio = totalChainLength > 0 ? (primaryDead + deadChainMembers) / totalChainLength : 0;
  if (deadRatio >= 0.8 && totalChainLength >= 2) {
    logger.warn(
      { requestId: options?.requestId, deadRatio, totalChainLength },
      'Pool unhealthy: >80% candidates on cooldown — failing fast'
    );
    throw new ProviderUnavailableError(
      [plan.primary.providerId, ...plan.chain.map(s => s.provider.providerId)],
      5000
    );
  }

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
      // Escalating cooldown (2m -> 10m -> 1h -> 24h) so a repeatedly 429'd
      // provider/model backs off progressively instead of being retried hot.
      rls.recordRateLimitHit?.(plan.primary.providerId, plan.primary.modelId);
      // Self-correcting limits: learn the real ceiling from the error message.
      try {
        rls.learnLimitFromError?.(plan.primary.providerId, plan.primary.modelId, error instanceof Error ? error : { message: String(error) });
      } catch (learnErr) {
        logger.warn({ err: learnErr, provider: plan.primary.providerId }, 'Failed to learn limit from error');
      }
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
            // The retry succeeded on a DIFFERENT key than the primary attempt —
            // record it against that key's own free-tier bucket, because
            // provider free tiers are granted per credential and a shared pool
            // would both over-restrict (capped at one key's budget) and mask
            // an exhausted key. keyRotationService.hashKey() gives the same
            // stable per-key identifier used for quota lookups.
            await qs.recordProviderBudgetUsage(
              tenantId,
              plan.primary.providerId,
              tokens,
              options.keyRotationService.hashKey(nextKey)
            );
          }
        } catch (usageErr) {
          logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record usage for key retry');
        }
        return response;
      } catch (keyRetryError) {
        logger.warn({ err: keyRetryError, provider: plan.primary.providerId }, 'Key retry also failed, falling through to cross-provider fallback');
        // The rotated key hit a limit too — learn from it like any other 429.
        if (rls && isRateLimitError(keyRetryError)) {
          try {
            rls.learnLimitFromError?.(plan.primary.providerId, plan.primary.modelId, keyRetryError instanceof Error ? keyRetryError : { message: String(keyRetryError) });
          } catch (learnErr) {
            logger.warn({ err: learnErr, provider: plan.primary.providerId }, 'Failed to learn limit from key retry error');
          }
        }
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
  // `rate_limit` (429) is tracked too: a 429'd model was previously left fully
  // selectable, so the pre-selection filter kept re-picking it until its own
  // rate-limit penalty decayed. Note 429 is model-scoped, NOT provider-wide —
  // another model on the same provider may still answer.
  if (errorCategory === 'model_not_found' || errorCategory === 'auth_error' ||
      errorCategory === 'provider_overloaded' || errorCategory === 'error' ||
      errorCategory === 'rate_limit') {
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
        // Race each probe against the global deadline so a slow provider
        // can't hold back the entire chain past the timeout.
        const remainingMs = globalDeadline > 0 ? Math.max(1, globalDeadline - Date.now()) : 0;
        const execPromise = withConcurrencySlot(step.provider.providerId, () =>
          executor.execute(step.provider.providerId, step.provider.modelId, request)
        );
        const response = remainingMs > 0
          ? await Promise.race([
              execPromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('global timeout')), remainingMs)
              ),
            ])
          : await execPromise;
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
        // Apply the same penalty/cooldown bookkeeping as the sequential loop:
        // a probed step that loses the race to a sibling must still be demoted
        // (429 penalty + escalating cooldown, 402/403/529 cooldowns) — otherwise
        // it is re-selected hot on the next request.
        await applyFailurePenalties(rls, step.provider.providerId, step.provider.modelId, result.reason);
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

      // Global timeout check: if the deadline has passed, fail fast instead
      // of trying another slow provider. This bounds the total fallback chain
      // latency so the client gets a timely error (or a timely success from
      // the parallel probe above) instead of a 30s+ sequential walk.
      if (globalDeadline > 0 && Date.now() >= globalDeadline) {
        logger.warn(
          { requestId: options?.requestId, globalTimeoutMs, tried },
          'Global fallback timeout reached — failing fast'
        );
        throw new ProviderUnavailableError(tried, globalTimeoutMs);
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
      // If this is a global timeout, re-throw immediately — do NOT continue
      // to the next provider. The timeout means we've exhausted our latency
      // budget and the client needs a timely error, not more attempts.
      if (error instanceof ProviderUnavailableError && error.message === 'All providers currently unavailable') {
        throw error;
      }
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
      // On 429/402/403/529, apply the shared penalty + cooldown bookkeeping
      // (429 → penalty + escalating cooldown + usage, 402 → 24h payment
      // cooldown, 403 → 24h forbidden cooldown, 529/530 → 5m overload cooldown).
      await applyFailurePenalties(rls, step.provider.providerId, step.provider.modelId, error);
      // Track model-level errors so we skip them on subsequent attempts.
      // Mirror the primary-provider handling: also track provider_overloaded
      // and generic transient 'error' (not just model_not_found / auth_error)
      // so a dead candidate is skipped instead of retried every turn.
      // `rate_limit` joins the tracked set for the same reason as the primary
      // path — a 429'd fallback model should sit out the cooldown window.
      const fallbackErrorCategory = classifyError(error);
      if (fallbackErrorCategory === 'model_not_found' || fallbackErrorCategory === 'auth_error' ||
          fallbackErrorCategory === 'provider_overloaded' || fallbackErrorCategory === 'error' ||
          fallbackErrorCategory === 'rate_limit') {
        trackModelError(step.provider.providerId, step.provider.modelId, fallbackErrorCategory);
      }
    }
  }

  // Graceful degradation: before failing entirely, try a last-resort model
  // that trades quality for availability. This keeps the request alive when
  // the pool is temporarily unhealthy — better a degraded answer than a 503.
  // Only triggers when we haven't already tried the degraded model.
  const degradedModel = process.env.DMRX_DEGRADED_MODEL;
  if (degradedModel && !tried.some(id => id.includes('degraded'))) {
    try {
      const [degradedProviderId, degradedModelId] = degradedModel.includes('/')
        ? degradedModel.split('/')
        : ['openrouter-free', degradedModel];
      logger.warn(
        { requestId: options?.requestId, degradedModel, degradedProviderId, degradedModelId },
        'All providers failed — attempting graceful degradation'
      );
      const response = await executor.execute(degradedProviderId, degradedModelId, request);
      response.fallback = {
        fromProviderId: plan.primary.providerId,
        fromModelId: plan.primary.modelId,
        attempts: tried.length,
        reason: 'graceful_degradation',
        errors: [...triedErrors, { provider: 'all', message: 'All primary and fallback providers failed; degraded model used' }],
      };
      return response;
    } catch (degradedErr) {
      logger.warn({ requestId: options?.requestId, err: degradedErr }, 'Graceful degradation also failed');
    }
  }

  if (!anyNonRateLimitError && tried.length > 0) {
    throw new ProviderUnavailableError(tried, 5000);
  }
  throw new AllProvidersFailedError(tried, triedErrors);
}

/**
 * Request hedging: fire the top alternate IN PARALLEL once the primary runs
 * past a latency threshold, and take whichever answers first.
 *
 * Scope guards (each one exists because hedging burns real tokens):
 * - Non-streaming LLM requests only. Streaming responses can't be raced
 *   cleanly and diffusion/video/music jobs are too expensive to duplicate.
 * - The hedge target must be a DIFFERENT provider than the primary — racing
 *   the same pool against itself doubles key/quota burn for little gain.
 *   (The chain's same-model-first ordering still applies; we just skip any
 *   same-provider entries.)
 * - Global credit bucket caps how many hedges can fire per minute (default 6)
 *   so a slow upstream period can't fan every request into two calls.
 *
 * The threshold is a fixed delay rather than a measured p95: candidates carry
 * `latencyPercentiles` in the type system but nothing populates them today,
 * and hedging off an invented number would be worse than a blunt constant.
 * Tune with DMRX_HEDGE_DELAY_MS (0 disables), cap with DMRX_HEDGE_MAX_PER_MIN.
 *
 * When the hedge loses the race its result is discarded (the call completes
 * upstream regardless — that waste is inherent to hedging and why the credit
 * bucket exists); when it wins, the abandoned primary attempt is left to finish
 * unobserved and the winner is tagged with `fallback.reason = 'hedge'` so the
 * switch stays visible to callers.
 */

/** Reset hedge bookkeeping. Exported for testing only. */
export function resetHedgeState(): void {
  hedgeWindowStart = 0;
  hedgeCount = 0;
}

let hedgeWindowStart = 0;
let hedgeCount = 0;

function tryAcquireHedgeCredit(maxPerMin: number): boolean {
  const now = Date.now();
  if (now - hedgeWindowStart >= 60_000) {
    hedgeWindowStart = now;
    hedgeCount = 0;
  }
  if (hedgeCount >= maxPerMin) return false;
  hedgeCount += 1;
  return true;
}

interface HedgeConfig {
  enabled: boolean;
  delayMs: number;
  maxPerMinute: number;
}

function getHedgeConfig(): HedgeConfig {
  const delayMs = Number.parseInt(process.env.DMRX_HEDGE_DELAY_MS ?? '', 10);
  const maxPerMinute = Number.parseInt(process.env.DMRX_HEDGE_MAX_PER_MIN ?? '', 10);
  return {
    // DMRX_HEDGE_DELAY_MS=0 disables hedging entirely.
    enabled: Number.isNaN(delayMs) ? true : delayMs > 0,
    delayMs: Number.isNaN(delayMs) ? 5000 : delayMs,
    maxPerMinute: Number.isNaN(maxPerMinute) ? 6 : Math.max(1, maxPerMinute),
  };
}

function selectHedgeStep(
  plan: RoutingPlan,
  rls: RateLimitService | undefined,
): { providerId: string; modelId: string } | null {
  for (const step of plan.chain) {
    if (step.provider.providerId === plan.primary.providerId) continue;
    if (step.waitMs && step.waitMs > 0) continue;
    if (isModelOnErrorCooldown(step.provider.providerId, step.provider.modelId)) continue;
    if (rls) {
      const check = rls.checkLimit(step.provider.providerId, step.provider.modelId, 0);
      if (!check.allowed) continue;
    }
    return { providerId: step.provider.providerId, modelId: step.provider.modelId };
  }
  return null;
}

export async function executeWithHedging(
  plan: RoutingPlan,
  request: UnifiedRequest,
  executor: AdapterExecutor,
  options?: FallbackOptions
): Promise<UnifiedResponse> {
  const hedge = getHedgeConfig();
  const rls = options?.rateLimitService;

  const hedgeable =
    hedge.enabled &&
    !request.stream &&
    (request.modality || 'llm') === 'llm' &&
    plan.chain.length > 0;

  if (!hedgeable) {
    return executeWithFallback(plan, request, executor, options);
  }

  const hedgeStep = selectHedgeStep(plan, rls);
  if (!hedgeStep || !tryAcquireHedgeCredit(hedge.maxPerMinute)) {
    return executeWithFallback(plan, request, executor, options);
  }

  const requestId = options?.requestId || crypto.randomUUID();
  logger.info(
    { primary: `${plan.primary.providerId}:${plan.primary.modelId}`, hedge: `${hedgeStep.providerId}:${hedgeStep.modelId}`, delayMs: hedge.delayMs },
    'Request hedging armed — alternate fires if primary exceeds delay'
  );

  // Primary attempt WITHOUT its chain: if it fails fast (before the hedge even
  // fires) we want the full sequential fallback path, not a race between the
  // chain and a hedge duplicate. Chain-based recovery happens below when the
  // primary attempt itself rejects.
  const primaryOnlyPlan: RoutingPlan = { ...plan, chain: [] };

  type Outcome =
    | { kind: 'primary'; response: UnifiedResponse }
    | { kind: 'primary-failed'; error: unknown }
    | { kind: 'hedge'; response: UnifiedResponse }
    | { kind: 'hedge-failed'; error: unknown };

  let primarySettled = false;

  const primaryAttempt: Promise<Outcome> = executeWithFallback(
    primaryOnlyPlan,
    request,
    executor,
    options,
  ).then(
    (response): Outcome => {
      primarySettled = true;
      return { kind: 'primary', response };
    },
    (error): Outcome => {
      primarySettled = true;
      return { kind: 'primary-failed', error };
    },
  );

  const hedgeAttempt: Promise<Outcome> = (async (): Promise<Outcome> => {
    await new Promise((resolve) => setTimeout(resolve, hedge.delayMs));
    if (primarySettled) {
      // Primary finished inside the threshold — never fire the duplicate.
      return new Promise<Outcome>(() => {}); // never settles; dropped by the race
    }
    logger.info(
      { provider: hedgeStep.providerId, modelId: hedgeStep.modelId },
      'Primary exceeded hedge delay — firing alternate'
    );
    const slotId = `${hedgeStep.providerId}:${requestId}:hedge`;
    if (rls) rls.acquireConcurrencySlot(hedgeStep.providerId, slotId);
    try {
      const response = await executor.execute(hedgeStep.providerId, hedgeStep.modelId, request);
      return { kind: 'hedge', response };
    } catch (error) {
      return { kind: 'hedge-failed', error };
    } finally {
      if (rls) rls.releaseConcurrencySlot(hedgeStep.providerId, slotId);
    }
  })();

  const winner = await Promise.race([primaryAttempt, hedgeAttempt]);

  if (winner.kind === 'primary') {
    return winner.response;
  }

  if (winner.kind === 'primary-failed') {
    // Primary died before the hedge fired (or while racing). Full chain takes
    // over from here; the hedge attempt, if in flight, resolves unobserved and
    // its usage is recorded below via the detached handler.
    void hedgeAttempt.catch(() => {});
    return executeWithFallback(plan, request, executor, options);
  }

  if (winner.kind === 'hedge') {
    // Leave the abandoned primary attempt to finish unobserved; never let its
    // rejection surface as an unhandledRejection.
    void primaryAttempt.catch(() => {});
    try { options?.onSuccess?.(hedgeStep.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
    try {
      if (rls) {
        const tokens = winner.response.usage?.total_tokens || 0;
        await rls.recordUsage(hedgeStep.providerId, hedgeStep.modelId, tokens);
      }
      if (options?.quotaService && options?.tenantId) {
        const tokens = winner.response.usage?.total_tokens || 0;
        await options.quotaService.recordUsage(options.tenantId, hedgeStep.providerId, tokens, 0);
        await options.quotaService.recordProviderBudgetUsage(options.tenantId, hedgeStep.providerId, tokens);
      }
    } catch (usageErr) {
      logger.warn({ err: usageErr, provider: hedgeStep.providerId }, 'Failed to record usage for hedge winner');
    }
    winner.response.fallback = {
      fromProviderId: plan.primary.providerId,
      fromModelId: plan.primary.modelId,
      attempts: 2,
      reason: 'hedge',
      errors: [],
    };
    logger.info(
      { provider: hedgeStep.providerId, modelId: hedgeStep.modelId },
      'Hedge won the race'
    );
    return winner.response;
  }

  // Hedge fired and failed: apply the standard failure bookkeeping so the
  // losing alternate is demoted like any other failed candidate, then let the
  // (already-running) primary outcome decide.
  await applyFailurePenalties(rls, hedgeStep.providerId, hedgeStep.modelId, winner.error);
  trackModelError(hedgeStep.providerId, hedgeStep.modelId, classifyError(winner.error));
  return primaryAttempt.then((outcome) => {
    if (outcome.kind === 'primary') return outcome.response;
    // Primary ALSO failed — hand the whole thing to the sequential chain.
    return executeWithFallback(plan, request, executor, options);
  });
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
