import crypto from 'node:crypto';

import type { ProviderModel, CandidateSet } from '@dmr-x/core';
import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import {
  lookupModelPricing,
  fetchModelsDevData,
  type ModelsDevApiResponse,
} from './cross-provider-pricing.js';
import { classifyModel, type ModelClassification } from './model-classification.js';

const cache = createNamespacedCache('registry');

export class RegistryService {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private modelsDevData: ModelsDevApiResponse | null = null;

  /**
   * Initialize models.dev data for cross-provider pricing
   */
  async initializeModelsDevData(): Promise<void> {
    try {
      this.modelsDevData = await fetchModelsDevData();
      logger.info('Initialized models.dev pricing data');
    } catch (error) {
      logger.warn({ error }, 'Failed to initialize models.dev data');
    }
  }

  getCandidates(modality?: string): CandidateSet {
    const db = getDb();
    const query = `
      SELECT
        p.id as "providerId",
        p.name as "providerName",
        mp.model_id as "modelId",
        mp.modality,
        mp.intelligence_layer as "intelligenceLayer",
        mp.capability_tier as "capabilityTier",
        p.is_healthy as "isHealthy",
        p.auth_method as "authMethod",
        mp.quality_score as "qualityScore",
        mp.elo_rating as "eloRating",
        mp.avg_latency_ms as "avgLatencyMs",
        mp.input_cost_per_1k as "costPerInputToken",
        mp.output_cost_per_1k as "costPerOutputToken",
        mp.cost_per_image as "costPerImage",
        mp.supports_streaming,
        mp.supports_vision,
        mp.supports_tool_use,
        mp.supports_json_mode,
        mp.supports_function_call,
        mp.supports_reasoning,
        mp.max_output_tokens as "maxOutputTokens",
        mp.context_window as "contextWindow",
        mp.rate_limit_rpm as "rateLimitRpm",
        mp.rate_limit_rpd as "rateLimitRpd",
        mp.rate_limit_tpm as "rateLimitTpm",
        mp.rate_limit_tpd as "rateLimitTpd",
        mp.monthly_token_budget as "monthlyTokenBudget",
        mp.intelligence_rank as "intelligenceRank",
        mp.speed_rank as "speedRank",
        mp.subscription_only as "subscriptionOnly"
      FROM model_profiles mp
      JOIN providers p ON p.id = mp.provider_id
      WHERE mp.is_active = 1 AND p.is_healthy = 1
        AND (mp.subscription_only = 0 OR p.auth_method = 'oauth')
      ${modality ? 'AND mp.modality = ?' : ''}
      ORDER BY mp.quality_score DESC
    `;

    const rows = modality
      ? db.prepare(query).all(modality)
      : db.prepare(query).all();

    return rows.map((row: any) => {
      // Resolve pricing from models.dev for all providers
      let costPerInputToken = parseFloat(row.costPerInputToken) || 0;
      let costPerOutputToken = parseFloat(row.costPerOutputToken) || 0;

      if (this.modelsDevData) {
        const modelsDevPrices = lookupModelPricing({
          provider: row.providerId,
          modelId: row.modelId,
          modelsDevData: this.modelsDevData,
        });

        if (modelsDevPrices) {
          // Use models.dev pricing if available (more accurate and up-to-date)
          if (modelsDevPrices.promptPricePerToken !== null) {
            costPerInputToken = modelsDevPrices.promptPricePerToken;
          }
          if (modelsDevPrices.completionPricePerToken !== null) {
            costPerOutputToken = modelsDevPrices.completionPricePerToken;
          }
        }
      }

      // Get unified pricing classification
      const classification = classifyModel(row.providerId, row.modelId);

      return {
        providerId: row.providerId,
        providerName: row.providerName,
        modelId: row.modelId,
        modality: row.modality,
        intelligenceLayer: row.intelligenceLayer,
        capabilityTier: row.capabilityTier || 'executor',
        capabilities: this.extractCapabilities(row),
        costPerInputToken,
        costPerOutputToken,
        costPerImage: parseFloat(row.costPerImage) || 0,
        avgLatencyMs: row.avgLatencyMs || 1000,
        qualityScore: this.calculateQualityScore(parseFloat(row.qualityScore) || 0.5, parseFloat(row.eloRating) || 1200),
        maxOutputTokens: row.maxOutputTokens || undefined,
        contextLength: row.contextWindow || undefined,
        isHealthy: row.isHealthy === 1 || row.isHealthy === true,
        subscriptionOnly: row.subscriptionOnly === 1 || row.subscriptionOnly === true,
        pricingTier: classification?.pricingTier ?? 'unknown',
        freeTierMetadata: (row.intelligenceRank != null || row.speedRank != null) ? {
          intelligenceRank: row.intelligenceRank ?? 0,
          speedRank: row.speedRank ?? 0,
          monthlyTokenBudget: row.monthlyTokenBudget ?? 0,
          rateLimits: {
            rpm: row.rateLimitRpm ?? 0,
            rpd: row.rateLimitRpd ?? 0,
            tpm: row.rateLimitTpm ?? 0,
            tpd: row.rateLimitTpd ?? 0,
          },
        } : undefined,
      };
    });
  }

  /**
   * Calculate a composite quality score from the heuristic quality_score and the Elo rating.
   * Gives 40% weight to heuristic/benchmark average and 60% weight to Elo rating.
   */
  private calculateQualityScore(heuristicScore: number, eloRating: number): number {
    // Normalize Elo (baseline 1200, range 800-1600)
    const normalizedElo = (eloRating - 800) / (1600 - 800);
    const clampedElo = Math.max(0, Math.min(1, normalizedElo));

    return (heuristicScore * 0.4) + (clampedElo * 0.6);
  }

  private extractCapabilities(row: any): string[] {
    const caps: string[] = [];
    if (row.supports_streaming) caps.push('streaming');
    if (row.supports_vision) caps.push('vision');
    if (row.supports_tool_use) caps.push('tool_use');
    if (row.supports_json_mode) caps.push('json_mode');
    if (row.supports_function_call) caps.push('function_call');
    if (row.supports_reasoning) caps.push('reasoning');
    return caps;
  }

  getProvider(providerId: string): any {
    const db = getDb();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
    return row || null;
  }

  updateHealth(providerId: string, healthy: boolean, latencyMs?: number): void {
    const db = getDb();

    if (healthy) {
      db.prepare(
        `UPDATE providers SET
          is_healthy = 1,
          consecutive_failures = 0,
          last_health_check = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(providerId);
    } else {
      db.prepare(
        `UPDATE providers SET
          consecutive_failures = consecutive_failures + 1,
          is_healthy = CASE WHEN consecutive_failures >= 2 THEN 0 ELSE 1 END,
          last_health_check = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(providerId);
    }

    // Record health check
    db.prepare(
      'INSERT INTO health_checks (id, provider_id, is_healthy, latency_ms) VALUES (?, ?, ?, ?)'
    ).run(crypto.randomUUID(), providerId, healthy ? 1 : 0, latencyMs ?? null);
  }

  /**
   * Update only the `last_health_check` timestamp for a provider. Used by
   * the health checker for adapters that are registered but not yet
   * initialized (no API key configured) — we still want to record that we
   * checked, but not bump `consecutive_failures` or flip `is_healthy`,
   * both of which would remove the provider from the candidate set the
   * moment the user *does* add a key.
   */
  touchHealthCheck(providerId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE providers SET
        last_health_check = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(providerId);
  }

  getProviderConfig(providerId: string): any {
    const cacheKey = `config:${providerId}`;

    const cached = cache.get(cacheKey) as string | undefined;
    if (cached) {
      return JSON.parse(cached);
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);

    if (row) {
      cache.set(cacheKey, JSON.stringify(row), 300);
    }

    return row || null;
  }

  // ── Per-Model Health Tracking ──────────────────────────────────────────────

  /** Consecutive failure counts per model (providerId:modelId -> count) */
  private modelFailureCounts = new Map<string, number>();
  /** Timestamps when models were marked unhealthy (for auto-recovery) */
  private modelUnhealthySince = new Map<string, number>();
  /** Models marked as permanently failed (e.g., 402/403) — cooldown handled by RateLimitService */
  private modelPermanentlyFailed = new Set<string>();

  private static readonly MODEL_FAILURE_THRESHOLD = 3;
  private static readonly MODEL_RECOVERY_MS = 5 * 60 * 1000; // 5 minutes auto-recovery

  /**
   * Record a model-level failure. After MODEL_FAILURE_THRESHOLD consecutive failures,
   * the model is marked unhealthy and filtered from candidates.
   */
  recordModelFailure(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`;
    const count = (this.modelFailureCounts.get(key) ?? 0) + 1;
    this.modelFailureCounts.set(key, count);

    if (count >= RegistryService.MODEL_FAILURE_THRESHOLD) {
      this.modelUnhealthySince.set(key, Date.now());
      logger.warn({ providerId, modelId, failureCount: count }, 'Model marked unhealthy after consecutive failures');
    }
  }

  /**
   * Record a model-level success. Clears failure count and unhealthy status.
   */
  recordModelSuccess(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`;
    this.modelFailureCounts.delete(key);
    this.modelUnhealthySince.delete(key);
  }

  /**
   * Mark a model as permanently failed (e.g., 402 Payment Required, 403 Forbidden).
   * The RateLimitService handles the actual cooldown.
   */
  markModelPermanentlyFailed(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`;
    this.modelPermanentlyFailed.add(key);
    this.modelFailureCounts.delete(key);
    this.modelUnhealthySince.delete(key);
  }

  /**
   * Check if a model is unhealthy (too many consecutive failures or permanently failed).
   * Auto-recovers after MODEL_RECOVERY_MS to give the model another chance.
   */
  isModelUnhealthy(providerId: string, modelId: string): boolean {
    const key = `${providerId}:${modelId}`;

    // Permanently failed models stay unhealthy (cooldown handled by RateLimitService)
    if (this.modelPermanentlyFailed.has(key)) {
      return true;
    }

    const unhealthySince = this.modelUnhealthySince.get(key);
    if (!unhealthySince) return false;

    // Auto-recover after threshold period
    if (Date.now() - unhealthySince > RegistryService.MODEL_RECOVERY_MS) {
      this.modelUnhealthySince.delete(key);
      this.modelFailureCounts.delete(key);
      logger.info({ providerId, modelId }, 'Model auto-recovered after cooldown period');
      return false;
    }

    return true;
  }

  /**
   * Get unhealthy model count (for monitoring/admin).
   */
  getUnhealthyModelCount(): number {
    return this.modelUnhealthySince.size + this.modelPermanentlyFailed.size;
  }
}

export const registryService = new RegistryService();
