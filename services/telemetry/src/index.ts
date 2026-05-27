export {
  TelemetryService,
  getTelemetryService,
  resetTelemetryService,
  type TelemetryConfig,
} from './telemetry.service.js';

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
  type RequestLabels,
  type ErrorLabels,
  type TokenLabels,
  type CostLabels,
  type HealthLabels,
} from './metrics.js';
