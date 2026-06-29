import { logger } from '@dmr-x/utils';

/**
 * Structured Request Logger — logs every request with full context.
 *
 * Mirrors LiteLLM's request logging:
 * - Request ID correlation (links to OTel traces)
 * - Tenant, team, key identification
 * - Provider, model, modality
 * - Latency, tokens, cost
 * - Status code, error details
 * - Routing strategy used
 * - Fallback chain triggered
 *
 * Configurable via env vars:
 *   DMRX_REQUEST_LOG_LEVEL=debug|info|warn (default: info)
 *   DMRX_REQUEST_LOG_BODY=false (log full request/response bodies)
 *   DMRX_REQUEST_LOG_SAMPLE_RATE=1.0 (0.0-1.0, fraction of requests to log)
 */

export interface RequestLogContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  teamId?: string;
  keyId?: string;
  keyPrefix?: string;
  userId?: string;
  providerId: string;
  modelId: string;
  modality: string;
  statusCode: number;
  latencyMs: number;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costCents?: number;
  costUsd?: number;
  routingStrategy?: string;
  fallbackTriggered?: boolean;
  fallbackChain?: string[];
  error?: string;
  errorCode?: string;
  cached?: boolean;
  cacheHitType?: 'exact' | 'semantic' | 'miss';
  streaming?: boolean;
  apiFormat?: 'openai' | 'anthropic' | 'gemini';
  userAgent?: string;
  ip?: string;
}

export interface RequestLogOptions {
  /** Log level for request logs */
  level?: 'debug' | 'info' | 'warn';
  /** Whether to log full request/response bodies */
  logBody?: boolean;
  /** Sample rate (0.0-1.0) for high-volume environments */
  sampleRate?: number;
}

class RequestLogger {
  private options: Required<RequestLogOptions>;
  private sampleCounter = 0;

  constructor() {
    this.options = {
      level: (process.env.DMRX_REQUEST_LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
      logBody: process.env.DMRX_REQUEST_LOG_BODY === 'true',
      sampleRate: parseFloat(process.env.DMRX_REQUEST_LOG_SAMPLE_RATE || '1.0'),
    };
  }

  /**
   * Log a completed request with full structured context.
   */
  log(ctx: RequestLogContext): void {
    // Sample rate filtering
    if (this.options.sampleRate < 1.0) {
      this.sampleCounter++;
      if (this.sampleCounter % Math.ceil(1 / this.options.sampleRate) !== 0) {
        return;
      }
    }

    const logEntry = {
      // Correlation
      request_id: ctx.requestId,
      trace_id: ctx.traceId,
      span_id: ctx.spanId,

      // Identity
      tenant_id: ctx.tenantId,
      team_id: ctx.teamId,
      key_id: ctx.keyId,
      key_prefix: ctx.keyPrefix,
      user_id: ctx.userId,

      // Request
      provider: ctx.providerId,
      model: ctx.modelId,
      modality: ctx.modality,
      api_format: ctx.apiFormat,
      streaming: ctx.streaming,

      // Response
      status_code: ctx.statusCode,
      latency_ms: ctx.latencyMs,
      ttft_ms: ctx.ttftMs,

      // Usage
      prompt_tokens: ctx.promptTokens,
      completion_tokens: ctx.completionTokens,
      total_tokens: ctx.totalTokens,
      cost_cents: ctx.costCents,
      cost_usd: ctx.costUsd,

      // Routing
      routing_strategy: ctx.routingStrategy,
      fallback_triggered: ctx.fallbackTriggered,
      fallback_chain: ctx.fallbackChain,

      // Cache
      cached: ctx.cached,
      cache_hit_type: ctx.cacheHitType,

      // Error
      error: ctx.error,
      error_code: ctx.errorCode,

      // Client
      user_agent: ctx.userAgent,
      ip: ctx.ip,
    };

    switch (this.options.level) {
      case 'debug':
        logger.debug(logEntry, 'request_completed');
        break;
      case 'warn':
        if (ctx.statusCode >= 400) {
          logger.warn(logEntry, 'request_completed');
        } else {
          logger.info(logEntry, 'request_completed');
        }
        break;
      default:
        logger.info(logEntry, 'request_completed');
    }
  }

  /**
   * Log a request start (for tracking in-flight requests).
   */
  logStart(ctx: Pick<RequestLogContext, 'requestId' | 'tenantId' | 'providerId' | 'modelId' | 'modality'>): void {
    logger.debug({
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      provider: ctx.providerId,
      model: ctx.modelId,
      modality: ctx.modality,
    }, 'request_started');
  }

  /**
   * Log a routing decision.
   */
  logRoutingDecision(ctx: {
    requestId: string;
    strategy: string;
    selectedProvider: string;
    selectedModel: string;
    candidateCount: number;
    fallbackCount: number;
  }): void {
    logger.debug({
      request_id: ctx.requestId,
      routing_strategy: ctx.strategy,
      selected_provider: ctx.selectedProvider,
      selected_model: ctx.selectedModel,
      candidate_count: ctx.candidateCount,
      fallback_count: ctx.fallbackCount,
    }, 'routing_decision');
  }

  /**
   * Log a fallback event.
   */
  logFallback(ctx: {
    requestId: string;
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    trigger: string;
    error?: string;
  }): void {
    logger.info({
      request_id: ctx.requestId,
      from_provider: ctx.fromProvider,
      from_model: ctx.fromModel,
      to_provider: ctx.toProvider,
      to_model: ctx.toModel,
      trigger: ctx.trigger,
      error: ctx.error,
    }, 'fallback_triggered');
  }

  /**
   * Log an admin action (for audit trail).
   */
  logAdminAction(ctx: {
    action: string;
    actorId?: string;
    tenantId?: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown>;
  }): void {
    logger.info({
      admin_action: ctx.action,
      actor_id: ctx.actorId,
      tenant_id: ctx.tenantId,
      target_type: ctx.targetType,
      target_id: ctx.targetId,
      ...ctx.details,
    }, 'admin_action');
  }

  /**
   * Get the current log level.
   */
  getLevel(): string {
    return this.options.level;
  }
}

export const requestLogger = new RequestLogger();
