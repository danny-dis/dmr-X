import { Modality, IntelligenceLayer, QualityTarget } from './modality.js';

export type FreeTierStrategy = 'prioritize' | 'load_balance' | 'fallback' | 'none';

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
}

export interface ProviderModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modality: Modality;
  intelligenceLayer: IntelligenceLayer;
  capabilities: string[];
  costPerInputToken: number;
  costPerOutputToken: number;
  costPerImage: number;
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
