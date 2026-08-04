import type { TokenUsage } from '@dmr-x/core';

/**
 * Normalizes prompt-cache token accounting across provider wire formats.
 *
 * Providers disagree on what "prompt tokens" means when a cache is involved:
 *
 *  - Anthropic reports `input_tokens` as the *uncached remainder*. The full
 *    prompt is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 *    Reading `input_tokens` alone under-reports a cached request by the size of
 *    the cached prefix — which is exactly the part we want to be large.
 *  - OpenAI reports `prompt_tokens` as the full prompt, with the cached portion
 *    broken out in `prompt_tokens_details.cached_tokens` as a subset.
 *  - Gemini reports `promptTokenCount` as the full prompt, with
 *    `cachedContentTokenCount` as a subset.
 *
 * `TokenUsage.prompt_tokens` is normalized to the OpenAI meaning — full prompt,
 * cache components as subsets — so cost math is uniform across providers.
 */

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Anthropic Messages API usage.
 *
 * `input_tokens` is the uncached remainder, so the cache components are added
 * back in to produce a full prompt count.
 */
export function normalizeAnthropicUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const uncached = num(u.input_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  const completion = num(u.output_tokens);
  const prompt = uncached + cacheRead + cacheWrite;

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cacheRead > 0 ? { cache_read_tokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cache_write_tokens: cacheWrite } : {}),
  };
}

/**
 * OpenAI chat/completions usage. `prompt_tokens` already includes the cached
 * portion, so it is used as-is and the cached count is recorded as a subset.
 *
 * OpenAI's automatic prefix caching has no write premium and no write counter,
 * so `cache_write_tokens` is left unset rather than guessed.
 */
export function normalizeOpenAIUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cacheRead = num(details.cached_tokens);

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: num(u.total_tokens) || prompt + completion,
    ...(cacheRead > 0 ? { cache_read_tokens: cacheRead } : {}),
  };
}

/** Gemini `usageMetadata`. `promptTokenCount` already includes cached content. */
export function normalizeGeminiUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const prompt = num(u.promptTokenCount);
  const completion = num(u.candidatesTokenCount);
  const cacheRead = num(u.cachedContentTokenCount);

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: num(u.totalTokenCount) || prompt + completion,
    ...(cacheRead > 0 ? { cache_read_tokens: cacheRead } : {}),
  };
}

export interface CacheAwarePricing {
  inputPricePerToken: number;
  outputPricePerToken: number;
  /** Falls back to 0.1x input — the rate Anthropic, OpenAI and Gemini all charge. */
  cacheReadPricePerToken?: number | null;
  /** Falls back to 1.25x input, the 5-minute-TTL write premium. */
  cacheWritePricePerToken?: number | null;
}

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Cost for a request, charging cached tokens at their own rates.
 *
 * Billing cached reads at full input price overstates the cost of exactly the
 * requests caching is meant to make cheap, which would then feed a wrong signal
 * into cost-based routing.
 */
export function computeCachedCost(usage: TokenUsage, pricing: CacheAwarePricing): number {
  const cacheRead = usage.cache_read_tokens ?? 0;
  const cacheWrite = usage.cache_write_tokens ?? 0;
  const fullPriceTokens = Math.max(0, usage.prompt_tokens - cacheRead - cacheWrite);

  const readRate = pricing.cacheReadPricePerToken ?? pricing.inputPricePerToken * CACHE_READ_MULTIPLIER;
  const writeRate =
    pricing.cacheWritePricePerToken ?? pricing.inputPricePerToken * CACHE_WRITE_MULTIPLIER;

  return (
    fullPriceTokens * pricing.inputPricePerToken +
    cacheRead * readRate +
    cacheWrite * writeRate +
    usage.completion_tokens * pricing.outputPricePerToken
  );
}

/**
 * What the same request would have cost with no cache, for reporting savings.
 * Returns 0 when nothing was cached.
 */
export function computeCacheSavings(usage: TokenUsage, pricing: CacheAwarePricing): number {
  const cacheRead = usage.cache_read_tokens ?? 0;
  if (cacheRead === 0) return 0;
  const readRate = pricing.cacheReadPricePerToken ?? pricing.inputPricePerToken * CACHE_READ_MULTIPLIER;
  return cacheRead * (pricing.inputPricePerToken - readRate);
}
