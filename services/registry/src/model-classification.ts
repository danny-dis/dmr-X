/**
 * Unified Model Classification Service
 *
 * Provides runtime classification of models by pricing tier,
 * with optional verification probes to detect stale catalog data.
 */

import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { PROVIDER_CATALOG, type ModelTemplate, type PricingTier } from './provider-catalog.js';

const cache = createNamespacedCache('model-class');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelClassification {
  providerId: string;
  modelId: string;
  pricingTier: PricingTier;
  inputCostPer1M: number;
  outputCostPer1M: number;
  hasFreeTier: boolean;
  rateLimits: {
    rpm: number;
    rpd: number;
    tpm: number;
    tpd: number;
  } | null;
  monthlyBudget: number;
  verifiedFree: boolean;
  lastVerification: Date | null;
  source: 'catalog' | 'runtime' | 'verified';
}

export interface VerificationResult {
  providerId: string;
  modelId: string;
  isActuallyFree: boolean;
  responseStatus: number;
  error?: string;
  verifiedAt: Date;
}

// ---------------------------------------------------------------------------
// Classification Rules
// ---------------------------------------------------------------------------

/**
 * Classify a model's pricing tier from catalog metadata.
 * Pure function, no side effects.
 */
export function classifyPricingTier(model: ModelTemplate): PricingTier {
  if (model.subscriptionOnly) {
    return 'subscription_only';
  }

  if (model.freeTier) {
    return model.freeTier.monthlyTokenBudget > 0 ? 'free' : 'free_with_limits';
  }

  const inputCost = model.inputCostPer1M ?? 0;
  const outputCost = model.outputCostPer1M ?? 0;
  return (inputCost > 0 || outputCost > 0) ? 'paid' : 'free';
}

/**
 * Classify all models in the catalog and return a map.
 */
export function classifyAllModels(): Map<string, ModelClassification> {
  const result = new Map<string, ModelClassification>();

  for (const provider of PROVIDER_CATALOG) {
    for (const model of provider.models) {
      const key = `${provider.id}:${model.id}`;
      const tier = model.pricingTier ?? classifyPricingTier(model);

      result.set(key, {
        providerId: provider.id,
        modelId: model.id,
        pricingTier: tier,
        inputCostPer1M: model.inputCostPer1M ?? 0,
        outputCostPer1M: model.outputCostPer1M ?? 0,
        hasFreeTier: !!model.freeTier,
        rateLimits: model.freeTier ? model.freeTier.rateLimits : null,
        monthlyBudget: model.freeTier?.monthlyTokenBudget ?? 0,
        verifiedFree: false,
        lastVerification: null,
        source: 'catalog',
      });
    }
  }

  return result;
}

/**
 * Get classification for a specific model.
 */
export function classifyModel(
  providerId: string,
  modelId: string,
): ModelClassification | null {
  const provider = PROVIDER_CATALOG.find(p => p.id === providerId);
  if (!provider) return null;

  const model = provider.models.find(m => m.id === modelId);
  if (!model) return null;

  const tier = model.pricingTier ?? classifyPricingTier(model);

  return {
    providerId,
    modelId,
    pricingTier: tier,
    inputCostPer1M: model.inputCostPer1M ?? 0,
    outputCostPer1M: model.outputCostPer1M ?? 0,
    hasFreeTier: !!model.freeTier,
    rateLimits: model.freeTier ? model.freeTier.rateLimits : null,
    monthlyBudget: model.freeTier?.monthlyTokenBudget ?? 0,
    verifiedFree: false,
    lastVerification: null,
    source: 'catalog',
  };
}

// ---------------------------------------------------------------------------
// Runtime Verification
// ---------------------------------------------------------------------------

/**
 * Verify if a model is actually free by sending a minimal request.
 * Caches results for 24 hours.
 *
 * WARNING: This actually calls the provider API. Use sparingly.
 */
export async function verifyModelFree(
  providerId: string,
  modelId: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<VerificationResult> {
  const cacheKey = `verified:${providerId}:${modelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { /* ignore */ }
  }

  const provider = PROVIDER_CATALOG.find(p => p.id === providerId);
  if (!provider) {
    return {
      providerId,
      modelId,
      isActuallyFree: false,
      responseStatus: 0,
      error: 'Provider not found in catalog',
      verifiedAt: new Date(),
    };
  }

  const effectiveBaseUrl = baseUrl || provider.baseUrl;
  const effectiveApiKey = apiKey || process.env[provider.envKey] || '';

  if (!effectiveApiKey && provider.authMethod !== 'none') {
    return {
      providerId,
      modelId,
      isActuallyFree: false,
      responseStatus: 0,
      error: 'No API key available for verification',
      verifiedAt: new Date(),
    };
  }

  try {
    const url = `${effectiveBaseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider.authMethod === 'bearer') {
      headers['Authorization'] = `Bearer ${effectiveApiKey}`;
    } else if (provider.authMethod === 'x-api-key') {
      headers['x-api-key'] = effectiveApiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });

    clearTimeout(timeout);

    // Check if response indicates payment required
    const isFree = response.status !== 402 && response.status !== 403;

    const result: VerificationResult = {
      providerId,
      modelId,
      isActuallyFree: isFree,
      responseStatus: response.status,
      verifiedAt: new Date(),
    };

    // Cache for 24 hours
    cache.set(cacheKey, JSON.stringify(result), 86400);

    if (!isFree) {
      logger.warn(
        { providerId, modelId, status: response.status },
        'Model verification: model is NOT free (catalog may be stale)'
      );
    }

    return result;
  } catch (error) {
    return {
      providerId,
      modelId,
      isActuallyFree: false,
      responseStatus: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
      verifiedAt: new Date(),
    };
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Save classification to database for persistence across restarts.
 */
export function saveClassification(classification: ModelClassification): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO model_classifications
        (provider_id, model_id, pricingTier, input_cost_per_1m, output_cost_per_1m,
         has_free_tier, rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
         monthly_budget, verified_free, last_verification, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(provider_id, model_id) DO UPDATE SET
        pricingTier = excluded.pricingTier,
        input_cost_per_1m = excluded.input_cost_per_1m,
        output_cost_per_1m = excluded.output_cost_per_1m,
        has_free_tier = excluded.has_free_tier,
        rate_limit_rpm = excluded.rate_limit_rpm,
        rate_limit_rpd = excluded.rate_limit_rpd,
        rate_limit_tpm = excluded.rate_limit_tpm,
        rate_limit_tpd = excluded.rate_limit_tpd,
        monthly_budget = excluded.monthly_budget,
        verified_free = excluded.verified_free,
        last_verification = excluded.last_verification,
        source = excluded.source,
        updated_at = datetime('now')
    `).run(
      classification.providerId,
      classification.modelId,
      classification.pricingTier,
      classification.inputCostPer1M,
      classification.outputCostPer1M,
      classification.hasFreeTier ? 1 : 0,
      classification.rateLimits?.rpm ?? null,
      classification.rateLimits?.rpd ?? null,
      classification.rateLimits?.tpm ?? null,
      classification.rateLimits?.tpd ?? null,
      classification.monthlyBudget,
      classification.verifiedFree ? 1 : 0,
      classification.lastVerification?.toISOString() ?? null,
      classification.source,
    );
  } catch (error) {
    logger.debug({ err: error }, 'Failed to save model classification');
  }
}

/**
 * Load classification from database.
 */
export function loadClassification(
  providerId: string,
  modelId: string,
): ModelClassification | null {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM model_classifications
      WHERE provider_id = ? AND model_id = ?
    `).get(providerId, modelId) as any;

    if (!row) return null;

    return {
      providerId: row.provider_id,
      modelId: row.model_id,
      pricingTier: row.pricingTier,
      inputCostPer1M: row.input_cost_per_1m,
      outputCostPer1M: row.output_cost_per_1m,
      hasFreeTier: row.has_free_tier === 1,
      rateLimits: row.rate_limit_rpm != null ? {
        rpm: row.rate_limit_rpm,
        rpd: row.rate_limit_rpd,
        tpm: row.rate_limit_tpm,
        tpd: row.rate_limit_tpd,
      } : null,
      monthlyBudget: row.monthly_budget,
      verifiedFree: row.verified_free === 1,
      lastVerification: row.last_verification ? new Date(row.last_verification) : null,
      source: row.source,
    };
  } catch (error) {
    logger.debug({ err: error }, 'Failed to load model classification');
    return null;
  }
}

/**
 * Sync all catalog models to database (called on startup).
 */
export function syncClassifications(): void {
  const all = classifyAllModels();
  let synced = 0;

  for (const classification of all.values()) {
    // Check if we have a persisted classification with verification
    const persisted = loadClassification(classification.providerId, classification.modelId);

    if (persisted && persisted.verifiedFree) {
      // Keep verification data, update catalog data
      classification.verifiedFree = persisted.verifiedFree;
      classification.lastVerification = persisted.lastVerification;
      classification.source = persisted.source;
    }

    saveClassification(classification);
    synced++;
  }

  logger.info({ count: synced }, 'Synced model classifications to database');
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Get all free models (verified or catalog-free).
 */
export function getFreeModels(): ModelClassification[] {
  const all = classifyAllModels();
  const freeModels: ModelClassification[] = [];

  for (const classification of all.values()) {
    if (classification.pricingTier === 'free' || classification.pricingTier === 'free_with_limits') {
      freeModels.push(classification);
    }
  }

  // Also load any verified-free models from DB
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM model_classifications
      WHERE pricingTier IN ('free', 'free_with_limits')
        AND verified_free = 1
    `).all() as any[];

    for (const row of rows) {
      const key = `${row.provider_id}:${row.model_id}`;
      if (!all.has(key)) {
        freeModels.push({
          providerId: row.provider_id,
          modelId: row.model_id,
          pricingTier: row.pricingTier,
          inputCostPer1M: row.input_cost_per_1m,
          outputCostPer1M: row.output_cost_per_1m,
          hasFreeTier: row.has_free_tier === 1,
          rateLimits: row.rate_limit_rpm != null ? {
            rpm: row.rate_limit_rpm,
            rpd: row.rate_limit_rpd,
            tpm: row.rate_limit_tpm,
            tpd: row.rate_limit_tpd,
          } : null,
          monthlyBudget: row.monthly_budget,
          verifiedFree: true,
          lastVerification: row.last_verification ? new Date(row.last_verification) : null,
          source: 'verified',
        });
      }
    }
  } catch {
    // DB may not have table yet
  }

  return freeModels;
}

/**
 * Get models by pricing tier.
 */
export function getModelsByTier(tier: PricingTier): ModelClassification[] {
  const all = classifyAllModels();
  const result: ModelClassification[] = [];

  for (const classification of all.values()) {
    if (classification.pricingTier === tier) {
      result.push(classification);
    }
  }

  return result;
}

/**
 * Check if a model is free (catalog or verified).
 */
export function isModelFree(providerId: string, modelId: string): boolean {
  const classification = classifyModel(providerId, modelId);
  if (!classification) return false;
  return classification.pricingTier === 'free' || classification.pricingTier === 'free_with_limits';
}

// ---------------------------------------------------------------------------
// Batch Verification
// ---------------------------------------------------------------------------

export interface BatchVerificationResult {
  providerId: string;
  totalModels: number;
  freeCount: number;
  paidCount: number;
  errorCount: number;
  models: Array<{
    modelId: string;
    isFree: boolean;
    status: number;
    error?: string;
  }>;
}

/**
 * Batch-verify which models are free for a given provider.
 * Probes each model with a minimal chat completion request.
 * Concurrency-limited to avoid rate limits.
 */
export async function batchVerifyFree(
  providerId: string,
  concurrency = 3,
): Promise<BatchVerificationResult> {
  const db = getDb();
  const models = db.prepare(
    `SELECT model_id FROM model_profiles WHERE provider_id = ? AND is_active = 1`
  ).all(providerId) as Array<{ model_id: string }>;

  const results: BatchVerificationResult['models'] = [];
  let freeCount = 0;
  let paidCount = 0;
  let errorCount = 0;

  // Process in batches to limit concurrency
  for (let i = 0; i < models.length; i += concurrency) {
    const batch = models.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (m) => {
        try {
          const result = await verifyModelFree(providerId, m.model_id);
          return {
            modelId: m.model_id,
            isFree: result.isActuallyFree,
            status: result.responseStatus,
            error: result.error,
          };
        } catch {
          errorCount++;
          return {
            modelId: m.model_id,
            isFree: false,
            status: 0,
            error: 'Verification failed',
          };
        }
      }),
    );

    for (const r of batchResults) {
      results.push(r);
      if (r.error) {
        errorCount++;
      } else if (r.isFree) {
        freeCount++;
        // Persist free classification
        saveClassification({
          providerId,
          modelId: r.modelId,
          pricingTier: 'free',
          inputCostPer1M: 0,
          outputCostPer1M: 0,
          hasFreeTier: true,
          rateLimits: null,
          monthlyBudget: 0,
          verifiedFree: true,
          lastVerification: new Date(),
          source: 'verified',
        });
      } else {
        paidCount++;
        saveClassification({
          providerId,
          modelId: r.modelId,
          pricingTier: 'paid',
          inputCostPer1M: 0,
          outputCostPer1M: 0,
          hasFreeTier: false,
          rateLimits: null,
          monthlyBudget: 0,
          verifiedFree: false,
          lastVerification: new Date(),
          source: 'verified',
        });
      }
    }
  }

  logger.info(
    { providerId, total: models.length, free: freeCount, paid: paidCount, errors: errorCount },
    'Batch free verification complete',
  );

  return {
    providerId,
    totalModels: models.length,
    freeCount,
    paidCount,
    errorCount,
    models: results,
  };
}

/**
 * Auto-classify models for providers listed in DMRX_FREE_PROVIDERS.
 * Called at boot to ensure the isFree() predicate works immediately.
 */
export function classifyFreeProviderModels(): number {
  const freeProviders = (process.env.DMRX_FREE_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (freeProviders.length === 0) return 0;

  const db = getDb();
  let classified = 0;

  for (const providerName of freeProviders) {
    const provider = db.prepare(
      'SELECT id FROM providers WHERE name = ?'
    ).get(providerName) as { id: string } | undefined;
    if (!provider) continue;

    const models = db.prepare(
      'SELECT model_id FROM model_profiles WHERE provider_id = ? AND is_active = 1'
    ).all(provider.id) as Array<{ model_id: string }>;

    for (const m of models) {
      saveClassification({
        providerId: provider.id,
        modelId: m.model_id,
        pricingTier: 'free',
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        hasFreeTier: true,
        rateLimits: null,
        monthlyBudget: 0,
        verifiedFree: false,
        lastVerification: null,
        source: 'catalog',
      });
      classified++;
    }
  }

  if (classified > 0) {
    logger.info({ count: classified, providers: freeProviders.length }, 'Classified free provider models from DMRX_FREE_PROVIDERS');
  }
  return classified;
}
