/**
 * Provider preference types for controlling routing behavior per-request.
 * Inspired by OpenRouter SDK's ProviderPreferences.
 */

/**
 * How to sort/select among available providers.
 */
export type ProviderSort = 'price' | 'throughput' | 'latency';

/**
 * Routing strategy for provider selection.
 */
export type RoutingStrategy =
  | 'auto'        // Let the router decide based on quality target
  | 'direct'      // Go directly to a specific provider (no routing)
  | 'free'        // Prefer free-tier providers
  | 'fallback'    // Use ordered fallback chain
  | 'pareto';     // Pareto-optimal selection (cost vs quality tradeoff)

/**
 * Per-request provider preferences that influence the routing pipeline.
 * Passed via `UnifiedRequest.metadata.providerPreferences`.
 */
export interface ProviderPreferences {
  /** Routing strategy override. Default: 'auto' */
  strategy?: RoutingStrategy;

  /** How to sort candidates. Default: balanced based on qualityTarget */
  sort?: ProviderSort;

  /**
   * Ordered list of provider slugs to try first.
   * The router attempts providers in this order before falling back.
   */
  order?: string[];

  /**
   * Only use these providers. If set, all others are excluded.
   * Mutually exclusive with `ignore`.
   */
  only?: string[];

  /**
   * Exclude these providers. Ignored if `only` is set.
   */
  ignore?: string[];

  /**
   * Whether to allow fallback to other providers on failure.
   * Default: true
   */
  allowFallbacks?: boolean;

  /**
   * Maximum price per million tokens (prompt + completion combined).
   * Providers exceeding this are excluded.
   */
  maxPricePerMillionTokens?: number;

  /**
   * Only use providers with these quantization levels.
   * E.g., ['fp16', 'bf16'] to exclude quantized models.
   */
  quantizations?: string[];

  /**
   * Whether to filter providers to only those that support
   * all parameters in the request (tools, response_format, etc.).
   * Default: false (providers ignore unsupported params)
   */
  requireParameters?: boolean;

  /**
   * Only use zero-data-retention providers.
   * Default: false
   */
  zdr?: boolean;

  /**
   * Preferred maximum latency in milliseconds (p50).
   * Providers above this are deprioritized but not excluded.
   */
  preferredMaxLatencyMs?: number;

  /**
   * Preferred minimum throughput in tokens/second (p50).
   * Providers below this are deprioritized but not excluded.
   */
  preferredMinThroughputTps?: number;
}
