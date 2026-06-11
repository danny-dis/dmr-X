import { getDb } from '@dmr-x/db';
import { logger, eventBus, SystemEvents } from '@dmr-x/utils';
import type { AdapterRegistry } from '@dmr-x/adapters';
import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { JudgeService } from './judge.service.js';
import { calculateEloUpdate } from './elo.js';

export interface BenchmarkPrompt {
  id: string;
  category: string;
  modality: string;
  request: UnifiedRequest;
  expectedQuality?: number; // 0-1, if known
}

export interface BenchmarkResult {
  modelId: string;
  providerId: string;
  benchmarkType: string;
  score: number;
  latencyMs: number;
  details: Record<string, unknown>;
}

// Standard benchmark prompts for LLM evaluation
export const LLM_BENCHMARKS: BenchmarkPrompt[] = [
  {
    id: 'llm-reasoning-1',
    category: 'reasoning',
    modality: 'llm',
    request: {
      modality: 'llm',
      messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
      max_tokens: 10,
      stream: false,
      metadata: {},
    },
    expectedQuality: 1.0,
  },
  {
    id: 'llm-creative-1',
    category: 'creative',
    modality: 'llm',
    request: {
      modality: 'llm',
      messages: [{ role: 'user', content: 'Write a haiku about coding.' }],
      max_tokens: 100,
      stream: false,
      metadata: {},
    },
  },
  {
    id: 'llm-instruction-1',
    category: 'instruction',
    modality: 'llm',
    request: {
      modality: 'llm',
      messages: [{ role: 'user', content: 'List 3 programming languages. Reply as JSON array.' }],
      max_tokens: 100,
      response_format: { type: 'json_object' },
      stream: false,
      metadata: {},
    },
  },
];

// Standard benchmark prompts for diffusion evaluation
const DIFFUSION_BENCHMARKS: BenchmarkPrompt[] = [
  {
    id: 'diffusion-photo-1',
    category: 'photorealistic',
    modality: 'diffusion',
    request: {
      modality: 'diffusion',
      prompt: 'A photorealistic sunset over mountains, 8k quality',
      width: 512,
      height: 512,
      steps: 20,
      stream: false,
      metadata: {},
    },
  },
  {
    id: 'diffusion-art-1',
    category: 'artistic',
    modality: 'diffusion',
    request: {
      modality: 'diffusion',
      prompt: 'A watercolor painting of a cat sitting on a windowsill',
      width: 512,
      height: 512,
      steps: 20,
      stream: false,
      metadata: {},
    },
  },
];

export class BenchmarkService {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private adapterRegistry: AdapterRegistry,
    private judgeService: JudgeService
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    eventBus.on(SystemEvents.MODEL_REGISTERED, (data) => {
      logger.info({ modelId: data.modelId }, 'New model registered, triggering quick benchmark');
      this.runQuickBenchmark(data.id).catch(err => {
        logger.error({ err, modelId: data.modelId }, 'Quick benchmark failed');
      });
    });
  }

  async runBenchmarks(): Promise<BenchmarkResult[]> {
    logger.info('Starting benchmark run');
    const results: BenchmarkResult[] = [];

    // Run LLM benchmarks
    for (const prompt of LLM_BENCHMARKS) {
      const llmResults = await this.runBenchmarkForModality(prompt);
      results.push(...llmResults);
    }

    // Run diffusion benchmarks
    for (const prompt of DIFFUSION_BENCHMARKS) {
      const diffusionResults = await this.runBenchmarkForModality(prompt);
      results.push(...diffusionResults);
    }

    // Store results
    await this.storeResults(results);

    // After individual benchmarks, run some pairwise battles to refine Elo
    await this.runArenaBattles(5);

    logger.info({ count: results.length }, 'Benchmark run complete');
    return results;
  }

  async runQuickBenchmark(modelProfileId: string): Promise<void> {
    const db = getDb();
    const model = db.prepare('SELECT mp.*, p.name as provider_name FROM model_profiles mp JOIN providers p ON p.id = mp.provider_id WHERE mp.id = ?').get(modelProfileId) as any;
    if (!model) return;

    // Run one reasoning benchmark
    const prompt = LLM_BENCHMARKS[0]!;
    const adapter = this.adapterRegistry.get(model.provider_name);
    if (!adapter) return;

    try {
      const start = Date.now();
      const response = await adapter.execute(prompt.request, { timeoutMs: 30000 });
      const latencyMs = Date.now() - start;

      const score = await this.judgeService.grade(
        prompt.request.messages?.[0]?.content as string,
        response.message?.content as string
      );

      await this.storeResults([{
        modelId: model.model_id,
        providerId: model.provider_name,
        benchmarkType: prompt.category,
        score,
        latencyMs,
        details: { promptId: prompt.id, isQuick: true }
      }]);

      // Pit against a champion in same tier
      const champion = db.prepare(
        'SELECT id FROM model_profiles WHERE capability_tier = ? AND is_active = 1 AND id != ? ORDER BY elo_rating DESC LIMIT 1'
      ).get(model.capability_tier, modelProfileId) as { id: string } | undefined;

      if (champion) {
        await this.runArenaBattle(modelProfileId, champion.id, prompt);
      }
    } catch (err) {
      logger.error({ err, modelId: model.model_id }, 'Quick benchmark execution failed');
    }
  }

  async runArenaBattles(count: number): Promise<void> {
    const db = getDb();
    const prompts = LLM_BENCHMARKS;
    
    for (let i = 0; i < count; i++) {
      // Pick a random prompt
      const prompt = prompts[Math.floor(Math.random() * prompts.length)]!;
      
      // Pick two models in the same capability tier
      const tierRow = db.prepare(
        'SELECT capability_tier FROM model_profiles WHERE is_active = 1 GROUP BY capability_tier HAVING COUNT(*) >= 2 ORDER BY RANDOM() LIMIT 1'
      ).get() as { capability_tier: string } | undefined;

      if (!tierRow) continue;

      const models = db.prepare(
        'SELECT id FROM model_profiles WHERE capability_tier = ? AND is_active = 1 ORDER BY RANDOM() LIMIT 2'
      ).all(tierRow.capability_tier) as { id: string }[];

      if (models.length < 2) continue;

      await this.runArenaBattle(models[0]!.id, models[1]!.id, prompt);
    }
  }

  async runArenaBattle(modelAProfileId: string, modelBProfileId: string, prompt: BenchmarkPrompt): Promise<void> {
    const db = getDb();
    
    const modelA = db.prepare('SELECT mp.*, p.name as provider_name FROM model_profiles mp JOIN providers p ON p.id = mp.provider_id WHERE mp.id = ?').get(modelAProfileId) as any;
    const modelB = db.prepare('SELECT mp.*, p.name as provider_name FROM model_profiles mp JOIN providers p ON p.id = mp.provider_id WHERE mp.id = ?').get(modelBProfileId) as any;

    if (!modelA || !modelB) return;

    const adapterA = this.adapterRegistry.get(modelA.provider_name);
    const adapterB = this.adapterRegistry.get(modelB.provider_name);

    if (!adapterA || !adapterB) return;

    try {
      const [resA, resB] = await Promise.all([
        adapterA.execute(prompt.request, { timeoutMs: 30000 }),
        adapterB.execute(prompt.request, { timeoutMs: 30000 })
      ]);

      const promptText = prompt.request.messages?.[0]?.content as string;
      const evaluation = await this.judgeService.compare(
        promptText,
        resA.message?.content as string,
        resB.message?.content as string
      );

      let outcome = 0.5;
      if (evaluation.winner === 'A') outcome = 1.0;
      if (evaluation.winner === 'B') outcome = 0.0;

      const update = calculateEloUpdate(modelA.elo_rating, modelB.elo_rating, outcome);

      db.transaction(() => {
        db.prepare('UPDATE model_profiles SET elo_rating = ?, updated_at = datetime(\'now\') WHERE id = ?').run(update.newRatingA, modelA.id);
        db.prepare('UPDATE model_profiles SET elo_rating = ?, updated_at = datetime(\'now\') WHERE id = ?').run(update.newRatingB, modelB.id);
        
        // Log battle
        db.prepare(
          'INSERT INTO benchmark_results (id, model_id, benchmark_type, score, details) VALUES (?, ?, ?, ?, ?)'
        ).run(
          crypto.randomUUID(),
          modelA.id,
          `battle:${prompt.category}`,
          outcome,
          JSON.stringify({
            competitor_id: modelB.id,
            reasoning: evaluation.reasoning,
            scores: evaluation.scores,
            elo_change: update.changeA
          })
        );
      });

      eventBus.emit(SystemEvents.ELO_UPDATED, {
        modelA: { id: modelA.id, oldElo: modelA.elo_rating, newElo: update.newRatingA },
        modelB: { id: modelB.id, oldElo: modelB.elo_rating, newElo: update.newRatingB },
        winner: evaluation.winner
      });

      logger.info({ 
        modelA: modelA.model_id, 
        modelB: modelB.model_id, 
        winner: evaluation.winner,
        newEloA: Math.round(update.newRatingA)
      }, 'Arena battle complete');

    } catch (err) {
      logger.error({ err }, 'Arena battle failed');
    }
  }

  private async runBenchmarkForModality(prompt: BenchmarkPrompt): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const adapters = this.adapterRegistry.list();

    for (const providerId of adapters) {
      const adapter = this.adapterRegistry.get(providerId);
      if (!adapter) continue;

      if (!adapter.supportedModalities.includes(prompt.modality as any)) {
        continue;
      }

      try {
        const start = Date.now();
        const response = await adapter.execute(prompt.request, { timeoutMs: 60000 });
        const latencyMs = Date.now() - start;

        const score = await this.evaluateResponse(prompt, response);

        results.push({
          modelId: response.modelId,
          providerId,
          benchmarkType: prompt.category,
          score,
          latencyMs,
          details: {
            promptId: prompt.id,
            responseLength: response.message?.content?.length || 0,
          },
        });
      } catch (error) {
        logger.warn({ err: error, providerId, promptId: prompt.id }, 'Benchmark failed');
        results.push({
          modelId: 'unknown',
          providerId,
          benchmarkType: prompt.category,
          score: 0,
          latencyMs: 0,
          details: {
            promptId: prompt.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    return results;
  }

  private async evaluateResponse(prompt: BenchmarkPrompt, response: UnifiedResponse): Promise<number> {
    if (prompt.modality === 'llm') {
      const content = typeof response.message?.content === 'string' ? response.message.content : '';
      if (!content) return 0;

      // Use AI judge for LLM scoring
      return await this.judgeService.grade(
        prompt.request.messages?.[0]?.content as string,
        content
      );
    }

    if (prompt.modality === 'diffusion') {
      // Heuristic scoring for images
      if (response.images && response.images.length > 0) return 0.8;
    }

    return 0.5;
  }

  private async storeResults(results: BenchmarkResult[]): Promise<void> {
    const db = getDb();

    for (const result of results) {
      try {
        // Get model profile ID
        const modelRow = db.prepare(
          `SELECT mp.id FROM model_profiles mp
           JOIN providers p ON p.id = mp.provider_id
           WHERE p.name = ? AND mp.model_id = ?`
        ).get(result.providerId, result.modelId) as any;

        if (modelRow) {
          db.prepare(
            `INSERT INTO benchmark_results (id, model_id, benchmark_type, score, details)
             VALUES (?, ?, ?, ?, ?)`
          ).run(
            crypto.randomUUID(),
            modelRow.id,
            result.benchmarkType,
            result.score,
            JSON.stringify(result.details)
          );

          // Update model quality score (weighted average)
          db.prepare(
            `UPDATE model_profiles SET
              quality_score = (
                SELECT AVG(score) FROM benchmark_results
                WHERE model_id = ? AND run_at > datetime('now', '-7 days')
              ),
              avg_latency_ms = ?,
              updated_at = datetime('now')
            WHERE id = ?`
          ).run(modelRow.id, result.latencyMs, modelRow.id);
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to store benchmark result');
      }
    }
  }

  startScheduled(intervalMs: number = 24 * 60 * 60 * 1000): void {
    logger.info({ intervalMs }, 'Starting scheduled benchmarks');
    this.interval = setInterval(() => {
      this.runBenchmarks().catch((err) => {
        logger.error({ err }, 'Scheduled benchmark failed');
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
