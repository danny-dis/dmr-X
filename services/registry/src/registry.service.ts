import { getPool, getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { ProviderModel, CandidateSet } from '@dmr-x/core';

export class RegistryService {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  async getCandidates(modality?: string): Promise<CandidateSet> {
    const pool = getPool();
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
        mp.supports_json_mode
      FROM model_profiles mp
      JOIN providers p ON p.id = mp.provider_id
      WHERE mp.is_active = true AND p.is_healthy = true
      ${modality ? 'AND mp.modality = $1' : ''}
      ORDER BY mp.quality_score DESC
    `;

    const result = modality
      ? await pool.query(query, [modality])
      : await pool.query(query);

    return result.rows.map((row) => ({
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
      isHealthy: row.isHealthy,
    }));
  }

  private extractCapabilities(row: any): string[] {
    const caps: string[] = [];
    if (row.supports_streaming) caps.push('streaming');
    if (row.supports_vision) caps.push('vision');
    if (row.supports_tool_use) caps.push('tool_use');
    if (row.supports_json_mode) caps.push('json_mode');
    return caps;
  }

  async getProvider(providerId: string): Promise<any> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM providers WHERE id = $1',
      [providerId]
    );
    return result.rows[0] || null;
  }

  async updateHealth(providerId: string, healthy: boolean, latencyMs?: number): Promise<void> {
    const pool = getPool();

    if (healthy) {
      await pool.query(
        `UPDATE providers SET
          is_healthy = true,
          consecutive_failures = 0,
          last_health_check = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
        [providerId]
      );
    } else {
      await pool.query(
        `UPDATE providers SET
          consecutive_failures = consecutive_failures + 1,
          is_healthy = CASE WHEN consecutive_failures >= 2 THEN false ELSE true END,
          last_health_check = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
        [providerId]
      );
    }

    // Record health check
    await pool.query(
      'INSERT INTO health_checks (provider_id, is_healthy, latency_ms) VALUES ($1, $2, $3)',
      [providerId, healthy, latencyMs]
    );
  }

  async getProviderConfig(providerId: string): Promise<any> {
    const redis = getRedis();
    const cacheKey = `provider:config:${providerId}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM providers WHERE id = $1',
      [providerId]
    );

    if (result.rows[0]) {
      await redis.setEx(cacheKey, 300, JSON.stringify(result.rows[0]));
    }

    return result.rows[0] || null;
  }
}

export const registryService = new RegistryService();
