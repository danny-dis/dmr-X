/**
 * lm-evaluation-harness Bridge
 * 
 * Spawns the Python lm-evaluation-harness as a subprocess to run standardized
 * benchmarks (MMLU-Pro, GPQA, ARC, HellaSwag, etc.) against models accessible
 * through the DMR-X gateway.
 * 
 * This is OPTIONAL — the harness is only active when:
 *   1. Python 3.10+ with `lm-eval` is installed
 *   2. DMRX_BENCHMARK_LM_HARNESS_ENABLED=true is set
 * 
 * Usage in benchmark.service.ts:
 *   const runner = new LmHarnessRunner({ gatewayUrl: 'http://localhost:3000' });
 *   const result = await runner.runTask('gpqa', { model: 'gpt-4o', provider: 'openai' });
 */

import { spawn } from 'node:child_process';
import { logger } from '@dmr-x/utils';

export interface LmHarnessConfig {
  gatewayUrl: string;
  pythonPath?: string;       // Default: 'python3' (Windows: 'python')
  lmEvalPath?: string;       // Default: 'lm-eval' (via pip)
  timeoutMs?: number;        // Default: 600_000 (10 min)
}

export interface LmHarnessModelConfig {
  model: string;             // Model name (e.g. 'gpt-4o')
  provider: string;          // DMR-X provider name
  maxTokens?: number;        // Default: 2048
  batchSize?: number;        // Default: 1 (auto for local models)
}

export interface LmHarnessTaskResult {
  taskName: string;
  model: string;
  provider: string;
  results: Record<string, number>;  // e.g. { 'acc': 0.85, 'acc_norm': 0.82 }
  metrics: {
    meanScore: number;
    stderr: number;
    sampleCount: number;
  };
  durationMs: number;
  error?: string;
}

export const STANDARD_TASKS = {
  /** Graduate-level STEM reasoning (PhD-level) */
  gpqa: { name: 'gpqa', description: 'PhD-level science reasoning', category: 'reasoning' },
  /** Massive Multitask Language Understanding (expanded) */
  mmlu_pro: { name: 'mmlu_pro', description: 'Multitask knowledge (57 subjects)', category: 'knowledge' },
  /** AI2 Reasoning Challenge (science questions) */
  arc_challenge: { name: 'arc_challenge', description: 'Grade-school science reasoning', category: 'reasoning' },
  /** HellaSwag (commonsense inference) */
  hellaswag: { name: 'hellaswag', description: 'Commonsense inference', category: 'reasoning' },
  /** TruthfulQA (truthfulness) */
  truthfulqa: { name: 'truthfulqa', description: 'Truthfulness and honesty', category: 'safety' },
  /** GSM8K (grade-school math) */
  gsm8k: { name: 'gsm8k', description: 'Grade-school math word problems', category: 'reasoning' },
  /** BIG-Bench Hard (challenging reasoning) */
  bb_hard: { name: 'bb_hard', description: 'Challenging BIG-Bench tasks', category: 'reasoning' },
} as const;

export type StandardTaskKey = keyof typeof STANDARD_TASKS;

export class LmHarnessRunner {
  private config: Required<LmHarnessConfig>;

  constructor(config: LmHarnessConfig) {
    this.config = {
      gatewayUrl: config.gatewayUrl,
      pythonPath: config.pythonPath ?? (process.platform === 'win32' ? 'python' : 'python3'),
      lmEvalPath: config.lmEvalPath ?? 'lm-eval',
      timeoutMs: config.timeoutMs ?? 600_000,
    };
  }

  /**
   * Run a single lm-evaluation-harness task.
   * 
   * @param task - Task name (e.g. 'gpqa', 'mmlu_pro') or custom name
   * @param modelConfig - Model endpoint configuration
   * @returns Parsed results from the harness
   */
  async runTask(
    task: string,
    modelConfig: LmHarnessModelConfig,
  ): Promise<LmHarnessTaskResult> {
    const start = Date.now();
    const modelUrl = `${this.config.gatewayUrl}/v1/chat/completions`;

    // Build the lm-eval command:
    //   lm-eval --model local-completions --model_args url={url},model={model},max_tokens={tokens}
    //           --tasks {task} --output_path {temp} --log_samples
    const modelArgs = [
      `url=${modelUrl}`,
      `model=${modelConfig.model}`,
      `max_tokens=${modelConfig.maxTokens ?? 2048}`,
      `batch_size=${modelConfig.batchSize ?? 1}`,
    ];

    const args = [
      '--model', 'local-completions',
      '--model_args', modelArgs.join(','),
      '--tasks', task,
      '--output_path', `lm-harness-results-${task}-${Date.now()}`,
      '--log_samples',
      '--verbosity', 'ERROR',
    ];

    logger.info({ task, model: modelConfig.model, provider: modelConfig.provider },
      'Launching lm-evaluation-harness task');

    try {
      const output = await this.spawnLmEval(args);
      const parsed = this.parseOutput(output, task);
      const durationMs = Date.now() - start;

      if (!parsed) {
        return {
          taskName: task,
          model: modelConfig.model,
          provider: modelConfig.provider,
          results: {},
          metrics: { meanScore: 0, stderr: 0, sampleCount: 0 },
          durationMs,
          error: 'Failed to parse lm-eval output',
        };
      }

      return {
        taskName: task,
        model: modelConfig.model,
        provider: modelConfig.provider,
        results: parsed.results,
        metrics: parsed.metrics,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      logger.error({ err, task }, 'lm-evaluation-harness task failed');
      return {
        taskName: task,
        model: modelConfig.model,
        provider: modelConfig.provider,
        results: {},
        metrics: { meanScore: 0, stderr: 0, sampleCount: 0 },
        durationMs,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Run a suite of standard benchmark tasks against a model.
   */
  async runStandardSuite(
    modelConfig: LmHarnessModelConfig,
    tasks: StandardTaskKey[] = Object.keys(STANDARD_TASKS) as StandardTaskKey[],
  ): Promise<Record<string, LmHarnessTaskResult>> {
    const results: Record<string, LmHarnessTaskResult> = {};

    for (const key of tasks) {
      const taskInfo = STANDARD_TASKS[key];
      if (!taskInfo) continue;

      const result = await this.runTask(taskInfo.name, modelConfig);
      results[key] = result;
    }

    return results;
  }

  /**
   * Check if lm-evaluation-harness is available on this system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.spawnLmEval(['--help']);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private spawnLmEval(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.pythonPath, ['-m', this.config.lmEvalPath, ...args], {
        timeout: this.config.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`lm-eval exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start lm-eval: ${err.message}`));
      });
    });
  }

  private parseOutput(output: string, taskName: string): {
    results: Record<string, number>;
    metrics: { meanScore: number; stderr: number; sampleCount: number };
  } | null {
    try {
      // lm-eval outputs JSON results at the end
      const lines = output.split('\n');
      const jsonLine = lines.find(l => l.trim().startsWith('{') && l.includes(taskName));

      if (!jsonLine) return null;

      const parsed = JSON.parse(jsonLine);
      const taskResults = parsed.results?.[taskName];

      if (!taskResults) return null;

      // Extract metrics (varies by task — common ones: acc, acc_norm, f1, exact_match, bleu)
      const results: Record<string, number> = {};
      for (const [key, val] of Object.entries(taskResults)) {
        if (typeof val === 'number' && key !== 'alias') {
          results[key] = val;
        }
      }

      const scores = Object.values(results).filter(v => v >= 0 && v <= 1);
      const meanScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      return {
        results,
        metrics: {
          meanScore: Math.round(meanScore * 1000) / 1000,
          stderr: taskResults.stderr ?? 0,
          sampleCount: taskResults.samples ?? 0,
        },
      };
    } catch {
      return null;
    }
  }
}
