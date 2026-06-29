import { Modality, IntelligenceLayer, CapabilityTier, QualityTarget } from './modality.js';

export type FreeTierStrategy = 'prioritize' | 'load_balance' | 'fallback' | 'none';

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
