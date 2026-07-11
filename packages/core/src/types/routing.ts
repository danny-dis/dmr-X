import { Modality, IntelligenceLayer, CapabilityTier, QualityTarget, ArchitectureTier, ContextTier, DeploymentModel, ReasoningMode, SafetyTier, AgenticLevel } from './modality.js';

export type FreeTierStrategy = 'prioritize' | 'load_balance' | 'fallback' | 'none';

/**
 * Pipeline-level selection strategies (the engine's real union, mirroring
 * services/router/src/pipeline/pipeline.ts). The request-level
 * `RoutingStrategy` in provider-preferences.ts (`auto|direct|free|fallback|pareto`)
 * is a coarser concern; combos select among these concrete selectors.
 */
export type PipelineStrategy =
  | 'thompson'
  | 'least-busy'
  | 'usage-based'
  | 'latency-based'
  | 'cost-optimized'
  | 'round-robin'
  | 'weighted'
  | 'headroom'
  | 'priority'
  | 'context-optimized'
  | 'fusion';

/** Human-readable labels for each pipeline strategy — single source of truth for the UI. */
export const PIPELINE_STRATEGIES: { id: PipelineStrategy; label: string; description: string }[] = [
  { id: 'thompson', label: 'Adaptive (bandit)', description: 'Thompson-sampling bandit that learns which providers succeed.' },
  { id: 'least-busy', label: 'Least busy', description: 'Pick the provider with the most available capacity.' },
  { id: 'usage-based', label: 'Usage balanced', description: 'Spread load by recent usage volume.' },
  { id: 'latency-based', label: 'Lowest latency', description: 'Prefer the provider with the lowest estimated latency.' },
  { id: 'cost-optimized', label: 'Lowest cost', description: 'Prefer the cheapest provider per token.' },
  { id: 'round-robin', label: 'Round robin', description: 'Rotate evenly across healthy candidates.' },
  { id: 'weighted', label: 'Weighted random', description: 'Sample candidates by a quality/cost weight.' },
  { id: 'headroom', label: 'Headroom', description: 'Prefer providers with spare rate-limit headroom.' },
  { id: 'priority', label: 'Priority order', description: 'Follow the explicit provider ordering.' },
  { id: 'context-optimized', label: 'Context fit', description: 'Prefer the provider whose context window best fits the request.' },
  { id: 'fusion', label: 'Fusion', description: 'Combine signals (quality, cost, latency) into one score.' },
];

/**
 * A named, saveable routing strategy ("combo") surfaced in the UI.
 * Composes the engine's existing building blocks — no new routing logic.
 */
export interface RoutingCombo {
  id: string;
  name: string;
  /** Pipeline selector. */
  pipelineStrategy: PipelineStrategy;
  /** How free-tier providers participate. */
  freeTierStrategy: FreeTierStrategy;
  /** Target meta-model alias (e.g. 'free-coding') or 'any'. */
  target: string;
  /** Relative weights for the composite scorer. */
  weights: { quality: number; cost: number; latency: number };
  /** Allow fallback to other providers on failure. */
  fallbackEnabled: boolean;
  /** Only use these providers (optional). */
  only?: string[];
  /** Exclude these providers (optional). */
  ignore?: string[];
}

export type TurnType =
  | 'tool_use'
  | 'code_gen'
  | 'q_a'
  | 'creative'
  | 'summarization'
  | 'translation'
  | 'data_analysis'
  | 'general';

export interface TaskProfile {
  modality: Modality;
  capabilities: string[];
  sizeEstimate: {
    inputTokens?: number;
    outputTokensEst?: number;
    pixelCount?: number;
  };
  priority: number; // 1-10
  streaming: boolean;
  qualityTarget: QualityTarget;
  /** Required capability tier for routing (soft preference — boosts matching models) */
  requiredCapabilityTier?: CapabilityTier;
  /** Detected turn type for smarter routing decisions */
  turnType?: TurnType;
}

export interface ProviderModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modality: Modality;
  intelligenceLayer: IntelligenceLayer;
  capabilityTier: CapabilityTier;
  capabilities: string[];
  costPerInputToken: number;
  costPerOutputToken: number;
  costPerImage: number;
  /** Flat cost per video generation (for video modality models) */
  costPerVideo?: number;
  /** Cost per second of output video (alternative to costPerVideo for duration-based pricing) */
  costPerSecond?: number;
  /** Maximum supported video duration in seconds */
  maxDuration?: number;
  avgLatencyMs: number;
  qualityScore: number;
  isHealthy: boolean;
  compositeScore?: number;

  // 9-Dimension Taxonomy Fields
  /** Dimension 2: Model architecture (dense, moe, ssm, hybrid) */
  architectureTier?: ArchitectureTier;
  /** Dimension 3: Task categories (JSON array) */
  taskCategories?: string[];
  /** Dimension 5: Context window tier */
  contextTier?: ContextTier;
  /** Dimension 6: Deployment model */
  deployment?: DeploymentModel;
  /** Dimension 7: Reasoning mode */
  reasoningMode?: ReasoningMode;
  /** Dimension 8: Safety tier */
  safetyTier?: SafetyTier;
  /** Dimension 9: Agentic level */
  agenticLevel?: AgenticLevel;

  // Enriched metadata (optional, populated when available)
  /** Latency percentiles in ms over last 30 min */
  latencyPercentiles?: { p50: number; p75: number; p90: number; p95: number; p99: number };
  /** Throughput percentiles in tokens/sec over last 30 min */
  throughputPercentiles?: { p50: number; p75: number; p90: number; p95: number; p99: number };
  /** Uptime percentage (0-100) over last 5 min */
  uptime5m?: number;
  /** Uptime percentage (0-100) over last 30 min */
  uptime30m?: number;
  /** Uptime percentage (0-100) over last 1 day */
  uptime1d?: number;
  /** Quantization level of the model weights */
  quantization?: string;
  /** Maximum context length in tokens */
  contextLength?: number;
  /** Maximum output tokens for this model */
  maxOutputTokens?: number;
  /** Supported parameter names (e.g., 'tools', 'response_format') */
  supportedParameters?: string[];
  /** Free-tier metadata from provider catalog (populated when available) */
  freeTierMetadata?: {
    intelligenceRank: number;  // 1-10 scale from catalog
    speedRank: number;         // 1-10 scale from catalog
    monthlyTokenBudget: number;
    rateLimits: { rpm: number; rpd: number; tpm: number; tpd: number };
  };
  /** If true, this model is only available via OAuth subscription auth (not API key) */
  subscriptionOnly?: boolean;
  /** Unified pricing classification: 'free' | 'free_with_limits' | 'paid' | 'subscription_only' | 'unknown' */
  pricingTier?: string;
  /** Multi-binding model catalog — alternative provider bindings for cross-binding failover */
  bindings?: ModelBinding;
}

export type CandidateSet = ProviderModel[];

export interface SelectedProvider {
  providerId: string;
  modelId: string;
  adapterType: string;
  score: number;
}

export type FallbackTrigger = 'timeout' | 'error' | 'rate_limit' | 'quality_reject';

export interface FallbackStep {
  provider: SelectedProvider;
  trigger: FallbackTrigger;
  waitMs: number;
}

export interface RoutingPlan {
  primary: SelectedProvider;
  chain: FallbackStep[];
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Multi-Binding Model Catalog
 *
 * Each model can list multiple provider bindings with ordering.
 * Cross-binding failover tries the next binding when all retries on
 * the current binding are exhausted — not same-binding retry.
 */
export interface ModelBinding {
  /** Primary binding (the default provider for this model) */
  primary: BindingEntry;
  /** Ordered fallback bindings (tried when primary fails) */
  fallbacks: BindingEntry[];
  /** Cross-binding failover: if true, fallback across bindings (not same-binding retry) */
  crossBindingFailover: boolean;
}

export interface BindingEntry {
  providerId: string;
  modelId: string;
  /** Priority (lower = tried first). 0 = primary. */
  priority: number;
  /** Optional cost premium for this binding */
  costPremium?: number;
  /** Optional latency premium for this binding */
  latencyPremium?: number;
  /** Region hint for this binding */
  region?: string;
}

/**
 * Check if a candidate set contains multi-binding models.
 * Returns true if any model has alternative bindings.
 */
export function hasMultiBinding(candidates: CandidateSet): boolean {
  return candidates.some(c =>
    c.bindings && c.bindings.fallbacks.length > 0
  );
}
