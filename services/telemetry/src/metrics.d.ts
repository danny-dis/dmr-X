import { type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';
/**
 * Total number of requests processed, labeled by provider, model, and modality.
 */
export declare const requestCount: Counter;
/**
 * Request latency distribution for p50/p95/p99 tracking.
 * Values are recorded in milliseconds.
 */
export declare const requestLatency: Histogram;
/**
 * Time-to-first-token latency for streaming requests.
 */
export declare const ttftLatency: Histogram;
/**
 * Token usage counter tracking prompt, completion, and total tokens.
 * Labeled by provider, model, and token_type (prompt/completion/total).
 */
export declare const tokenUsage: Counter;
/**
 * Estimated cost in USD, labeled by provider and model.
 */
export declare const costEstimate: Counter;
/**
 * Error counter labeled by provider, model, error_code, and modality.
 */
export declare const errorCount: Counter;
export declare const providerHealth: ObservableGauge;
export declare function setProviderHealthStatus(providerId: string, healthy: boolean): void;
export declare function getProviderHealthStatus(providerId: string): number | undefined;
export declare function getAllProviderHealth(): Map<string, number>;
export interface RequestLabels {
    provider_id: string;
    model_id: string;
    modality: string;
}
export interface ErrorLabels {
    provider_id: string;
    model_id: string;
    error_code: string;
    modality: string;
}
export interface TokenLabels {
    provider_id: string;
    model_id: string;
    token_type: 'prompt' | 'completion' | 'total';
}
export interface CostLabels {
    provider_id: string;
    model_id: string;
}
export interface HealthLabels {
    provider_id: string;
}
//# sourceMappingURL=metrics.d.ts.map