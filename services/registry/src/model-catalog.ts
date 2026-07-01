import { PROVIDER_CATALOG, type ModelTemplate, type PricingTier } from './provider-catalog.js';
import { classifyPricingTier } from './model-classification.js';

/**
 * Model tier classification based on capability, cost, and context window.
 * Maps models to tiers that inform routing decisions.
 */
export type ModelTier = 'frontier' | 'strong' | 'balanced' | 'fast' | 'economy';

interface TierThresholds {
  minContextWindow: number;
  maxInputCostPer1M: number;
  hasReasoning: boolean;
  hasVision: boolean;
}

const TIER_THRESHOLDS: Record<ModelTier, TierThresholds> = {
  frontier: { minContextWindow: 200000, maxInputCostPer1M: 15, hasReasoning: true, hasVision: true },
  strong: { minContextWindow: 128000, maxInputCostPer1M: 10, hasReasoning: false, hasVision: true },
  balanced: { minContextWindow: 64000, maxInputCostPer1M: 5, hasReasoning: false, hasVision: false },
  fast: { minContextWindow: 32000, maxInputCostPer1M: 2, hasReasoning: false, hasVision: false },
  economy: { minContextWindow: 0, maxInputCostPer1M: Infinity, hasReasoning: false, hasVision: false },
};

/**
 * Classify a model into a tier based on its catalog metadata.
 */
export function classifyModelTier(model: ModelTemplate): ModelTier {
  const caps = new Set(model.capabilities);
  const ctx = model.contextWindow ?? 0;
  const inputCost = model.inputCostPer1M ?? Infinity;

  if (ctx >= TIER_THRESHOLDS.frontier.minContextWindow &&
      inputCost <= TIER_THRESHOLDS.frontier.maxInputCostPer1M &&
      caps.has('reasoning') && caps.has('vision')) {
    return 'frontier';
  }
  if (ctx >= TIER_THRESHOLDS.strong.minContextWindow &&
      inputCost <= TIER_THRESHOLDS.strong.maxInputCostPer1M &&
      caps.has('vision')) {
    return 'strong';
  }
  if (ctx >= TIER_THRESHOLDS.balanced.minContextWindow &&
      inputCost <= TIER_THRESHOLDS.balanced.maxInputCostPer1M) {
    return 'balanced';
  }
  if (ctx >= TIER_THRESHOLDS.fast.minContextWindow &&
      inputCost <= TIER_THRESHOLDS.fast.maxInputCostPer1M) {
    return 'fast';
  }
  return 'economy';
}

/**
 * Compute estimated cost for a request given model metadata and token counts.
 */
export function computeCost(
  inputCostPer1K: number,
  outputCostPer1K: number,
  inputTokens: number,
  outputTokens: number,
): number {
  return (inputCostPer1K * inputTokens + outputCostPer1K * outputTokens) / 1000;
}

/**
 * Look up a model from the static catalog by provider ID and model ID.
 */
export function lookupCatalogModel(providerId: string, modelId: string): ModelTemplate | undefined {
  for (const template of PROVIDER_CATALOG) {
    if (template.id === providerId) {
      return template.models.find(m => m.id === modelId);
    }
  }
  return undefined;
}

/**
 * Get all models from the catalog that support a given modality.
 */
export function getCatalogModelsByModality(modality: string): Array<{ providerId: string; model: ModelTemplate; tier: ModelTier; pricingTier: PricingTier }> {
  const results: Array<{ providerId: string; model: ModelTemplate; tier: ModelTier; pricingTier: PricingTier }> = [];

  for (const template of PROVIDER_CATALOG) {
    for (const model of template.models) {
      if (model.modalities.includes(modality)) {
        results.push({
          providerId: template.id,
          model,
          tier: classifyModelTier(model),
          pricingTier: model.pricingTier ?? classifyPricingTier(model),
        });
      }
    }
  }

  return results;
}
