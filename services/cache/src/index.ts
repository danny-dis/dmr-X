export {
  getCachedResponse,
  setCachedResponse,
  checkRouteCache,
  storeRouteCache,
  invalidateTenantCache,
  getCacheStats,
  type CacheEntry,
  type CacheOptions,
  type RequestType,
} from './cache.service.js';

export {
  SemanticCacheService,
  semanticCacheService,
  type SemanticCacheEntry,
  type SemanticCacheLookupResult,
} from './semantic-cache.js';