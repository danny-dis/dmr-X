/**
 * Cross-Provider Pricing Resolution for DMR-X
 *
 * Resolves accurate pricing from models.dev for all providers.
 * Special handling for Bedrock and Azure which use non-standard model IDs.
 *
 * Based on Archestra's cross-provider-pricing.ts pattern.
 */

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('registry:cross-provider-pricing');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossProviderPrices {
  promptPricePerToken: number | null;
  completionPricePerToken: number | null;
  cacheReadPricePerToken: number | null;
  cacheWritePricePerToken: number | null;
}

export interface ModelsDevModel {
  id: string;
  name?: string;
  cost?: {
    prompt?: number;
    completion?: number;
    cache_read?: number;
    cache_write?: number;
  };
  context_length?: number;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  tool_call?: boolean;
}

export interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

export type ModelsDevApiResponse = Record<string, ModelsDevProvider>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * DMR-X provider ID to models.dev provider ID mapping
 */
const PROVIDER_TO_MODELS_DEV: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  'google-vertex': 'google',
  groq: 'groq',
  deepseek: 'deepseek',
  mistral: 'mistral',
  cohere: 'cohere',
  xai: 'xai',
  fireworks: 'fireworks',
  together: 'together',
  perplexity: 'perplexity',
  cerebras: 'cerebras',
  bedrock: 'amazon-bedrock',
  azure: 'openai', // Azure hosts OpenAI models
  ollama: 'ollama',
  openrouter: 'openrouter',
  replicate: 'replicate',
};

/**
 * Bedrock vendor prefix to models.dev provider ID mapping.
 * This allows us to find the canonical model entry which includes cache pricing.
 */
const BEDROCK_VENDOR_TO_MODELS_DEV_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  meta: 'meta',
  mistral: 'mistral',
  cohere: 'cohere',
  deepseek: 'deepseek',
  ai21: 'ai21',
};

/** Region prefix pattern for Bedrock inference profile IDs */
const BEDROCK_REGION_PREFIX = /^(us-gov|us|eu|apac|ap|sa|ca|global)\./;

/** Trailing Bedrock model version suffix (e.g., -v1:0 or :0) */
const BEDROCK_VERSION_SUFFIX = /(?:-v\d+)?:\d+$/;

/** Date suffix in various formats */
const DATE_SUFFIX = /-\d{4}--\d{2}-\d{2}$|-\d{8}$/;

// ---------------------------------------------------------------------------
// Universal Model Pricing Lookup
// ---------------------------------------------------------------------------

/**
 * Look up pricing for any model from models.dev data.
 * Works for all providers - uses direct lookup for most, special handling for Bedrock/Azure.
 *
 * @returns Pricing data or null if not found
 */
export function lookupModelPricing(params: {
  provider: string;
  modelId: string;
  modelsDevData: ModelsDevApiResponse;
}): CrossProviderPrices | null {
  const { provider, modelId, modelsDevData } = params;

  // Special handling for Bedrock (region-prefixed IDs)
  if (provider === 'bedrock') {
    return resolveCrossProviderPrices({ provider, modelId, modelsDevData });
  }

  // Special handling for Azure (arbitrary deployment names)
  if (provider === 'azure') {
    return resolveCrossProviderPrices({ provider, modelId, modelsDevData });
  }

  // Direct lookup for all other providers
  const modelsDevProviderId = PROVIDER_TO_MODELS_DEV[provider];
  if (!modelsDevProviderId) {
    return null;
  }

  const providerData = modelsDevData[modelsDevProviderId];
  if (!providerData?.models) {
    return null;
  }

  // Try exact match first
  const exactMatch = providerData.models[modelId];
  if (exactMatch?.cost) {
    return modelsDevCostToPerToken(exactMatch.cost);
  }

  // Try normalized match (lowercase, strip date suffix)
  const normalizedId = modelId.toLowerCase().replace(DATE_SUFFIX, '');
  for (const [key, model] of Object.entries(providerData.models)) {
    const normalizedKey = key.toLowerCase().replace(DATE_SUFFIX, '');
    if (normalizedKey === normalizedId && model.cost) {
      return modelsDevCostToPerToken(model.cost);
    }
  }

  // For OpenRouter, try with provider prefix (e.g., "openai/gpt-4o")
  if (provider === 'openrouter' && !modelId.includes('/')) {
    // Try common prefixes
    for (const prefix of ['openai/', 'anthropic/', 'google/']) {
      const prefixedId = `${prefix}${modelId}`;
      const match = providerData.models[prefixedId];
      if (match?.cost) {
        return modelsDevCostToPerToken(match.cost);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bedrock/Azure Specific Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve pricing for providers whose model IDs don't match models.dev keys.
 *
 * Why this is needed:
 * - Bedrock stores region-prefixed inference-profile IDs (us.anthropic.claude-...)
 * - Azure stores arbitrary deployment names
 * - Neither matches canonical keys in models.dev
 * - The underlying vendor entry also carries cache prices that region-keyed entries omit
 *
 * @returns Pricing data or null if no confident match found
 */
export function resolveCrossProviderPrices(params: {
  provider: string;
  modelId: string;
  underlyingModelName?: string | null;
  modelsDevData: ModelsDevApiResponse;
}): CrossProviderPrices | null {
  const { provider, modelId, underlyingModelName, modelsDevData } = params;

  // Get targets based on provider type
  const targets =
    provider === 'bedrock'
      ? resolveBedrockTargets(underlyingModelName ?? modelId)
      : provider === 'azure'
        ? arrayFrom(resolveAzureTarget(underlyingModelName ?? modelId))
        : [];

  // Try each target in priority order
  for (const target of targets) {
    const entry = findModelsDevModel({
      modelsDevData,
      modelsDevProviderId: target.modelsDevProviderId,
      candidates: target.candidates,
    });

    if (entry?.cost) {
      return modelsDevCostToPerToken(entry.cost);
    }
  }

  return null;
}

/**
 * Convert models.dev cost format to per-token pricing
 */
export function modelsDevCostToPerToken(cost: {
  prompt?: number;
  completion?: number;
  cache_read?: number;
  cache_write?: number;
}): CrossProviderPrices {
  // models.dev costs are per 1M tokens
  return {
    promptPricePerToken: cost.prompt !== undefined ? cost.prompt / 1_000_000 : null,
    completionPricePerToken: cost.completion !== undefined ? cost.completion / 1_000_000 : null,
    cacheReadPricePerToken: cost.cache_read !== undefined ? cost.cache_read / 1_000_000 : null,
    cacheWritePricePerToken: cost.cache_write !== undefined ? cost.cache_write / 1_000_000 : null,
  };
}

// ---------------------------------------------------------------------------
// Internal: Bedrock Resolution
// ---------------------------------------------------------------------------

interface CrossProviderTarget {
  modelsDevProviderId: string;
  candidates: string[];
}

/**
 * Resolve Bedrock model ID to models.dev targets
 */
function resolveBedrockTargets(modelId: string): CrossProviderTarget[] {
  // Strip region prefix
  const withoutRegion = modelId.replace(BEDROCK_REGION_PREFIX, '');
  const firstDot = withoutRegion.indexOf('.');

  if (firstDot === -1) {
    return [];
  }

  const targets: CrossProviderTarget[] = [];
  const vendor = withoutRegion.slice(0, firstDot).toLowerCase();
  const rawModel = withoutRegion.slice(firstDot + 1);

  // Strategy 1: Vendor's canonical entry (has cache prices)
  const canonicalProvider = BEDROCK_VENDOR_TO_MODELS_DEV_PROVIDER[vendor];
  if (canonicalProvider) {
    const canonical = rawModel.replace(BEDROCK_VERSION_SUFFIX, '');
    targets.push({
      modelsDevProviderId: canonicalProvider,
      candidates: dedupe([canonical, canonical.replace(DATE_SUFFIX, '')]),
    });
  }

  // Strategy 2: Fallback to amazon-bedrock entry
  targets.push({
    modelsDevProviderId: 'amazon-bedrock',
    candidates: dedupe([withoutRegion, withoutRegion.replace(DATE_SUFFIX, '')]),
  });

  return targets;
}

// ---------------------------------------------------------------------------
// Internal: Azure Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve Azure deployment name to models.dev target
 */
function resolveAzureTarget(modelName: string): CrossProviderTarget | null {
  const canonical = modelName.trim().toLowerCase();
  if (!canonical) {
    return null;
  }

  // Azure hosts OpenAI models; pricing lives under 'openai'
  return {
    modelsDevProviderId: 'openai',
    candidates: dedupe([canonical, canonical.replace(DATE_SUFFIX, '')]),
  };
}

// ---------------------------------------------------------------------------
// Internal: Model Lookup
// ---------------------------------------------------------------------------

/**
 * Find a model in models.dev data
 */
function findModelsDevModel(params: {
  modelsDevData: ModelsDevApiResponse;
  modelsDevProviderId: string;
  candidates: string[];
}): ModelsDevModel | null {
  const { modelsDevData, modelsDevProviderId, candidates } = params;
  const provider = modelsDevData[modelsDevProviderId];
  const models = provider?.models;

  if (!models) {
    return null;
  }

  // Try exact match first
  for (const candidate of candidates) {
    const exact = models[candidate];
    if (exact) {
      return exact;
    }
  }

  // Try normalized match (strip region prefix)
  const candidateSet = new Set(candidates);
  for (const [key, model] of Object.entries(models)) {
    const normalized = key.replace(BEDROCK_REGION_PREFIX, '');
    if (
      candidateSet.has(normalized) ||
      candidateSet.has(normalized.replace(DATE_SUFFIX, ''))
    ) {
      return model;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayFrom<T>(value: T | null): T[] {
  return value === null ? [] : [value];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// ---------------------------------------------------------------------------
// Models.dev Client (simplified)
// ---------------------------------------------------------------------------

const MODELSDDEV_API_URL = 'https://models.dev/api.json';

let cachedModelsDevData: ModelsDevApiResponse | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch models.dev data with caching
 */
export async function fetchModelsDevData(): Promise<ModelsDevApiResponse> {
  if (cachedModelsDevData && Date.now() < cacheExpiry) {
    return cachedModelsDevData;
  }

  try {
    const response = await fetch(MODELSDDEV_API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch models.dev data: ${response.status}`);
    }

    cachedModelsDevData = await response.json() as ModelsDevApiResponse;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    logger.info('Fetched models.dev pricing data');
    return cachedModelsDevData;
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch models.dev data, using cache if available');

    if (cachedModelsDevData) {
      return cachedModelsDevData;
    }

    // Return empty data as fallback
    return {};
  }
}

/**
 * Clear the models.dev cache (for testing or forced refresh)
 */
export function clearModelsDevCache(): void {
  cachedModelsDevData = null;
  cacheExpiry = 0;
}
