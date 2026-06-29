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

// ─── Cache Metrics ───────────────────────────────────────────────────────────

export const cacheHitCount: Counter = METER.createCounter('dmr_cache_hits_total', {
  description: 'Total cache hits (exact and semantic)',
  unit: 'hits',
});

export const cacheMissCount: Counter = METER.createCounter('dmr_cache_misses_total', {
  description: 'Total cache misses',
  unit: 'misses',
});

export const cacheLatency: Histogram = METER.createHistogram('dmr_cache_latency_ms', {
  description: 'Cache lookup latency in milliseconds',
  unit: 'ms',
});

// ─── Routing Metrics ─────────────────────────────────────────────────────────

export const routingDecisionCount: Counter = METER.createCounter('dmr_routing_decisions_total', {
  description: 'Total routing decisions by strategy',
  unit: 'decisions',
});

export const fallbackCount: Counter = METER.createCounter('dmr_fallback_total', {
  description: 'Total fallback attempts',
  unit: 'fallbacks',
});

export const fallbackSuccessCount: Counter = METER.createCounter('dmr_fallback_success_total', {
  description: 'Total successful fallbacks',
  unit: 'fallbacks',
});

export const rateLimitHitCount: Counter = METER.createCounter('dmr_rate_limit_hits_total', {
  description: 'Total rate limit hits',
  unit: 'hits',
});

// ─── Queue / In-Flight Metrics ───────────────────────────────────────────────

const inFlightRegistry = new Map<string, number>();

export const inFlightRequests: ObservableGauge = METER.createObservableGauge(
  'dmr_in_flight_requests',
  {
    description: 'Current number of in-flight requests per provider',
    unit: 'requests',
  }
);

inFlightRequests.addCallback((result: ObservableResult) => {
  for (const [providerId, count] of inFlightRegistry) {
    result.observe(count, { provider_id: providerId });
  }
});

export function incrementInFlight(providerId: string): void {
  inFlightRegistry.set(providerId, (inFlightRegistry.get(providerId) || 0) + 1);
}

export function decrementInFlight(providerId: string): void {
  const current = inFlightRegistry.get(providerId) || 0;
  if (current > 0) {
    inFlightRegistry.set(providerId, current - 1);
  }
}

// ─── Tenant / Key / Team Metrics ─────────────────────────────────────────────

export const tenantRequestCount: Counter = METER.createCounter('dmr_tenant_requests_total', {
  description: 'Total requests per tenant',
  unit: 'requests',
});

export const tenantCostTotal: Counter = METER.createCounter('dmr_tenant_cost_usd', {
  description: 'Total cost per tenant in USD',
  unit: 'usd',
});

export const keyRequestCount: Counter = METER.createCounter('dmr_key_requests_total', {
  description: 'Total requests per virtual key',
  unit: 'requests',
});

export const keyCostTotal: Counter = METER.createCounter('dmr_key_cost_usd', {
  description: 'Total cost per virtual key in USD',
  unit: 'usd',
});

export const teamRequestCount: Counter = METER.createCounter('dmr_team_requests_total', {
  description: 'Total requests per team',
  unit: 'requests',
});

export const teamCostTotal: Counter = METER.createCounter('dmr_team_cost_usd', {
  description: 'Total cost per team in USD',
  unit: 'usd',
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
