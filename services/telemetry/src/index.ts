export {
  TelemetryService,
  getTelemetryService,
  resetTelemetryService,
  type TelemetryConfig,
} from './telemetry.service.js';

export {
  tracer,
  TRACER_NAME,
  TRACER_VERSION,
} from './tracer.js';

export {
  requestCount,
  requestLatency,
  ttftLatency,
  tokenUsage,
  costEstimate,
  errorCount,
  providerHealth,
  setProviderHealthStatus,
  getProviderHealthStatus,
  getAllProviderHealth,
  cacheHitCount,
  cacheMissCount,
  cacheLatency,
  routingDecisionCount,
  fallbackCount,
  fallbackSuccessCount,
  rateLimitHitCount,
  incrementInFlight,
  decrementInFlight,
  tenantRequestCount,
  tenantCostTotal,
  keyRequestCount,
  keyCostTotal,
  teamRequestCount,
  teamCostTotal,
  type RequestLabels,
  type ErrorLabels,
  type TokenLabels,
  type CostLabels,
  type HealthLabels,
} from './metrics.js';

export {
  contentCaptureService,
  type CaptureMode,
  type CaptureEvent,
} from './content-capture.js';

export {
  requestLogger,
  type RequestLogContext,
  type RequestLogOptions,
} from './request-logger.js';

export {
  auditLogger,
  type AuditLogEntry,
  type AuditLogQuery,
} from './audit-logger.js';

export {
  loggingIntegrations,
  type LogEvent,
  type LoggingIntegration,
} from './logging-integrations.js';
