import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { createLogger } from '@dmr-x/utils';
import {
  requestCount,
  requestLatency,
  ttftLatency,
  tokenUsage,
  costEstimate,
  errorCount,
  setProviderHealthStatus,
  getAllProviderHealth,
  type RequestLabels,
  type ErrorLabels,
  type TokenLabels,
  type CostLabels,
} from './metrics.js';

const logger = createLogger('telemetry');

// ─── Configuration ──────────────────────────────────────────────────────────

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

// ─── Telemetry Service ──────────────────────────────────────────────────────

export class TelemetryService {
  private sdk: NodeSDK | null = null;
  private prometheusExporter: PrometheusExporter | null = null;
  private readonly config: Required<TelemetryConfig>;
  private started = false;

  constructor(config: TelemetryConfig = {}) {
    this.config = {
      serviceName: config.serviceName ?? 'dmr-x',
      metricsPort: config.metricsPort ?? 9464,
      metricsPath: config.metricsPath ?? '/metrics',
      otlpEndpoint: config.otlpEndpoint ?? 'http://localhost:4318/v1/traces',
      enableTracing: config.enableTracing ?? true,
      enableMetrics: config.enableMetrics ?? true,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize and start the OpenTelemetry SDK with Prometheus metrics
   * exporter and OTLP trace exporter. The PrometheusExporter starts its
   * own HTTP server exposing /metrics for scraping.
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('TelemetryService already started');
      return;
    }

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: this.config.serviceName,
    });

    // Prometheus exporter -- starts its own HTTP server automatically
    if (this.config.enableMetrics) {
      this.prometheusExporter = new PrometheusExporter({
        port: this.config.metricsPort,
        endpoint: this.config.metricsPath,
      });
      logger.info(
        { port: this.config.metricsPort, path: this.config.metricsPath },
        'Prometheus metrics exporter started'
      );
    }

    // OTLP trace exporter
    const traceExporter = this.config.enableTracing
      ? new OTLPTraceExporter({ url: this.config.otlpEndpoint })
      : undefined;

    if (traceExporter) {
      logger.info({ endpoint: this.config.otlpEndpoint }, 'OTLP trace exporter initialized');
    }

    // Build and start the SDK
    this.sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader: this.prometheusExporter ?? undefined,
    });

    this.sdk.start();
    this.started = true;

    logger.info('TelemetryService started');
  }

  /**
   * Gracefully shut down the telemetry service, flushing all pending
   * metrics and traces.
   */
  async shutdown(): Promise<void> {
    if (!this.started) {
      return;
    }

    logger.info('Shutting down TelemetryService');

    if (this.sdk) {
      await this.sdk.shutdown();
      this.sdk = null;
    }

    this.prometheusExporter = null;
    this.started = false;
    logger.info('TelemetryService shut down');
  }

  /**
   * Whether the service has been started.
   */
  isStarted(): boolean {
    return this.started;
  }

  // ─── Recording Methods ──────────────────────────────────────────────────

  /**
   * Record a completed request. Increments the request counter with
   * provider, model, modality, and status code labels.
   */
  recordRequest(params: {
    providerId: string;
    modelId: string;
    modality: string;
    statusCode: number;
  }): void {
    const labels: RequestLabels = {
      provider_id: params.providerId,
      model_id: params.modelId,
      modality: params.modality,
    };
    requestCount.add(1, {
      ...labels,
      status_code: String(params.statusCode),
    });
    logger.debug({ ...labels, statusCode: params.statusCode }, 'Request recorded');
  }

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
  }): void {
    const labels: RequestLabels = {
      provider_id: params.providerId,
      model_id: params.modelId,
      modality: params.modality,
    };
    requestLatency.record(params.latencyMs, labels);

    if (params.ttftMs !== undefined) {
      ttftLatency.record(params.ttftMs, labels);
    }

    logger.debug(
      { ...labels, latencyMs: params.latencyMs, ttftMs: params.ttftMs },
      'Latency recorded'
    );
  }

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
  }): void {
    const tokenBase: Omit<TokenLabels, 'token_type'> = {
      provider_id: params.providerId,
      model_id: params.modelId,
    };

    tokenUsage.add(params.promptTokens, { ...tokenBase, token_type: 'prompt' });
    tokenUsage.add(params.completionTokens, { ...tokenBase, token_type: 'completion' });
    tokenUsage.add(params.totalTokens, { ...tokenBase, token_type: 'total' });

    if (params.costUsd !== undefined && params.costUsd > 0) {
      const costLabels: CostLabels = {
        provider_id: params.providerId,
        model_id: params.modelId,
      };
      costEstimate.add(params.costUsd, costLabels);
    }

    logger.debug(
      {
        provider_id: params.providerId,
        model_id: params.modelId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        costUsd: params.costUsd,
      },
      'Token usage recorded'
    );
  }

  /**
   * Record an error. Increments the error counter with provider, model,
   * error code, and modality labels.
   */
  recordError(params: {
    providerId: string;
    modelId: string;
    modality: string;
    errorCode: string;
  }): void {
    const labels: ErrorLabels = {
      provider_id: params.providerId,
      model_id: params.modelId,
      error_code: params.errorCode,
      modality: params.modality,
    };
    errorCount.add(1, labels);
    logger.debug({ ...labels }, 'Error recorded');
  }

  /**
   * Record a provider's health status. This updates the async gauge
   * that is scraped by Prometheus.
   */
  recordHealth(params: {
    providerId: string;
    healthy: boolean;
  }): void {
    setProviderHealthStatus(params.providerId, params.healthy);
    logger.debug(
      { provider_id: params.providerId, healthy: params.healthy },
      'Provider health updated'
    );
  }

  // ─── Health Endpoint Helper ─────────────────────────────────────────────

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
    providers: { total: number; healthy: number; unhealthy: number };
  } {
    const health = getAllProviderHealth();
    const healthyCount = [...health.values()].filter((v) => v === 1).length;
    const unhealthyCount = [...health.values()].filter((v) => v === 0).length;

    return {
      status: 'ok',
      uptime: process.uptime(),
      providers: {
        total: health.size,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
      },
    };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: TelemetryService | null = null;

/**
 * Get or create the singleton TelemetryService instance.
 */
export function getTelemetryService(config?: TelemetryConfig): TelemetryService {
  if (!instance) {
    instance = new TelemetryService(config);
  }
  return instance;
}

/**
 * Reset the singleton (useful for tests).
 */
export function resetTelemetryService(): void {
  instance = null;
}
