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
  cost: number;
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
 * Hash large binary fields (base64 audio/image/video) to keep cache keys small.
 */
function hashLargeFields(body: Record<string, unknown>): Record<string, unknown> {
  const result = { ...body };
  const largeFields = ['audio', 'image', 'input'];

  for (const field of largeFields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 1024) {
      result[field] = createHash('sha256').update(value).digest('hex').slice(0, 16);
    } else if (Array.isArray(value)) {
      result[field] = value.map((v) =>
        typeof v === 'string' && v.length > 1024
          ? createHash('sha256').update(v).digest('hex').slice(0, 16)
          : v
      );
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
    if (count >= 3) {
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
  cost: number = 0,
  options: CacheOptions = { requestType: 'chat' }
): void {
  if (requestBody.stream) return;

  if (requestBody.tools && Array.isArray(requestBody.tools) && requestBody.tools.length > 0) return;

  if (response && typeof response === 'object') {
    const resp = response as Record<string, unknown>;
    if (resp.choices && Array.isArray(resp.choices)) {
      const hasToolCalls = resp.choices.some(
        (c: any) => c.message?.tool_calls && c.message.tool_calls.length > 0
      );
      if (hasToolCalls) return;
    }
  }

  const key = generateCacheKey(requestType, tenantId, requestBody);
  const entry: CacheEntry = {
    response,
    timestamp: Date.now(),
    tokens,
    cost,
  };

  const baseTTL = options.ttlSeconds ?? getDefaultTTL(requestType as RequestType);
  const ttlSeconds = getCostBasedTTL(cost, baseTTL);
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
  setCachedResponse(requestType, tenantId, requestBody, response, 0, 0, {
    requestType,
    ttlSeconds: options?.ttlSeconds,
  });
}

/**
 * Calculate cost-based TTL multiplier.
 * More expensive requests get cached longer to maximize provider cost savings.
 * Each cent of cost adds 50% to base TTL, capped at 10x.
 */
function getCostBasedTTL(costCents: number, baseTTL: number): number {
  if (costCents <= 0) return baseTTL;
  const multiplier = Math.min(1 + costCents * 0.5, 10);
  return Math.round(baseTTL * multiplier);
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
 * Uses keysByPrefix to enumerate and delete all tenant-scoped keys.
 */
export function invalidateTenantCache(tenantId: string): void {
  const keys = cache.keysByPrefix(`${tenantId}:`);
  for (const key of keys) {
    cache.del(key);
  }
  logger.info({ tenantId, keysRemoved: keys.length }, 'Tenant cache invalidated');
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; keys: string[] } {
  const keys = cache.keysByPrefix('');
  return {
    size: keys.length,
    keys: keys.slice(0, 100),
  };
}