/**
 * Rich model metadata types for routing decisions and API responses.
 * Inspired by OpenRouter SDK's Model and PublicEndpoint types.
 */

/**
 * Model architecture information.
 */
export interface ModelArchitecture {
  /** Input modality: text, image, audio, video */
  inputModalities: string[];
  /** Output modality: text, image, audio, video */
  outputModalities: string[];
  /** Tokenizer type */
  tokenizer?: string;
  /** Whether the model uses instruct-style prompting */
  instructType?: string;
}

/**
 * Pricing breakdown for a model endpoint.
 * All values are per-million-tokens (USD) unless noted.
 */
export interface ModelPricing {
  /** Cost per million prompt tokens */
  prompt: number;
  /** Cost per million completion tokens */
  completion: number;
  /** Cost per million image tokens */
  image?: number;
  /** Cost per request (flat fee) */
  request?: number;
  /** Cost per million internal reasoning tokens */
  internalReasoning?: number;
  /** Cost per web search */
  webSearch?: number;
  /** Cost per million input audio tokens */
  audio?: number;
  /** Cost per million output audio tokens */
  audioOutput?: number;
  /** Cache read discount (per million tokens) */
  inputCacheRead?: number;
  /** Cache write cost (per million tokens) */
  inputCacheWrite?: number;
}

/**
 * Latency/throughput percentile stats (measured over last 30 minutes).
 */
export interface PercentileStats {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Quantization levels for model weights.
 */
export type Quantization =
  | 'int4'
  | 'int8'
  | 'fp4'
  | 'fp6'
  | 'fp8'
  | 'fp16'
  | 'bf16'
  | 'fp32'
  | 'unknown';

/**
 * Rich model metadata for routing and display.
 * Combines info from OpenRouter SDK's Model and PublicEndpoint types.
 */
export interface ModelMetadata {
  /** Unique model identifier (e.g., 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet') */
  id: string;
  /** Display name */
  name: string;
  /** Canonical slug */
  canonicalSlug?: string;
  /** Provider that serves this model */
  providerId: string;
  /** Human-readable provider name */
  providerName: string;
  /** Model description */
  description?: string;

  /** Architecture info */
  architecture: ModelArchitecture;

  /** Maximum context window in tokens */
  contextLength: number;
  /** Maximum output tokens */
  maxCompletionTokens?: number;
  /** Maximum prompt tokens */
  maxPromptTokens?: number;

  /** Pricing info */
  pricing: ModelPricing;

  /** Supported parameters (e.g., 'tools', 'response_format', 'seed') */
  supportedParameters: string[];

  /** Quantization level (null if unknown) */
  quantization: Quantization | null;

  /** Latency percentiles (p50/p75/p90/p95/p99) in ms, last 30 min */
  latencyLast30m: PercentileStats | null;
  /** Throughput percentiles in tokens/sec, last 30 min */
  throughputLast30m: PercentileStats | null;

  /** Uptime percentage, last 5 min */
  uptimeLast5m: number | null;
  /** Uptime percentage, last 30 min */
  uptimeLast30m: number | null;
  /** Uptime percentage, last 1 day */
  uptimeLast1d: number | null;

  /** Whether the model supports implicit caching */
  supportsImplicitCaching: boolean;

  /** Whether the model is moderated by the provider */
  isModerated?: boolean;

  /** Knowledge cutoff date (ISO 8601) */
  knowledgeCutoff?: string | null;
  /** Expiration date after which model may be removed (ISO 8601) */
  expirationDate?: string | null;

  /** Unix timestamp of when this metadata was last updated */
  updatedAt: number;
}
