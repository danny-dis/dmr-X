import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { ProviderModel, CandidateSet } from '@dmr-x/core';
import crypto from 'node:crypto';

const cache = createNamespacedCache('registry');

export class RegistryService {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  getCandidates(modality?: string): CandidateSet {
    const db = getDb();
    const query = `
      SELECT
        p.id as "providerId",
        p.name as "providerName",
        mp.model_id as "modelId",
        mp.modality,
        mp.intelligence_layer as "intelligenceLayer",
        p.is_healthy as "isHealthy",
        mp.quality_score as "qualityScore",
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
        mp.speed_rank as "speedRank"
      FROM model_profiles mp
      JOIN providers p ON p.id = mp.provider_id
      WHERE mp.is_active = 1 AND p.is_healthy = 1
      ${modality ? 'AND mp.modality = ?' : ''}
      ORDER BY mp.quality_score DESC
    `;

    const rows = modality
      ? db.prepare(query).all(modality)
      : db.prepare(query).all();

    return rows.map((row: any) => ({
      providerId: row.providerId,
      providerName: row.providerName,
      modelId: row.modelId,
      modality: row.modality,
      intelligenceLayer: row.intelligenceLayer,
      capabilities: this.extractCapabilities(row),
      costPerInputToken: parseFloat(row.costPerInputToken) || 0,
      costPerOutputToken: parseFloat(row.costPerOutputToken) || 0,
      costPerImage: parseFloat(row.costPerImage) || 0,
      avgLatencyMs: row.avgLatencyMs || 1000,
      qualityScore: parseFloat(row.qualityScore) || 0.5,
      maxOutputTokens: row.maxOutputTokens || undefined,
      contextLength: row.contextWindow || undefined,
      isHealthy: row.isHealthy === 1 || row.isHealthy === true,
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
    }));
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
}

export const registryService = new RegistryService();
