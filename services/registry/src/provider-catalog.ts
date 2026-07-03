/**
 * Re-exports from @dmr-x/provider-catalog for backward compatibility.
 * The actual catalog data lives in packages/provider-catalog/src/index.ts.
 */
export {
  PROVIDER_CATALOG,
  getProviderTemplate,
  getProvidersByCategory,
  getProvidersByModality,
  searchProviders,
  type ProviderTemplate,
  type ModelTemplate,
  type OAuthProviderConfig,
  type PricingTier,
  type FreeTierInfo,
} from '@dmr-x/provider-catalog';
