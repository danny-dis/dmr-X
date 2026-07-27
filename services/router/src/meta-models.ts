import type { CandidateSet } from '@dmr-x/core';

/**
 * Helper function to filter free candidates.
 * Uses unified pricing tier if available, falls back to cost-based check.
 *
 * A provider is treated as free when ANY of:
 *  - its unified pricingTier is free / free_with_limits,
 *  - the catalog exposes free-tier metadata (intelligenceRank/speedRank),
 *  - its effective per-token cost is zero, or
 *  - the operator explicitly declares it free via DMRX_FREE_PROVIDERS
 *    (the common case where every configured API key is a free-tier key,
 *    so the catalog's nominal "paid" tier is irrelevant to actual usage).
 */
const FREE_PROVIDERS_ENV = (process.env.DMRX_FREE_PROVIDERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Free means "known to cost nothing", never "we have no price".
 *
 * Most provider /v1/models endpoints publish no pricing at all, so live
 * discovery stores 0 for cost — which is indistinguishable from a genuinely
 * free model. Treating a bare 0 as free made every discovered model qualify
 * and turned the free-only aliases (`free`, `auto-eco`, `free-*`) into
 * no-ops that happily routed to paid models.
 *
 * A zero cost only counts as free when something corroborates it: an explicit
 * pricing tier, free-tier metadata from the catalog, a `:free` model id, or an
 * operator-declared free provider via DMRX_FREE_PROVIDERS.
 */
/**
 * Speed prior for a candidate with no measured latency yet, in the same 0-1
 * space as the measured term (1 = fastest).
 *
 * Providers do not publish latency, so it cannot be discovered — but the
 * capability tier and the vendor's own size/speed naming ("flash", "lite",
 * "mini", "turbo") are strong signals, and both are already derived from
 * discovered data rather than hand-maintained per-model tables.
 */
const speedPrior = (c: any): number => {
  const id = String(c.modelId ?? '').toLowerCase();
  if (/flash-lite|nano|mini|tiny|-8b|1b|3b/.test(id)) return 0.95;
  if (/flash|lite|turbo|fast|instant|haiku|small/.test(id)) return 0.85;
  if (/pro|opus|large|ultra|405b|235b|70b/.test(id)) return 0.25;
  const tier = String(c.capabilityTier ?? '');
  if (tier === 'fast') return 0.85;
  if (tier === 'economy') return 0.8;
  if (tier === 'balanced') return 0.5;
  if (tier === 'strong') return 0.35;
  if (tier === 'frontier') return 0.2;
  return 0.5;
};

const isFree = (c: any) => {
  if (c.pricingTier === 'free' || c.pricingTier === 'free_with_limits') return true;
  if (c.freeTierMetadata) return true;
  if (FREE_PROVIDERS_ENV.includes(c.providerName) || FREE_PROVIDERS_ENV.includes(c.providerId)) return true;
  // Providers that namespace their free tier in the model id (OpenRouter's
  // `…:free`, opencode-zen's `…-free`).
  const id = String(c.modelId ?? '');
  if (/:free$|-free$/.test(id)) return true;
  return false;
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
  /**
   * When true, the resolved model is sent through the G0DM0D3 "godmode" proxy
   * (GODMODE/persona wrapping) instead of being called directly. The router
   * still picks the concrete model normally — only the call path changes.
   */
  godmode?: boolean;
}

/**
 * Look up a meta-model definition by alias (including its behavioral flags).
 */
export function getMetaModel(alias: string): MetaModelDefinition | undefined {
  return META_MODELS.find((m) => m.alias === alias);
}

export const META_MODELS: MetaModelDefinition[] = [
  // --- Auto Models (all providers by default) ---
  {
    alias: 'auto',
    description: 'Auto-pick the best model with cost-quality balance. Routes through all providers by default (use costFilter=free for free-only). Scores by quality (35%) + cost efficiency (30%) + speed (20%) + context (15%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool.map(c => {
        const qualityComponent = (c.qualityScore ?? 0) * 0.35;
        // Cost efficiency: cheaper models score higher (normalized to 0-1 range)
        const totalCost = (c.costPerInputToken ?? 0) + (c.costPerOutputToken ?? 0);
        const costComponent = Math.max(0, 1 - Math.min(totalCost * 1000, 1)) * 0.30;
        const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 2000) / 5000) * 0.20;
        const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.15;
        return { ...c, autoScore: qualityComponent + costComponent + speedComponent + contextComponent };
      });
      return scored.sort((a, b) => b.autoScore - a.autoScore).map(({ autoScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-fast',
    description: 'Fastest model with quality baseline. Routes through all providers by default (use costFilter=free for free-only). Requires 0.5+ quality score. Scores by speed (60%) + quality (25%) + cost efficiency (15%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_QUALITY = 0.5;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      // The quality floor is a preference, not a hard gate: applying it to an
      // empty-ish pool returned zero candidates and 502'd the request outright.
      const aboveFloor = pool.filter(c => (c.qualityScore ?? 0) >= MIN_QUALITY);
      const usable = aboveFloor.length > 0 ? aboveFloor : pool;

      const scored = usable
        .map(c => {
          // Prefer a measured latency. When none has been recorded yet, fall
          // back to the model's own speed signals rather than assuming the
          // 5000ms worst case — that made speedComponent 0 for every candidate
          // and left `auto-fast` ranking on quality alone, which is how it
          // ended up selecting a 25s model.
          const measured = c.avgLatencyMs;
          const speedComponent =
            typeof measured === 'number' && measured > 0
              ? Math.max(0, 1 - measured / 5000) * 0.6
              : speedPrior(c) * 0.6;
          const qualityComponent = (c.qualityScore ?? 0) * 0.25;
          const totalCost = (c.costPerInputToken ?? 0) + (c.costPerOutputToken ?? 0);
          const costComponent = Math.max(0, 1 - Math.min(totalCost * 1000, 1)) * 0.15;
          return { ...c, fastScore: speedComponent + qualityComponent + costComponent };
        })
        .sort((a, b) => b.fastScore - a.fastScore);
      return scored.map(({ fastScore: _, ...rest }) => rest);
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
    description: 'Best model for code generation. Routes through all providers by default (use costFilter=free for free-only). Scores by specialization match (35%) + quality (25%) + cost efficiency (20%) + context window (15%) + speed (5%).',
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
          const qualityComponent = (c.qualityScore ?? 0) * 0.25;
          const specComponent = specMatch * 0.35;
          const totalCost = (c.costPerInputToken ?? 0) + (c.costPerOutputToken ?? 0);
          const costComponent = Math.max(0, 1 - Math.min(totalCost * 1000, 1)) * 0.20;
          const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.15;
          const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 5000) / 5000) * 0.05;
          return { ...c, codingScore: qualityComponent + specComponent + costComponent + contextComponent + speedComponent };
        })
        .sort((a, b) => b.codingScore - a.codingScore);

      return scored.map(({ codingScore: _, ...rest }) => rest);
    },
  },
  {
    alias: 'auto-reasoning',
    description: 'Best model for reasoning, math, and chain-of-thought tasks. Routes through all providers by default (use costFilter=free for free-only). Prefers reasoning-capable models; falls back to the full capable pool if none are tagged. Scores by quality (45%) + reasoning (30%) + context (15%) + speed (10%).',
    costFilter: 'all',
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const MIN_CONTEXT = 32000;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      // Prefer reasoning-capable models, but never return an empty pool: some
      // model is always better at reasoning than another, so fall back to the
      // full context-qualified pool when the catalog has no reasoning tags.
      const reasoned = pool.filter(c =>
        c.capabilities.includes('reasoning') &&
        (c.contextLength ?? 0) >= MIN_CONTEXT
      );
      const effectivePool = reasoned.length > 0 ? reasoned : pool.filter(c => (c.contextLength ?? 0) >= MIN_CONTEXT);
      const scored = effectivePool
        .map(c => {
          const qualityComponent = (c.qualityScore ?? 0) * 0.45;
          const reasoningComponent = (c.capabilities.includes('reasoning') ? 1 : 0.6) * 0.3;
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
    description: 'Cheapest possible model (eco profile). Always routes through zero-cost providers only (free models first, then quality as tiebreaker). costFilter override ignored.',
    costFilter: 'free',
    ranker: (candidates) => {
      const MIN_QUALITY = 0.3;
      const pool = candidates.filter(isFree);
      return pool
        .filter(c => (c.qualityScore ?? 0) >= MIN_QUALITY)
        .sort((a, b) => {
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
      const MIN_QUALITY = 0.3;
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      return pool
        .filter(c => (c.qualityScore ?? 0) >= MIN_QUALITY)
        .sort((a, b) => {
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
    description: 'Auto freedom: the router resolves the best model normally (paid or free, standard scoring), then the chosen model is sent through the G0DM0D3 "godmode" proxy for persona wrapping. costFilter override is honored like any auto-* alias.',
    costFilter: 'all',
    godmode: true,
    ranker: (candidates, costFilterOverride) => {
      const filter = costFilterOverride ?? 'all';
      const pool = filter === 'all' ? [...candidates] : candidates.filter(isFree);
      const scored = pool.map(c => {
        const qualityComponent = (c.qualityScore ?? 0) * 0.35;
        const totalCost = (c.costPerInputToken ?? 0) + (c.costPerOutputToken ?? 0);
        const costComponent = Math.max(0, 1 - Math.min(totalCost * 1000, 1)) * 0.30;
        const speedComponent = Math.max(0, 1 - (c.avgLatencyMs ?? 2000) / 5000) * 0.20;
        const contextComponent = Math.min((c.contextLength ?? 0) / 256_000, 1) * 0.15;
        return { ...c, autoScore: qualityComponent + costComponent + speedComponent + contextComponent };
      });
      return scored.sort((a, b) => b.autoScore - a.autoScore).map(({ autoScore: _, ...rest }) => rest);
    },
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
): { resolved: CandidateSet; metaModel: MetaModelDefinition; costFilter: 'free' | 'all'; godmode: boolean } | null {
  const metaModel = META_MODELS.find(m => m.alias === model);
  if (!metaModel) return null;

  const effectiveFilter = costFilterOverride ?? metaModel.costFilter;
  const ranked = metaModel.ranker(candidates, effectiveFilter);
  if (ranked.length === 0) return null;

  return { resolved: ranked, metaModel, costFilter: effectiveFilter, godmode: Boolean(metaModel.godmode) };
}
