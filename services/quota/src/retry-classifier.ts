/**
 * Retry classifier — Issue #16 Task 5.
 *
 * Classifies 429s by quota dimension (RPM/TPM/RPD/TPD), honors `Retry-After`
 * headers (seconds or HTTP-date), and bounds retry budgets per scope so a
 * hot free-tier bucket cannot spin forever.
 */

import {
  inc429Avoided,
  incRetryAfterHonors,
} from './free-inference-metrics.js';

export type RetryDimension = 'RPM' | 'TPM' | 'RPD' | 'TPD' | 'unknown';

export interface RetryClassification {
  retryable: boolean;
  dimension: RetryDimension;
  retryAfterMs: number | null;
  retryAfterHonored: boolean;
  budgetAllowed: boolean;
  remainingRetries: number;
  reason: string;
}

export interface RetryClassifierConfig {
  maxRetries: number;
  windowMs: number;
  defaultRetryAfterMs?: number;
}

const DEFAULT_CONFIG: RetryClassifierConfig = {
  maxRetries: 3,
  windowMs: 60_000,
  defaultRetryAfterMs: 5_000,
};

/**
 * Classify a 429 dimension from message/header hints.
 * Header hints win (remaining==0 on a specific axis); otherwise parse the
 * provider message for tokens/day, tokens/min, requests/day, requests/min.
 */
export function classify429Dimension(input: {
  message?: string;
  headers?: Record<string, string>;
}): RetryDimension {
  const headers = input.headers ?? {};
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  // Header-axis hints: an axis with remaining==0 is the exhausted dimension.
  const reqRem = lower['x-ratelimit-remaining-requests'];
  const tokRem = lower['x-ratelimit-remaining-tokens'];
  const reqDayRem = lower['x-ratelimit-remaining-requests-day'];
  const tokDayRem = lower['x-ratelimit-remaining-tokens-day'];
  if (reqDayRem !== undefined && Number(reqDayRem) <= 0) return 'RPD';
  if (tokDayRem !== undefined && Number(tokDayRem) <= 0) return 'TPD';
  if (reqRem !== undefined && Number(reqRem) <= 0) {
    // Disambiguate minute vs day via limit header names when present.
    if (lower['x-ratelimit-limit-requests-day'] !== undefined && reqDayRem === undefined) return 'RPD';
    return 'RPM';
  }
  if (tokRem !== undefined && Number(tokRem) <= 0) {
    if (lower['x-ratelimit-limit-tokens-day'] !== undefined && tokDayRem === undefined) return 'TPD';
    return 'TPM';
  }

  const message = input.message ?? '';
  const patterns: Array<{ dimension: RetryDimension; re: RegExp }> = [
    { dimension: 'TPD', re: /tokens?\s*per\s*day|\btpd\b/i },
    { dimension: 'TPM', re: /tokens?\s*per\s*min(?:ute)?|\btpm\b/i },
    { dimension: 'RPD', re: /requests?\s*per\s*day|\brpd\b/i },
    { dimension: 'RPM', re: /requests?\s*per\s*min(?:ute)?|\brpm\b/i },
  ];
  for (const { dimension, re } of patterns) {
    if (re.test(message)) return dimension;
  }
  if (/token/i.test(message)) return 'TPM';
  if (/request/i.test(message)) return 'RPM';
  return 'unknown';
}

/**
 * Parse a `Retry-After` header value (seconds or HTTP-date) into ms.
 * Returns null when absent/invalid. `nowMs` is injectable for tests.
 */
export function parseRetryAfterMs(
  headers: Record<string, string> | Headers | undefined | null,
  nowMs: number = Date.now(),
): number | null {
  if (!headers) return null;
  let raw: string | null = null;
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('retry-after') ?? (headers as Headers).get('Retry-After');
  } else {
    const h = headers as Record<string, string>;
    raw = h['retry-after'] ?? h['Retry-After'] ?? h['RETRY-AFTER'] ?? null;
  }
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;

  const seconds = Number(text);
  if (Number.isFinite(seconds) && text.match(/^-?\d+(\.\d+)?$/)) {
    if (seconds < 0) return null;
    return Math.round(seconds * 1000);
  }
  const dateMs = new Date(text).getTime();
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }
  return null;
}

export class RetryClassifier {
  private readonly config: RetryClassifierConfig;
  private attempts = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();

  constructor(config: Partial<RetryClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private scopeKey(providerId: string, modelId?: string, dimension?: string): string {
    return `${providerId}:${modelId ?? '*'}:${dimension ?? '*'}`;
  }

  private prune(key: string, now: number): number[] {
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < this.config.windowMs);
    this.attempts.set(key, recent);
    return recent;
  }

  canRetry(providerId: string, modelId?: string, dimension?: string, now = Date.now()): boolean {
    const blocked = this.blockedUntil.get(this.scopeKey(providerId, modelId, dimension));
    if (blocked !== undefined && now < blocked) return false;
    return this.prune(this.scopeKey(providerId, modelId), now).length < this.config.maxRetries;
  }

  getRemaining(providerId: string, modelId?: string, now = Date.now()): number {
    const recent = this.prune(this.scopeKey(providerId, modelId), now);
    return Math.max(0, this.config.maxRetries - recent.length);
  }

  recordAttempt(providerId: string, modelId?: string, now = Date.now()): void {
    const key = this.scopeKey(providerId, modelId);
    const recent = this.prune(key, now);
    recent.push(now);
    this.attempts.set(key, recent);
  }

  /**
   * Classify a 429/error response: dimension, Retry-After honor, budget.
   * Non-429 statuses are non-retryable (except 529/530 overload → retryable).
   */
  classify(input: {
    status?: number;
    message?: string;
    headers?: Record<string, string> | Headers;
    providerId: string;
    modelId?: string;
    nowMs?: number;
  }): RetryClassification {
    const now = input.nowMs ?? Date.now();
    const status = input.status ?? 0;
    const is429 = status === 429;
    const isOverload = status === 529 || status === 530;

    if (!is429 && !isOverload) {
      return {
        retryable: false,
        dimension: 'unknown',
        retryAfterMs: null,
        retryAfterHonored: false,
        budgetAllowed: false,
        remainingRetries: this.getRemaining(input.providerId, input.modelId, now),
        reason: `Status ${status} is not retryable`,
      };
    }

    const headerRecord: Record<string, string> =
      input.headers instanceof Headers
        ? Object.fromEntries((input.headers as Headers).entries() as Iterable<[string, string]>)
        : ((input.headers as Record<string, string>) ?? {});
    const dimension = is429
      ? classify429Dimension({ message: input.message, headers: headerRecord })
      : 'unknown';

    const retryAfterMs = parseRetryAfterMs(input.headers ?? {}, now);
    const retryAfterHonored = retryAfterMs !== null;

    // Budget check FIRST (based on prior attempts/blocks): the current retry
    // is allowed if prior history permits. The Retry-After block below then
    // constrains *subsequent* retries — not the one being classified.
    const budgetAllowed = this.canRetry(input.providerId, input.modelId, dimension, now);
    if (retryAfterHonored) {
      incRetryAfterHonors();
      // Bound the wait: honor the provider value but clamp runaway dates.
      const clamped = Math.min(retryAfterMs!, 5 * 60_000);
      const scope = this.scopeKey(input.providerId, input.modelId, dimension);
      this.blockedUntil.set(scope, now + clamped);
    } else if (is429) {
      // No Retry-After: derive a conservative wait per dimension.
      const fallback =
        dimension === 'RPD' || dimension === 'TPD'
          ? 60_000
          : (this.config.defaultRetryAfterMs ?? DEFAULT_CONFIG.defaultRetryAfterMs!);
      const scope = this.scopeKey(input.providerId, input.modelId, dimension);
      this.blockedUntil.set(scope, now + fallback);
    }

    if (budgetAllowed) {
      this.recordAttempt(input.providerId, input.modelId, now);
    } else {
      inc429Avoided();
    }

    return {
      retryable: budgetAllowed,
      dimension,
      retryAfterMs,
      retryAfterHonored,
      budgetAllowed,
      remainingRetries: this.getRemaining(input.providerId, input.modelId, now),
      reason: isOverload
        ? 'Provider overloaded; bounded retry'
        : `429 on ${dimension}${retryAfterHonored ? `; honoring Retry-After ${retryAfterMs}ms` : ''}`,
    };
  }

  reset(): void {
    this.attempts.clear();
    this.blockedUntil.clear();
  }
}
