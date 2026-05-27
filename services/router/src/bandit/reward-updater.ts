import { getPool } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { ThompsonSampler } from './thompson-sampler.js';
import { calculateReward } from './thompson-sampler.js';

export interface RequestRecord {
  requestId: string;
  providerId: string;
  modelId: string;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  qualityScore?: number;
  success: boolean;
  errorCode?: string;
}

export class RewardUpdater {
  constructor(private sampler: ThompsonSampler) {}

  /**
   * Update the bandit after a request completes
   */
  async updateFromRequest(record: RequestRecord): Promise<void> {
    const costPerToken = record.costPerInputToken + record.costPerOutputToken;
    const qualityScore = record.qualityScore ?? 0.5;

    const reward = calculateReward(
      qualityScore,
      record.latencyMs,
      costPerToken,
      record.success
    );

    // Update the sampler
    this.sampler.update(
      {
        providerId: record.providerId,
        providerName: record.providerId,
        modelId: record.modelId,
        modality: 'llm', // Will be updated with actual modality
        intelligenceLayer: 'executor',
        capabilities: [],
        costPerInputToken: record.costPerInputToken,
        costPerOutputToken: record.costPerOutputToken,
        costPerImage: 0,
        avgLatencyMs: record.latencyMs,
        qualityScore,
        isHealthy: true,
      },
      reward
    );

    logger.debug(
      { providerId: record.providerId, modelId: record.modelId, reward },
      'Updated bandit reward'
    );
  }

  /**
   * Periodically recompute rewards from request logs
   */
  async recomputeFromLogs(daysBack: number = 7): Promise<void> {
    const pool = getPool();

    const result = await pool.query(
      `SELECT
        selected_provider as "providerId",
        selected_model as "modelId",
        AVG(latency_ms) as "avgLatency",
        AVG(quality_score) as "avgQuality",
        COUNT(*) as "totalRequests",
        COUNT(*) FILTER (WHERE error_code IS NULL) as "successfulRequests"
      FROM request_logs
      WHERE timestamp > NOW() - INTERVAL '${daysBack} days'
        AND selected_provider IS NOT NULL
      GROUP BY selected_provider, selected_model`
    );

    for (const row of result.rows) {
      const successRate = row.successfulRequests / row.totalRequests;
      const reward = calculateReward(
        parseFloat(row.avgQuality) || 0.5,
        parseInt(row.avgLatency) || 1000,
        0.001, // Default cost
        successRate > 0.5
      );

      this.sampler.update(
        {
          providerId: row.providerId,
          providerName: row.providerId,
          modelId: row.modelId,
          modality: 'llm',
          intelligenceLayer: 'executor',
          capabilities: [],
          costPerInputToken: 0.001,
          costPerOutputToken: 0.002,
          costPerImage: 0,
          avgLatencyMs: parseInt(row.avgLatency) || 1000,
          qualityScore: parseFloat(row.avgQuality) || 0.5,
          isHealthy: true,
        },
        reward
      );
    }

    logger.info({ models: result.rows.length }, 'Recomputed bandit rewards from logs');
  }
}
