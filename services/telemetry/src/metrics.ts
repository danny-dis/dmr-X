import {
  metrics,
  type Counter,
  type Histogram,
  type ObservableGauge,
  type ObservableResult,
} from '@opentelemetry/api';

const SERVICE_NAME = 'dmr-x';
const METER = metrics.getMeter(SERVICE_NAME);

// ─── Metric Definitions ─────────────────────────────────────────────────────

/**
 * Total number of requests processed, labeled by provider, model, and modality.
 */
export const requestCount: Counter = METER.createCounter('dmr_request_count', {
  description: 'Total number of requests routed through DMR-X',
  unit: 'requests',
});

/**
 * Request latency distribution for p50/p95/p99 tracking.
 * Values are recorded in milliseconds.
 */
export const requestLatency: Histogram = METER.createHistogram('dmr_request_latency_ms', {
  description: 'Request latency in milliseconds',
  unit: 'ms',
});

/**
 * Time-to-first-token latency for streaming requests.
 */
export const ttftLatency: Histogram = METER.createHistogram('dmr_ttft_latency_ms', {
  description: 'Time to first token in milliseconds for streaming requests',
  unit: 'ms',
});

/**
 * Token usage counter tracking prompt, completion, and total tokens.
 * Labeled by provider, model, and token_type (prompt/completion/total).
 */
export const tokenUsage: Counter = METER.createCounter('dmr_token_usage_total', {
  description: 'Total tokens consumed',
  unit: 'tokens',
});

/**
 * Estimated cost in USD, labeled by provider and model.
 */
export const costEstimate: Counter = METER.createCounter('dmr_cost_estimate_usd', {
  description: 'Estimated cost in USD for processed requests',
  unit: 'usd',
});

/**
 * Error counter labeled by provider, model, error_code, and modality.
 */
export const errorCount: Counter = METER.createCounter('dmr_error_count', {
  description: 'Total number of errors by provider and error code',
  unit: 'errors',
});

/**
 * Provider health gauge: 1 = healthy, 0 = unhealthy.
 * Updated via an async callback that reads from the health registry.
 */
const healthRegistry = new Map<string, number>();

export const providerHealth: ObservableGauge = METER.createObservableGauge(
  'dmr_provider_health',
  {
    description: 'Provider health status (1 = healthy, 0 = unhealthy)',
    unit: 'status',
  }
);

providerHealth.addCallback((result: ObservableResult) => {
  for (const [providerId, status] of healthRegistry) {
    result.observe(status, { provider_id: providerId });
  }
});

// ─── Health Registry Helpers ─────────────────────────────────────────────────

export function setProviderHealthStatus(providerId: string, healthy: boolean): void {
  healthRegistry.set(providerId, healthy ? 1 : 0);
}

export function getProviderHealthStatus(providerId: string): number | undefined {
  return healthRegistry.get(providerId);
}

export function getAllProviderHealth(): Map<string, number> {
  return new Map(healthRegistry);
}

// ─── Label Builders ─────────────────────────────────────────────────────────

export interface RequestLabels {
  provider_id: string;
  model_id: string;
  modality: string;
  [key: string]: string | number | undefined;
}

export interface ErrorLabels {
  provider_id: string;
  model_id: string;
  error_code: string;
  modality: string;
  [key: string]: string | number | undefined;
}

export interface TokenLabels {
  provider_id: string;
  model_id: string;
  token_type: 'prompt' | 'completion' | 'total';
}

export interface CostLabels {
  provider_id: string;
  model_id: string;
  [key: string]: string | number | undefined;
}

export interface HealthLabels {
  provider_id: string;
}
