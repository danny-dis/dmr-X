import type { CandidateSet } from '@dmr-x/core';

/**
 * Meta-model aliases for free tier routing.
 * These map to the best available provider at request time.
 */
export interface MetaModelDefinition {
  alias: string;
  description: string;
  /** Function that ranks candidates for this meta-model */
  ranker: (candidates: CandidateSet) => CandidateSet;
}

export const META_MODELS: MetaModelDefinition[] = [
  {
    alias: 'free',
    description: 'Any free model. Filters to zero-cost providers without re-ranking — the normal pipeline scoring decides the best choice.',
    ranker: (candidates) => {
      return candidates.filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0);
    },
  },
  {
    alias: 'free-fast',
    description: 'Fastest free model. Explicitly prioritizes low latency.',
    ranker: (candidates) => {
      return [...candidates]
        .filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0)
        .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
    },
  },
  {
    alias: 'free-smart',
    description: 'Most capable free model. Explicitly prioritizes intelligence.',
    ranker: (candidates) => {
      return [...candidates]
        .filter(c => (c.costPerInputToken ?? 0) <= 0 && (c.costPerOutputToken ?? 0) <= 0)
        .sort((a, b) => b.qualityScore - a.qualityScore);
    },
  },
  {
    alias: 'free-agentic',
    description: 'Best free model for agentic/tool-calling work. Requires tool_use capability and 64K+ context. Scores by quality (50%) + context window (30%) + speed (20%). No hard-coded models — dynamically picks from whatever free providers are available.',
    ranker: (candidates) => {
      const MIN_CONTEXT = 64000;
      const scored = candidates
        .filter(c =>
          (c.costPerInputToken ?? 0) <= 0 &&
          (c.costPerOutputToken ?? 0) <= 0 &&
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
    alias: 'free-coding',
    description: 'Best free model for code generation. Scores by specialization match (40%) + quality (30%) + context window (20%) + speed (10%). Prefers models with code-related capabilities and larger context windows.',
    ranker: (candidates) => {
      const MIN_CONTEXT = 32000;
      const codeCapabilities = ['tool_use', 'streaming', 'reasoning'];

      const scored = candidates
        .filter(c =>
          (c.costPerInputToken ?? 0) <= 0 &&
          (c.costPerOutputToken ?? 0) <= 0 &&
          (c.contextLength ?? 0) >= MIN_CONTEXT
        )
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
 */
export function resolveMetaModel(
  model: string,
  candidates: CandidateSet
): { resolved: CandidateSet; metaModel: MetaModelDefinition } | null {
  const metaModel = META_MODELS.find(m => m.alias === model);
  if (!metaModel) return null;

  const ranked = metaModel.ranker(candidates);
  if (ranked.length === 0) return null;

  return { resolved: ranked, metaModel };
}
