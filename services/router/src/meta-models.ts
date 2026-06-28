import type { CandidateSet } from '@dmr-x/core';

/**
 * Meta-model aliases for dynamic routing.
 * These map to the best available provider at request time.
 * Default costFilter is 'all' (all providers, paid + free).
 * Override with costFilter='free' to restrict to zero-cost providers only.
 */
export interface MetaModelDefinition {
  alias: string;
  description: string;
  /** Cost filter mode: 'free' routes through zero-cost providers only, 'all' routes through all providers */
  costFilter: 'free' | 'all';
  /** Function that ranks candidates for this meta-model */
  ranker: (candidates: CandidateSet, costFilter?: 'free' | 'all') => CandidateSet;
}

export const META_MODELS: MetaModelDefinition[] = [
  {
    alias: 'auto',
    description: 'Auto-pick the best model. Routes through all providers by default (use costFilter=free for free-only). Preserves original order — the pipeline scoring decides the best choice.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      if (filter === 'all') return candidates;
      return candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
    },
  },
  {
    alias: 'auto-fast',
    description: 'Fastest model. Routes through all providers by default (use costFilter=free for free-only). Explicitly prioritizes low latency.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      return pool.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
    },
  },
  {
    alias: 'auto-smart',
    description: 'Most capable model. Routes through all providers by default (use costFilter=free for free-only). Explicitly prioritizes intelligence.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      return pool.sort((a, b) => b.qualityScore - a.qualityScore);
    },
  },
  {
    alias: 'auto-agentic',
    description: 'Best model for agentic/tool-calling work. Routes through all providers by default (use costFilter=free for free-only). Requires tool_use capability and 64K+ context. Scores by quality (50%) + context window (30%) + speed (20%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 64000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      const scored = pool
        .filter(c =>
          c.capabilities.includes('tool_use') &&
          (c.contextLength ?? 0) >= MIN_CONTEXT
        )
        .map(c => {
          const qualityComponent = c.qualityScore * 0.5;
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.3;
          const speedComponent = Math.max(0, 1 - c.avgLatencyMs / 5000) * 0.2;
          return { ...c, agenticScore: qualityComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.agenticScore - a.agenticScore);

      // Strip the internal scoring field before returning
      return scored.map(({ agenticScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-coding',
    description: 'Best model for code generation. Routes through all providers by default (use costFilter=free for free-only). Scores by specialization match (40%) + quality (30%) + context window (20%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 32000;
      const codeCapabilities = ['tool_use', 'streaming', 'reasoning'];
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      const scored = pool
        .filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT)
        .map(c => {
          // Specialization match: how many code-related capabilities the model has
          const specMatch = codeCapabilities.filter(cap => c.capabilities.includes(cap)).length / codeCapabilities.length;

          const qualityComponent = c.qualityScore * 0.3;
          const specComponent = specMatch * 0.4;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - c.avgLatencyMs / 5000) * 0.1;
          return { ...c, codingScore: qualityComponent + specComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.codingScore - a.codingScore);

      // Strip the internal scoring field before returning
      return scored.map(({ codingScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-reasoning',
    description: 'Best model for reasoning, math, and chain-of-thought tasks. Routes through all providers by default (use costFilter=free for free-only). Requires reasoning capability and 32K+ context. Scores by quality (40%) + reasoning capability (30%) + context window (20%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 32000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      const scored = pool
        .filter(c =>
          c.capabilities.includes('reasoning') &&
          (c.contextLength ?? 0) >= MIN_CONTEXT
        )
        .map(c => {
          const qualityComponent = c.qualityScore * 0.4;
          const reasoningComponent = (c.capabilities.includes('reasoning') ? 1 : 0) * 0.3;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - c.avgLatencyMs / 5000) * 0.1;
          return { ...c, reasoningScore: qualityComponent + reasoningComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.reasoningScore - a.reasoningScore);

      return scored.map(({ reasoningScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-vision',
    description: 'Best model for multimodal vision tasks (image analysis, OCR, document understanding). Routes through all providers by default (use costFilter=free for free-only). Requires vision capability. Scores by quality (50%) + vision capability (25%) + speed (15%) + context (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      const scored = pool
        .filter(c => c.capabilities.includes('vision'))
        .map(c => {
          const qualityComponent = c.qualityScore * 0.5;
          const visionComponent = (c.capabilities.includes('vision') ? 1 : 0) * 0.25;
          const speedComponent = Math.max(0, 1 - c.avgLatencyMs / 5000) * 0.15;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.1;
          return { ...c, visionScore: qualityComponent + visionComponent + speedComponent + contextComponent };
        })
        .sort((a, b) => b.visionScore - a.visionScore);

      return scored.map(({ visionScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-cheap',
    description: 'Cheapest model available. Routes through all providers by default (use costFilter=free for free-only). Sorts by total cost (input + output) ascending, with quality as a tiebreaker.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      return [...pool].sort((a, b) => {
        const costA = (a.costPerInputToken ?? 0) + (a.costPerOutputToken ?? 0);
        const costB = (b.costPerInputToken ?? 0) + (b.costPerOutputToken ?? 0);
        if (costA !== costB) return costA - costB;
        return b.qualityScore - a.qualityScore;
      });
    },
  },
  {
    alias: 'auto-long-context',
    description: 'Best model for long document processing. Routes through all providers by default (use costFilter=free for free-only). Requires 128K+ context window. Scores by context size (50%) + quality (30%) + speed (20%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 128000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
      const scored = pool
        .filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT)
        .map(c => {
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.5;
          const qualityComponent = c.qualityScore * 0.3;
          const speedComponent = Math.max(0, 1 - c.avgLatencyMs / 5000) * 0.2;
          return { ...c, longContextScore: contextComponent + qualityComponent + speedComponent };
        })
        .sort((a, b) => b.longContextScore - a.longContextScore);

      return scored.map(({ longContextScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-free',
    description: 'Best free model. Always routes through zero-cost providers only (costFilter override ignored). Preserves original order — the pipeline scoring decides the best choice.',
    costFilter: 'free',
    ranker: (candidates) => {
      return candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
    },
  },
];

/**
 * Check if a model string is a meta-model alias.
 */
export function isMetaModel(model: string): boolean {
  return META_MODELS.some(m => m.alias === model);
}

/**
 * Resolve a meta-model alias to the best available candidate.
 * Returns null if the model is not a meta-model or no candidates match.
 *
 * @param costFilterOverride - Override the meta-model's default cost filter ('all' or 'free').
 *   When 'free', the ranker filters to zero-cost providers only.
 *   When 'all', the ranker considers all providers (paid + free).
 *   Defaults to the meta-model's `costFilter` field when not provided.
 */
export function resolveMetaModel(
  model: string,
  candidates: CandidateSet,
  costFilterOverride?: 'free' | 'all'
): { resolved: CandidateSet; metaModel: MetaModelDefinition; costFilter: 'free' | 'all' } | null {
  const metaModel = META_MODELS.find(m => m.alias === model);
  if (!metaModel) return null;

  const effectiveFilter = costFilterOverride ?? metaModel.costFilter;
  const ranked = metaModel.ranker(candidates, effectiveFilter);
  if (ranked.length === 0) return null;

  return { resolved: ranked, metaModel, costFilter: effectiveFilter };
}