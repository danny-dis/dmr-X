export interface TelemetryConfig {
    /** Service name for resource attribution */
    serviceName?: string;
    /** Prometheus metrics endpoint port (default: 9464) */
    metricsPort?: number;
    /** Prometheus metrics endpoint path (default: /metrics) */
    metricsPath?: string;
    /** OTLP trace collector endpoint (default: http://localhost:4318/v1/traces) */
    otlpEndpoint?: string;
    /** Whether to enable trace export (default: true) */
    enableTracing?: boolean;
    /** Whether to enable Prometheus metrics (default: true) */
    enableMetrics?: boolean;
}
export declare class TelemetryService {
    private sdk;
    private prometheusExporter;
    private readonly config;
    private started;
    constructor(config?: TelemetryConfig);
    /**
     * Initialize and start the OpenTelemetry SDK with Prometheus metrics
     * exporter and OTLP trace exporter. The PrometheusExporter starts its
     * own HTTP server exposing /metrics for scraping.
     */
    start(): Promise<void>;
    /**
     * Gracefully shut down the telemetry service, flushing all pending
     * metrics and traces.
     */
    shutdown(): Promise<void>;
    /**
     * Whether the service has been started.
     */
    isStarted(): boolean;
    /**
     * Record a completed request. Increments the request counter with
     * provider, model, modality, and status code labels.
     */
    recordRequest(params: {
        providerId: string;
        modelId: string;
        modality: string;
        statusCode: number;
    }): void;
    /**
     * Record request latency in milliseconds. Also optionally records
     * time-to-first-token for streaming requests.
     */
    recordLatency(params: {
        providerId: string;
        modelId: string;
        modality: string;
        latencyMs: number;
        ttftMs?: number;
    }): void;
    /**
     * Record token usage (prompt, completion, total) and estimated USD cost.
     */
    recordTokens(params: {
        providerId: string;
        modelId: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUsd?: number;
    }): void;
    /**
     * Record an error. Increments the error counter with provider, model,
     * error code, and modality labels.
     */
    recordError(params: {
        providerId: string;
        modelId: string;
        modality: string;
        errorCode: string;
    }): void;
    /**
     * Record a provider's health status. This updates the async gauge
     * that is scraped by Prometheus.
     */
    recordHealth(params: {
        providerId: string;
        healthy: boolean;
    }): void;
    /**
     * Build a JSON-serializable health response. Integrate this into your
     * app server to expose a /health endpoint alongside the Prometheus
     * /metrics endpoint.
     *
     * Example (Express):
     *   app.get('/health', (_req, res) => {
     *     res.json(telemetry.getHealthResponse());
     *   });
     */
    getHealthResponse(): {
        status: string;
        uptime: number;
        providers: {
            total: number;
            healthy: number;
            unhealthy: number;
        };
    };
}
/**
 * Get or create the singleton TelemetryService instance.
 */
export declare function getTelemetryService(config?: TelemetryConfig): TelemetryService;
/**
 * Reset the singleton (useful for tests).
 */
export declare function resetTelemetryService(): void;
//# sourceMappingURL=telemetry.service.d.ts.map