import { createHash } from 'node:crypto';

import { createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Request caching service for identical requests.
 * Provides exact-match caching with configurable TTL per request type.
 * Cache keys are based on request content, not provider - so cached responses
 * persist across provider switches.
 */

const cache = createNamespacedCache('request-cache');

/** Maximum response size to cache (1MB). Larger responses skip caching. */
const MAX_CACHEABLE_BYTES = 1_048_576;

export type RequestType =
  | 'chat'
  | 'embedding'
  | 'image'
  | 'audio_tts'
  | 'audio_stt'
  | 'audio_separation'
  | 'video'
  | '3d'
  | 'ocr'
  | 'rerank'
  | 'moderation'
  | 'other';

export interface CacheEntry {
  response: unknown;
  timestamp: number;
  tokens: number;
}

export interface CacheOptions {
  /** TTL in seconds (defaults vary by request type) */
  ttlSeconds?: number;
  /** Tenant ID for per-tenant isolation */
  tenantId?: string;
  /** Request type for cache key prefix */
  requestType: RequestType;
}

/**
 * Hash large binary fields (base64 audio/image/video) and large text fields
 * (messages) to keep cache keys small.
 */
function hashLargeFields(body: Record<string, unknown>): Record<string, unknown> {
  const result = { ...body };
  const largeFields = ['audio', 'image', 'input', 'messages'];

  for (const field of largeFields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 1024) {
      result[field] = createHash('sha256').update(value).digest('hex').slice(0, 16);
    } else if (Array.isArray(value)) {
      // For messages array, serialize and hash if large
      const serialized = JSON.stringify(value);
      if (serialized.length > 1024) {
        result[field] = createHash('sha256').update(serialized).digest('hex').slice(0, 16);
      }
    }
  }

  return result;
}

/**
 * Generate a cache key from request parameters.
 * Includes tenant ID for per-tenant isolation.
 * Provider is NOT included - this is what makes the cache provider-agnostic.
 */
function generateCacheKey(
  requestType: string,
  tenantId: string | undefined,
  requestBody: Record<string, unknown>
): string {
  const cacheableBody = hashLargeFields(requestBody);
  delete cacheableBody.stream;
  delete cacheableBody.user;

  const bodyHash = createHash('sha256')
    .update(JSON.stringify(cacheableBody))
    .digest('hex')
    .slice(0, 16);

  const prefix = tenantId ? `${tenantId}:${requestType}` : requestType;
  return `${prefix}:${bodyHash}`;
}

/**
 * Detect if a response contains tool calls in any provider format.
 * Checks OpenAI (choices[].message.tool_calls), Anthropic (stop_reason),
 * and normalized (finishReason) formats.
 */
function hasToolCalls(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const resp = response as Record<string, unknown>;

  // OpenAI format: choices[].message.tool_calls
  if (resp.choices && Array.isArray(resp.choices)) {
    const has = resp.choices.some(
      (c: any) => c.message?.tool_calls && c.message.tool_calls.length > 0
    );
    if (has) return true;
  }

  // Anthropic/Bedrock format: stop_reason === 'tool_use'
  if (resp.stop_reason === 'tool_use') return true;

  // Normalized format: finishReason === 'tool_calls'
  if (resp.finishReason === 'tool_calls') return true;

  return false;
}

/**
 * Get a cached response if available and not expired.
 * Tracks access count for tiered caching - hot entries get extended TTL.
 */
export function getCachedResponse(
  requestType: string,
  tenantId: string | undefined,
  requestBody: Record<string, unknown>
): CacheEntry | null {
  const key = generateCacheKey(requestType, tenantId, requestBody);
  const cached = cache.get(key);

  if (!cached) return null;

  try {
    const entry = JSON.parse(cached) as CacheEntry;
    const accessKey = 'access:' + key;
    const count = cache.incrBy(accessKey, 1);
    cache.expire(accessKey, 3600);

    // Only extend TTL on first promotion (count === 3), not every subsequent access
    if (count === 3) {
      const currentTTL = getDefaultTTL(requestType as RequestType);
      cache.expire(key, Math.min(currentTTL * 3, 3600));
    }

    return entry;
  } catch {
    cache.del(key);
    return null;
  }
}

/**
 * Store a response in the cache.
 */
export function setCachedResponse(
  requestType: string,
  tenantId: string | undefined,
  requestBody: Record<string, unknown>,
  response: unknown,
  tokens: number = 0,
  options: CacheOptions = { requestType: 'chat' }
): void {
  if (requestBody.stream) return;

  if (requestBody.tools && Array.isArray(requestBody.tools) && requestBody.tools.length > 0) return;

  // Multi-provider tool call detection
  if (hasToolCalls(response)) return;

  // Response size limit: skip caching large responses
  try {
    const serialized = JSON.stringify(response);
    if (serialized.length > MAX_CACHEABLE_BYTES) {
      logger.debug({ size: serialized.length, limit: MAX_CACHEABLE_BYTES }, 'Response too large to cache');
      return;
    }
  } catch {
    return; // If we can't serialize, we can't cache
  }

  const key = generateCacheKey(requestType, tenantId, requestBody);
  const entry: CacheEntry = {
    response,
    timestamp: Date.now(),
    tokens,
  };

  const ttlSeconds = options.ttlSeconds ?? getDefaultTTL(requestType as RequestType);
  cache.set(key, JSON.stringify(entry), ttlSeconds);

  logger.debug({ key, ttlSeconds }, 'Response cached');
}

/**
 * Check cache before routing a request. Returns cached response or null.
 * Includes a skipCache predicate to skip caching for certain request variants.
 */
export function checkRouteCache(
  requestType: RequestType,
  tenantId: string | undefined,
  requestBody: Record<string, unknown>,
  skipCache?: (body: Record<string, unknown>) => boolean
): CacheEntry | null {
  if (skipCache && skipCache(requestBody)) return null;
  return getCachedResponse(requestType, tenantId, requestBody);
}

/**
 * Store a route response in cache after successful execution.
 */
export function storeRouteCache(
  requestType: RequestType,
  tenantId: string | undefined,
  requestBody: Record<string, unknown>,
  response: unknown,
  options?: { skipCache?: (body: Record<string, unknown>) => boolean; ttlSeconds?: number }
): void {
  if (options?.skipCache && options.skipCache(requestBody)) return;
  setCachedResponse(requestType, tenantId, requestBody, response, 0, {
    requestType,
    ttlSeconds: options?.ttlSeconds,
  });
}

/**
 * Get default TTL based on request type.
 * Deterministic outputs (embedding, ocr, rerank, moderation) get longer TTLs.
 * Generative outputs (chat, image, audio, video, 3d) get shorter TTLs.
 */
function getDefaultTTL(requestType: RequestType): number {
  switch (requestType) {
    case 'embedding':
      return 86400; // 24 hours (deterministic)
    case 'ocr':
    case 'rerank':
    case 'moderation':
      return 86400; // 24 hours (deterministic)
    case 'chat':
      return 300; // 5 minutes
    case 'image':
    case 'audio_tts':
    case 'audio_stt':
    case 'audio_separation':
    case 'video':
    case '3d':
      return 600; // 10 minutes
    default:
      return 300;
  }
}

/**
 * Invalidate cache for a specific tenant (e.g., on key rotation).
 * Cleans up both cache entries and access counter keys.
 */
export function invalidateTenantCache(tenantId: string): void {
  const keys = cache.keysByPrefix(`${tenantId}:`);
  for (const key of keys) {
    cache.del(key);
  }

  // Also clean up access counter keys (prefixed with "access:")
  const accessKeys = cache.keysByPrefix(`access:${tenantId}:`);
  for (const key of accessKeys) {
    cache.del(key);
  }

  logger.info({ tenantId, keysRemoved: keys.length + accessKeys.length }, 'Tenant cache invalidated');
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number } {
  return { size: cache.keysByPrefix('').length };
}
