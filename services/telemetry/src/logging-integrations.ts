import { logger } from '@dmr-x/utils';

/**
 * External Logging Integrations for DMR-X.
 *
 * Mirrors LiteLLM's callback-based logging system:
 * - Langfuse integration
 * - Helicone integration
 * - Custom webhook logging
 * - LangSmith integration
 *
 * Each integration implements the LoggingIntegration interface
 * and can be enabled/disabled independently.
 */

export interface LogEvent {
  requestId: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  modality: string;
  statusCode: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costCents?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface LoggingIntegration {
  name: string;
  enabled: boolean;
  log(event: LogEvent): Promise<void>;
  flush?(): Promise<void>;
}

// ─── Langfuse Integration ────────────────────────────────────────────────────

export class LangfuseIntegration implements LoggingIntegration {
  name = 'langfuse';
  enabled = false;
  private baseUrl: string;
  private publicKey: string;
  private secretKey: string;

  constructor() {
    this.enabled = process.env.LANGFUSE_ENABLED === 'true';
    this.baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
    this.publicKey = process.env.LANGFUSE_PUBLIC_KEY || '';
    this.secretKey = process.env.LANGFUSE_SECRET_KEY || '';
  }

  async log(event: LogEvent): Promise<void> {
    if (!this.enabled || !this.publicKey) return;

    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
      await fetch(`${this.baseUrl}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify({
          batch: [
            {
              id: event.requestId,
              type: 'trace-create',
              timestamp: new Date(event.timestamp).getTime(),
              body: {
                id: event.requestId,
                name: `${event.providerId}/${event.modelId}`,
                metadata: event.metadata,
              },
            },
            {
              id: `${event.requestId}-generation`,
              type: 'generation-create',
              timestamp: new Date(event.timestamp).getTime(),
              body: {
                traceId: event.requestId,
                name: event.modelId,
                model: event.modelId,
                modelParameters: { provider: event.providerId },
                usage: {
                  input: event.promptTokens,
                  output: event.completionTokens,
                  total: event.totalTokens,
                },
                level: event.statusCode >= 400 ? 'ERROR' : 'DEFAULT',
                statusMessage: event.error,
                metadata: {
                  latencyMs: event.latencyMs,
                  statusCode: event.statusCode,
                  modality: event.modality,
                },
              },
            },
          ],
        }),
      });
    } catch (err) {
      logger.debug({ err, integration: 'langfuse' }, 'Failed to log to Langfuse');
    }
  }

  async flush(): Promise<void> {
    // Langfuse uses batch ingestion, no explicit flush needed
  }
}

// ─── Helicone Integration ────────────────────────────────────────────────────

export class HeliconeIntegration implements LoggingIntegration {
  name = 'helicone';
  enabled = false;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.enabled = process.env.HELICONE_ENABLED === 'true';
    this.apiKey = process.env.HELICONE_API_KEY || '';
    this.baseUrl = process.env.HELICONE_BASE_URL || 'https://api.helicone.ai';
  }

  async log(event: LogEvent): Promise<void> {
    if (!this.enabled || !this.apiKey) return;

    try {
      await fetch(`${this.baseUrl}/v1/log/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Helicone-Property-Request-Id': event.requestId,
          'Helicone-Property-Provider': event.providerId,
          'Helicone-Property-Model': event.modelId,
        },
        body: JSON.stringify({
          request: {
            model: event.modelId,
            provider: event.providerId,
          },
          response: {
            status: event.statusCode,
            model: event.modelId,
          },
          timings: {
            total: event.latencyMs,
          },
          usage: {
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            totalTokens: event.totalTokens,
          },
        }),
      });
    } catch (err) {
      logger.debug({ err, integration: 'helicone' }, 'Failed to log to Helicone');
    }
  }

  async flush(): Promise<void> {}
}

// ─── Webhook Integration ─────────────────────────────────────────────────────

export class WebhookIntegration implements LoggingIntegration {
  name = 'webhook';
  enabled = false;
  private url: string;
  private headers: Record<string, string>;
  private batchBuffer: LogEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.enabled = process.env.DMRX_WEBHOOK_LOGGING_URL !== '';
    this.url = process.env.DMRX_WEBHOOK_LOGGING_URL || '';
    this.headers = {};

    // Parse custom headers from env (JSON format)
    if (process.env.DMRX_WEBHOOK_LOGGING_HEADERS) {
      try {
        this.headers = JSON.parse(process.env.DMRX_WEBHOOK_LOGGING_HEADERS);
      } catch {
        logger.warn('Failed to parse DMRX_WEBHOOK_LOGGING_HEADERS');
      }
    }
  }

  async log(event: LogEvent): Promise<void> {
    if (!this.enabled || !this.url) return;

    this.batchBuffer.push(event);

    // Flush batch when it reaches 10 events
    if (this.batchBuffer.length >= 10) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batchBuffer.length === 0 || !this.url) return;

    const events = this.batchBuffer.splice(0);
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      logger.debug({ err, integration: 'webhook', eventCount: events.length }, 'Failed to send webhook');
      // Re-queue failed events (up to 100)
      if (this.batchBuffer.length < 100) {
        this.batchBuffer.unshift(...events);
      }
    }
  }

  startFlushTimer(intervalMs: number = 10000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), intervalMs);
    this.flushTimer.unref();
  }

  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ─── Integration Manager ─────────────────────────────────────────────────────

export class LoggingIntegrationManager {
  private integrations: LoggingIntegration[] = [];

  constructor() {
    // Register all integrations
    this.integrations.push(new LangfuseIntegration());
    this.integrations.push(new HeliconeIntegration());
    this.integrations.push(new WebhookIntegration());

    const enabled = this.integrations.filter(i => i.enabled).map(i => i.name);
    if (enabled.length > 0) {
      logger.info({ integrations: enabled }, 'Logging integrations enabled');
    }
  }

  /**
   * Log an event to all enabled integrations.
   */
  async log(event: LogEvent): Promise<void> {
    const promises = this.integrations
      .filter(i => i.enabled)
      .map(i => i.log(event).catch(err => {
        logger.debug({ err, integration: i.name }, 'Integration log failed');
      }));

    await Promise.allSettled(promises);
  }

  /**
   * Flush all integrations.
   */
  async flush(): Promise<void> {
    const promises = this.integrations
      .filter(i => i.enabled && i.flush)
      .map(i => i.flush!().catch(err => {
        logger.debug({ err, integration: i.name }, 'Integration flush failed');
      }));

    await Promise.allSettled(promises);
  }

  /**
   * Get status of all integrations.
   */
  getStatus(): Array<{ name: string; enabled: boolean }> {
    return this.integrations.map(i => ({ name: i.name, enabled: i.enabled }));
  }
}

export const loggingIntegrations = new LoggingIntegrationManager();
