import type { CapabilityTier } from '@dmr-x/core';
import { getDb } from '@dmr-x/db';
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
  capabilityTier?: CapabilityTier;
  // Optional 8C.1 signal — time to first token for streaming responses.
  firstTokenLatencyMs?: number;
  // Optional 8C.2 signals — tool-call success rate. Only meaningful when
  // the request used tools; otherwise leave undefined.
  toolCallsAttempted?: number;
  toolCallsSucceeded?: number;
  // Optional task type — used by future per-(model, task_type) bandit
  // partitioning. Defaults to 'general'.
  taskType?: string;
}

export class RewardUpdater {
  constructor(private sampler: ThompsonSampler) {}

  /**
   * Update the bandit after a request completes.
   *
   * The reward is now informed by:
   *  - total latency (existing)
   *  - first-token latency / TTFT (8C.1, optional)
   *  - tool-call success rate (8C.2, optional, neutral when no tools)
   *  - cost & quality (existing)
   *
   * The updated (alpha, beta) is also persisted to SQLite so a fresh gateway
   * process boots with the same learned posteriors (8C.3).
   */
  async updateFromRequest(record: RequestRecord): Promise<void> {
    const costPerToken = record.costPerInputToken + record.costPerOutputToken;
    const qualityScore = record.qualityScore ?? 0.5;

    const reward = calculateReward(
      qualityScore,
      record.latencyMs,
      costPerToken,
      record.success,
      {
        firstTokenLatencyMs: record.firstTokenLatencyMs,
        toolCallsAttempted: record.toolCallsAttempted,
        toolCallsSucceeded: record.toolCallsSucceeded,
      },
    );

    // Update the sampler with actual capability tier
    this.sampler.update(
      {
        providerId: record.providerId,
        providerName: record.providerId,
        modelId: record.modelId,
        modality: 'llm', // Will be updated with actual modality
        intelligenceLayer: 'executor',
        capabilityTier: record.capabilityTier || 'executor',
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

    // 8C.3 — persist the updated arm to SQLite. Best-effort: a persistence
    // failure must not break the request path.
    this.persistArm({
      providerId: record.providerId,
      modelId: record.modelId,
      taskType: record.taskType ?? 'general',
    }).catch((err) => {
      logger.warn({ err, providerId: record.providerId }, 'Failed to persist bandit arm');
    });
  }

  /**
   * Persist the current (alpha, beta, pulls, totalReward) of a single arm
   * to the SQLite `bandit_state` table. Creates the table on first use.
   */
  private async persistArm(arm: { providerId: string; modelId: string; taskType: string }): Promise<void> {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bandit_state (
        provider_id TEXT NOT NULL,
        model_id    TEXT NOT NULL,
        task_type   TEXT NOT NULL DEFAULT 'general',
        alpha       REAL NOT NULL DEFAULT 1,
        beta        REAL NOT NULL DEFAULT 1,
        pulls       INTEGER NOT NULL DEFAULT 0,
        total_reward REAL NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (provider_id, model_id, task_type)
      )
    `);

    const snapshot = this.sampler.snapshot();
    const key = `${arm.providerId}:${arm.modelId}`;
    const state = snapshot.find((s) => s.key === key);
    if (!state) return;

    db.prepare(`
      INSERT INTO bandit_state (provider_id, model_id, task_type, alpha, beta, pulls, total_reward, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(provider_id, model_id, task_type) DO UPDATE SET
        alpha = excluded.alpha,
        beta = excluded.beta,
        pulls = excluded.pulls,
        total_reward = excluded.total_reward,
        updated_at = excluded.updated_at
    `).run(
      arm.providerId,
      arm.modelId,
      arm.taskType,
      state.alpha,
      state.beta,
      state.pulls,
      state.totalReward,
    );
  }

  /**
   * Load all persisted arms from SQLite into the in-memory sampler.
   * Call this on gateway startup so cold-start benefits from history.
   */
  async loadFromDb(): Promise<{ loaded: number }> {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bandit_state (
        provider_id TEXT NOT NULL,
        model_id    TEXT NOT NULL,
        task_type   TEXT NOT NULL DEFAULT 'general',
        alpha       REAL NOT NULL DEFAULT 1,
        beta        REAL NOT NULL DEFAULT 1,
        pulls       INTEGER NOT NULL DEFAULT 0,
        total_reward REAL NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (provider_id, model_id, task_type)
      )
    `);

    const rows = db.prepare(`
      SELECT provider_id as "providerId", model_id as "modelId", task_type as "taskType",
             alpha, beta, pulls, total_reward as "totalReward"
      FROM bandit_state
    `).all() as Array<{
      providerId: string;
      modelId: string;
      taskType: string;
      alpha: number;
      beta: number;
      pulls: number;
      totalReward: number;
    }>;

    for (const r of rows) {
      this.sampler.restore(`${r.providerId}:${r.modelId}`, r.alpha, r.beta, r.pulls, r.totalReward);
    }

    if (rows.length > 0) {
      logger.info({ loaded: rows.length }, 'Loaded bandit arms from SQLite');
    }
    return { loaded: rows.length };
  }

  /**
   * Return the full snapshot of the bandit's learned posteriors.
   * Used by the admin API (`GET /v1/admin/bandit`).
   */
  getBanditSnapshot() {
    return this.sampler.snapshot();
  }

  /**
   * Periodically recompute rewards from request logs
   */
  async recomputeFromLogs(daysBack: number = 7): Promise<void> {
    const db = getDb();

    const rows = db.prepare(
      `SELECT
        selected_provider as "providerId",
        selected_model as "modelId",
        AVG(latency_ms) as "avgLatency",
        AVG(quality_score) as "avgQuality",
        COUNT(*) as "totalRequests",
        SUM(CASE WHEN error_code IS NULL THEN 1 ELSE 0 END) as "successfulRequests"
      FROM request_logs
      WHERE timestamp > datetime('now', '-' || ? || ' days')
        AND selected_provider IS NOT NULL
      GROUP BY selected_provider, selected_model`
    ).all(daysBack) as any[];

    for (const row of rows) {
      const successRate = row.successfulRequests / row.totalRequests;
      const reward = calculateReward(
        parseFloat(row.avgQuality) || 0.5,
        parseInt(row.avgLatency) || 1000,
        0.001, // Default cost
        successRate > 0.5
      );

      // Look up actual capability tier from model_profiles
      const modelProfile = db.prepare(
        `SELECT capability_tier FROM model_profiles WHERE model_id = ? LIMIT 1`
      ).get(row.modelId) as { capability_tier?: string } | undefined;

      this.sampler.update(
        {
          providerId: row.providerId,
          providerName: row.providerId,
          modelId: row.modelId,
          modality: 'llm',
          intelligenceLayer: 'executor',
          capabilityTier: (modelProfile?.capability_tier as CapabilityTier) || 'executor',
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

    logger.info({ models: rows.length }, 'Recomputed bandit rewards from logs');
  }
}
