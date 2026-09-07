export { QuotaService, quotaService, type QuotaAllocation, type QuotaUsage } from './quota.service.js';
export { RateLimitService, getRateLimitService } from './rate-limit.service.js';
export { KeyRotationService, keyRotationService } from './key-rotation.service.js';
export { RateLimitTracker, getRateLimitTracker, type TrackRateLimitParams, type GetQuotaStatusParams } from './rate-limit-tracker.js';
export { parseRateLimitHeaders, supportsRateLimitHeaders, calculateQuotaStatus, compareKeyQuota, parseLimitFromError, type RateLimitHeaders, type KeyQuotaStatus } from './dynamic-limits.js';
export {
  buildDimension,
  buildVector,
  evaluateVector,
  isStale,
  hasHeadroom,
  evaluateState,
  computeTokenBucketRemaining,
  defaultStaleAfterMs,
  type QuotaVector,
  type QuotaDimension,
  type QuotaSnapshot,
  type QuotaUnit,
  type QuotaState,
  type DemandVector,
  type QuotaScope,
  type ReplenishmentModel,
} from './quota-dimensions.js';
export {
  CapacityManager,
  InMemoryCapacityStore,
  type CapacityStore,
  type CapacityReservation,
  type ReservationResult,
  type ReservationStatus,
  type ReservationDimension,
} from './capacity-manager.js';
export {
  SQLiteCapacityStore,
  RedisCapacityStore,
  type RedisCapacityStoreConfig,
} from './capacity-store-distributed.js';
export {
  FreeProviderCatalog,
  computeAgeConfidence,
  DEFAULT_POLICY,
  type CatalogRecord,
  type FreeEligibility,
  type CatalogStatus,
  type EligibilityPolicy,
  type EligibilityResult,
  type ProviderObservation,
  type CatalogAuditEntry,
  type VerificationJob,
} from './free-provider-catalog.js';
export {
  getProviderAdapter,
  hasProviderAdapter,
  getRegisteredProviders,
  type ProviderQuotaAdapter,
  type ScopeInfo,
  type QuotaEvent,
} from './provider-adapters.js';