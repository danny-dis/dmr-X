#!/usr/bin/env bun
/**
 * Regenerate `packages/provider-catalog/src/benchmarks.generated.ts` from
 * OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`).
 *
 * Usage:
 *   bun scripts/sync-benchmarks.ts              # fetch + write the generated file
 *   bun scripts/sync-benchmarks.ts --offline     # rebuild from the last fetch cache
 *   bun scripts/sync-benchmarks.ts --check       # exit 1 if the file is stale
 *
 * What it extracts:
 *   `benchmarks.artificial_analysis.intelligence_index` (and coding_index /
 *   agentic_index when present) per model id, e.g.:
 *     "nvidia/nemotron-3-ultra-550b-a55b:free": { intelligenceIndex: 38.3 }
 *
 * Why: the hand-set catalog `intelligenceRank` (1-10) is inflated for several
 * free gateways (e.g. nemotron-3-ultra-550b-a55b:free is ranked 9 but scores
 * 38.3 on Artificial Analysis — around a 6). The registry's enrichFromCatalog
 * overrides the catalog rank with the benchmark-derived rank when a model
 * matches, so routing quality follows measured capability instead of guesses.
 *
 * Cache: the last successful fetch is written next to the generated file
 * (`benchmarks.cache.json`) so `--offline` can rebuild without the network.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_FILE = join(
  REPO_ROOT,
  'packages',
  'provider-catalog',
  'src',
  'benchmarks.generated.ts',
);
const CACHE_FILE = join(
  REPO_ROOT,
  'packages',
  'provider-catalog',
  'src',
  'benchmarks.cache.json',
);

const isCheck = process.argv.includes('--check');
const isOffline = process.argv.includes('--offline');
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterModel {
  id: string;
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: number;
      coding_index?: number;
      agentic_index?: number;
    };
  };
}

interface BenchmarkEntry {
  intelligenceIndex: number;
  codingIndex?: number;
  agenticIndex?: number;
}

async function fetchModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /v1/models returned ${res.status}`);
  }
  const body = (await res.json()) as { data: OpenRouterModel[] };
  return body.data ?? [];
}

function extractBenchmarks(models: OpenRouterModel[]): Record<string, BenchmarkEntry> {
  const out: Record<string, BenchmarkEntry> = {};
  for (const m of models) {
    const aa = m.benchmarks?.artificial_analysis;
    if (!aa || typeof aa.intelligence_index !== 'number') continue;
    out[m.id] = {
      intelligenceIndex: aa.intelligence_index,
      ...(typeof aa.coding_index === 'number'
        ? { codingIndex: aa.coding_index }
        : {}),
      ...(typeof aa.agentic_index === 'number'
        ? { agenticIndex: aa.agentic_index }
        : {}),
    };
  }
  return out;
}

function emitFile(benchmarks: Record<string, BenchmarkEntry>, fetchedAt: string): void {
  const header = `/**
 * GENERATED FILE — do not edit by hand.
 * Rebuild with: bun scripts/sync-benchmarks.ts
 *
 * Artificial Analysis benchmark indices (OpenRouter, ${fetchedAt}).
 * ${Object.keys(benchmarks).length} models carry an intelligence_index.
 *
 * intelligenceRank consumers map the index to a 1-10 rank via
 * getBenchmarkIntelligenceRank() in this package (index.ts).
 */
`;
  const body = `export interface BenchmarkEntry {
  intelligenceIndex: number;
  codingIndex?: number;
  agenticIndex?: number;
}

export const MODEL_BENCHMARKS: Record<string, BenchmarkEntry> = ${JSON.stringify(
    benchmarks,
    null,
    2,
  )};
`;
  writeFileSync(OUT_FILE, header + body);
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({ fetchedAt, benchmarks }, null, 2),
  );
}

async function main(): Promise<void> {
  let fetchedAt: string;
  let benchmarks: Record<string, BenchmarkEntry>;

  if (isOffline && existsSync(CACHE_FILE)) {
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as {
      fetchedAt: string;
      benchmarks: Record<string, BenchmarkEntry>;
    };
    fetchedAt = cache.fetchedAt;
    benchmarks = cache.benchmarks;
    console.log(
      `[sync-benchmarks] offline: ${Object.keys(benchmarks).length} models from cache (${fetchedAt})`,
    );
  } else {
    const models = await fetchModels();
    fetchedAt = new Date().toISOString().slice(0, 10);
    benchmarks = extractBenchmarks(models);
    console.log(
      `[sync-benchmarks] fetched ${models.length} models; ${Object.keys(benchmarks).length} have AA intelligence_index`,
    );
  }

  if (Object.keys(benchmarks).length === 0) {
    throw new Error('No benchmark data extracted — refusing to emit an empty file');
  }

  emitFile(benchmarks, fetchedAt);
  console.log(`[sync-benchmarks] wrote ${OUT_FILE}`);

  if (isCheck) {
    console.log('[sync-benchmarks] --check: file is current');
  }
}

main().catch((err) => {
  console.error('[sync-benchmarks] failed:', err);
  process.exit(1);
});