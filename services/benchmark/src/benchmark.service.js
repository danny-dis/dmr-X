import { getPool } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
// Standard benchmark prompts for LLM evaluation
const LLM_BENCHMARKS = [
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
const DIFFUSION_BENCHMARKS = [
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
    adapterRegistry;
    interval = null;
    constructor(adapterRegistry) {
        this.adapterRegistry = adapterRegistry;
    }
    async runBenchmarks() {
        logger.info('Starting benchmark run');
        const results = [];
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
        logger.info({ count: results.length }, 'Benchmark run complete');
        return results;
    }
    async runBenchmarkForModality(prompt) {
        const results = [];
        const adapters = this.adapterRegistry.list();
        for (const providerId of adapters) {
            const adapter = this.adapterRegistry.get(providerId);
            if (!adapter)
                continue;
            if (!adapter.supportedModalities.includes(prompt.modality)) {
                continue;
            }
            try {
                const start = Date.now();
                const response = await adapter.execute(prompt.request, { timeoutMs: 60000 });
                const latencyMs = Date.now() - start;
                const score = this.evaluateResponse(prompt, response);
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
            }
            catch (error) {
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
    evaluateResponse(prompt, response) {
        // Simple heuristic scoring
        let score = 0.5; // Base score for completing
        if (prompt.modality === 'llm') {
            const content = response.message?.content || '';
            // Length check - too short or too long is bad
            if (content.length > 10 && content.length < 2000) {
                score += 0.1;
            }
            // JSON format check
            if (prompt.request.response_format?.type === 'json_object') {
                try {
                    JSON.parse(content);
                    score += 0.2;
                }
                catch {
                    score -= 0.1;
                }
            }
            // Reasoning check - if expected quality is high and we got a response
            if (prompt.expectedQuality && content.length > 0) {
                score = Math.min(1, score + 0.2);
            }
        }
        if (prompt.modality === 'diffusion') {
            // Got an image = good
            if (response.images && response.images.length > 0) {
                score = 0.8;
            }
        }
        return Math.max(0, Math.min(1, score));
    }
    async storeResults(results) {
        const pool = getPool();
        for (const result of results) {
            try {
                // Get model profile ID
                const modelResult = await pool.query(`SELECT mp.id FROM model_profiles mp
           JOIN providers p ON p.id = mp.provider_id
           WHERE p.name = $1 AND mp.model_id = $2`, [result.providerId, result.modelId]);
                if (modelResult.rows.length > 0) {
                    await pool.query(`INSERT INTO benchmark_results (model_id, benchmark_type, score, details)
             VALUES ($1, $2, $3, $4)`, [
                        modelResult.rows[0].id,
                        result.benchmarkType,
                        result.score,
                        JSON.stringify(result.details),
                    ]);
                    // Update model quality score (weighted average)
                    await pool.query(`UPDATE model_profiles SET
              quality_score = (
                SELECT AVG(score) FROM benchmark_results
                WHERE model_id = $1 AND run_at > NOW() - INTERVAL '7 days'
              ),
              avg_latency_ms = $2,
              updated_at = NOW()
            WHERE id = $1`, [modelResult.rows[0].id, result.latencyMs]);
                }
            }
            catch (error) {
                logger.error({ err: error }, 'Failed to store benchmark result');
            }
        }
    }
    startScheduled(intervalMs = 24 * 60 * 60 * 1000) {
        logger.info({ intervalMs }, 'Starting scheduled benchmarks');
        this.interval = setInterval(() => {
            this.runBenchmarks().catch((err) => {
                logger.error({ err }, 'Scheduled benchmark failed');
            });
        }, intervalMs);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
//# sourceMappingURL=benchmark.service.js.map