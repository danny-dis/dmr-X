import type { CandidateSet } from '@dmr-x/core';

/**
 * Helper function to filter free candidates.
 * Uses unified pricing tier if available, falls back to cost-based check.
 */
const isFree = (c: any) => {
  if (c.pricingTier) {
    return c.pricingTier === 'free' || c.pricingTier === 'free_with_limits';
  }
  return (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0;
};

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
  // --- Auto Models (all providers by default) ---
  {
    alias: 'auto',
    description: 'Auto-pick the best model. Routes through all providers by default (use costFilter=free for free-only). Preserves original order — the pipeline scoring decides the best choice.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      if (filter === 'all') return candidates;
      return candidates.filter(isFree);
    },
  },
  {
    alias: 'auto-fast',
    description: 'Fastest model. Routes through all providers by default (use costFilter=free for free-only). Explicitly prioritizes low latency.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool.sort((a, b) => (a.avgLatencyMs ?? 9999) - (b.avgLatencyMs ?? 9999));
    },
  },
  {
    alias: 'auto-smart',
    description: 'Most capable model. Routes through all providers by default (use costFilter=free for free-only). Explicitly prioritizes intelligence.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
    },
  },
  {
    alias: 'auto-agentic',
    description: 'Best model for agentic/tool-calling work. Routes through all providers by default (use costFilter=free for free-only). Requires tool_use capability and 64K+ context. Scores by quality (40%) + tool capabilities (30%) + context window (20%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 64000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c =>
          c.capabilities.includes('tool_use') &&
          (c.contextLength ?? 0) >= MIN_CONTEXT
        )
        .map(c => {
          // Tool capability bonus: reward json_mode and streaming too
          const toolBonus = 1 + (c.capabilities.includes('json_mode') ? 0.2 : 0) + (c.capabilities.includes('streaming') ? 0.1 : 0);
          const qualityComponent = (c.qualityScore ?? 0) * 0.4;
          const toolComponent = toolBonus * 0.3;
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, agenticScore: qualityComponent + toolComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.agenticScore - a.agenticScore);

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
      const codeCapabilities = ['tool_use', 'streaming', 'reasoning', 'json_mode'];
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT)
        .map(c => {
          // Specialization match: how many code-related capabilities the model has
          const specMatch = codeCapabilities.filter(cap => c.capabilities.includes(cap)).length / codeCapabilities.length;
          const qualityComponent = (c.qualityScore ?? 0) * 0.3;
          const specComponent = specMatch * 0.4;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, codingScore: qualityComponent + specComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.codingScore - a.codingScore);

      return scored.map(({ codingScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-reasoning',
    description: 'Best model for reasoning, math, and chain-of-thought tasks. Routes through all providers by default (use costFilter=free for free-only). Requires reasoning capability and 32K+ context. Scores by quality (45%) + reasoning (30%) + context (15%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 32000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c =>
          c.capabilities.includes('reasoning') &&
          (c.contextLength ?? 0) >= MIN_CONTEXT
        )
        .map(c => {
          const qualityComponent = (c.qualityScore ?? 0) * 0.45;
          const reasoningComponent = 1 * 0.3; // Already filtered, so reward full weight
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.15;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, reasoningScore: qualityComponent + reasoningComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.reasoningScore - a.reasoningScore);

      return scored.map(({ reasoningScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-vision',
    description: 'Best model for multimodal vision tasks (image analysis, OCR, document understanding). Routes through all providers by default (use costFilter=free for free-only). Requires vision capability. Scores by quality (45%) + vision (25%) + context (15%) + speed (15%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c => c.capabilities.includes('vision'))
        .map(c => {
          const qualityComponent = (c.qualityScore ?? 0) * 0.45;
          const visionComponent = 1 * 0.25; // Already filtered
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.15;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.15;
          return { ...c, visionScore: qualityComponent + visionComponent + speedComponent + contextComponent };
        })
        .sort((a, b) => b.visionScore - a.visionScore);

      return scored.map(({ visionScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-eco',
    description: 'Cheapest possible model (eco profile). Routes through all providers by default (use costFilter=free for free-only). Prioritizes free models first, then cheapest paid models, with quality as tiebreaker.',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool.sort((a, b) => {
        // First: free models come first
        const aFree = isFree(a);
        const bFree = isFree(b);
        if (aFree !== bFree) return bFree ? 1 : -1;
        
        // Then: cheapest cost
        const costA = (a.costPerInputToken ?? 0) + (a.costPerOutputToken ?? 0);
        const costB = (b.costPerInputToken ?? 0) + (b.costPerOutputToken ?? 0);
        if (costA !== costB) return costA - costB;
        
        // Finally: quality as tiebreaker
        return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      });
    },
  },
  {
    alias: 'auto-cheap',
    description: 'Cheapest model available - alias for auto-eco. Routes through all providers by default (use costFilter=free for free-only).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool.sort((a, b) => {
        // First: free models come first
        const aFree = isFree(a);
        const bFree = isFree(b);
        if (aFree !== bFree) return bFree ? 1 : -1;
        
        // Then: cheapest cost
        const costA = (a.costPerInputToken ?? 0) + (a.costPerOutputToken ?? 0);
        const costB = (b.costPerInputToken ?? 0) + (b.costPerOutputToken ?? 0);
        if (costA !== costB) return costA - costB;
        
        // Finally: quality as tiebreaker
        return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      });
    },
  },
  {
    alias: 'auto-premium',
    description: 'Best quality model (premium profile) - alias for auto-smart. Routes through all providers by default (use costFilter=free for free-only).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
    },
  },
  {
    alias: 'auto-agentic',
    description: 'Best model for agentic/tool-calling work. Routes through all providers by default (use costFilter=free for free-only). Requires tool_use capability. Scores by quality (40%) + tool capabilities (30%) + context window (20%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 64000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c =>
          c.capabilities.includes('tool_use')
        )
        .map(c => {
          // Tool capability bonus: reward json_mode, streaming, and reasoning
          const toolBonus = 1 + 
            (c.capabilities.includes('json_mode') ? 0.2 : 0) + 
            (c.capabilities.includes('streaming') ? 0.1 : 0) +
            (c.capabilities.includes('reasoning') ? 0.2 : 0);
          const qualityComponent = (c.qualityScore ?? 0) * 0.4;
          const toolComponent = toolBonus * 0.3;
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, agenticScore: qualityComponent + toolComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.agenticScore - a.agenticScore);

      return scored.map(({ agenticScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-long-context',
    description: 'Best model for long document processing. Routes through all providers by default (use costFilter=free for free-only). Requires 128K+ context window. Scores by context size (45%) + quality (35%) + speed (20%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 128000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool
        .filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT)
        .map(c => {
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.45;
          const qualityComponent = (c.qualityScore ?? 0) * 0.35;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.2;
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
    ranker: (candidates) => candidates.filter(isFree),
  },
  // --- Free Models (backward compatibility - same as auto-* but always free) ---
  {
    alias: 'free',
    description: 'Any free model (preserves original order)',
    costFilter: 'free',
    ranker: (candidates) => candidates.filter(isFree),
  },
  {
    alias: 'free-fast',
    description: 'Fastest free model',
    costFilter: 'free',
    ranker: (candidates) => {
      const pool = candidates.filter(isFree);
      return pool.sort((a, b) => (a.avgLatencyMs ?? 9999) - (b.avgLatencyMs ?? 9999));
    },
  },
  {
    alias: 'free-smart',
    description: 'Most capable free model',
    costFilter: 'free',
    ranker: (candidates) => {
      const pool = candidates.filter(isFree);
      return pool.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
    },
  },
  {
    alias: 'free-agentic',
    description: 'Best free model for tool use. Requires tool_use capability. Scores by quality (40%) + tool capabilities (30%) + context window (20%) + speed (10%).',
    costFilter: 'free',
    ranker: (candidates) => {
      const scored = candidates
        .filter(c =>
          c.capabilities.includes('tool_use')
        )
        .map(c => {
          const toolBonus = 1 + 
            (c.capabilities.includes('json_mode') ? 0.2 : 0) + 
            (c.capabilities.includes('streaming') ? 0.1 : 0) +
            (c.capabilities.includes('reasoning') ? 0.2 : 0);
          const qualityComponent = (c.qualityScore ?? 0) * 0.4;
          const toolComponent = toolBonus * 0.3;
          const contextComponent = Math.min((c.contextLength ?? 0) / 1_000_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, agenticScore: qualityComponent + toolComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.agenticScore - a.agenticScore);

      return scored.map(({ agenticScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'free-coding',
    description: 'Best free model for code generation',
    costFilter: 'free',
    ranker: (candidates) => {
      const MIN_CONTEXT = 32000;
      const codeCapabilities = ['tool_use', 'streaming', 'reasoning', 'json_mode'];
      const pool = candidates.filter(isFree);
      const scored = pool
        .filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT)
        .map(c => {
          const specMatch = codeCapabilities.filter(cap => c.capabilities.includes(cap)).length / codeCapabilities.length;
          const qualityComponent = (c.qualityScore ?? 0) * 0.3;
          const specComponent = specMatch * 0.4;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.2;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.1;
          return { ...c, codingScore: qualityComponent + specComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.codingScore - a.codingScore);

      return scored.map(({ codingScore: _, ...rest }) => rest);
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
