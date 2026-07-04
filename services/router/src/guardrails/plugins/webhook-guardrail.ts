import type { GuardrailPlugin, GuardrailCheckContext, GuardrailCheckResult } from '../guardrail-plugin.interface.js';
import { logger } from '@dmr-x/utils';

export interface WebhookGuardrailConfig {
  /** Webhook URL to call for guardrail checks */
  url: string;
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Custom headers to send */
  headers?: Record<string, string>;
  /** Whether to block on webhook failure (default: false = allow on failure) */
  blockOnFailure?: boolean;
  /** Retry count on transient failures (default: 1) */
  retries?: number;
}

interface WebhookRequest {
  content: string;
  direction: 'input' | 'output';
  requestId?: string;
  tenantId?: string;
  providerId?: string;
  modelId?: string;
}

interface WebhookResponse {
  allowed: boolean;
  violations?: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
  }>;
  maskedContent?: string;
}

/**
 * Webhook-based guardrail plugin — calls an external service for guardrail checks.
 *
 * Expected webhook contract:
 * POST {url}
 * Body: WebhookRequest
 * Response: WebhookResponse
 *
 * The webhook can return:
 * - { allowed: true } — pass through
 * - { allowed: false, violations: [...] } — block/flag
 * - { allowed: true, maskedContent: "..." } — pass with redacted content
 */
export class WebhookGuardrailPlugin implements GuardrailPlugin {
  readonly name: string;
  readonly priority: number;

  private config: Required<WebhookGuardrailConfig>;

  constructor(name: string, config: WebhookGuardrailConfig, priority: number = 50) {
    this.name = name;
    this.priority = priority;
    this.config = {
      url: config.url,
      timeoutMs: config.timeoutMs ?? 5000,
      headers: config.headers ?? {},
      blockOnFailure: config.blockOnFailure ?? false,
      retries: config.retries ?? 1,
    };
  }

  async check(content: string, context: GuardrailCheckContext): Promise<GuardrailCheckResult> {
    const body: WebhookRequest = {
      content,
      direction: context.direction,
      requestId: context.requestId,
      tenantId: context.tenantId,
      providerId: context.providerId,
      modelId: context.modelId,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
        }

        const result: WebhookResponse = await response.json() as WebhookResponse;

        return {
          allowed: result.allowed,
          violations: (result.violations || []).map(v => ({
            ...v,
            plugin: this.name,
          })),
          maskedContent: result.maskedContent,
        };
      } catch (err) {
        lastError = err as Error;
        logger.warn({
          webhook: this.name,
          attempt: attempt + 1,
          error: String(err),
        }, 'Webhook guardrail check failed');
      }
    }

    // All retries failed
    if (this.config.blockOnFailure) {
      return {
        allowed: false,
        violations: [{
          type: 'webhook_failure',
          severity: 'high',
          description: `Webhook ${this.name} failed after ${this.config.retries + 1} attempts: ${lastError?.message}`,
          plugin: this.name,
        }],
      };
    }

    // Allow on failure (fail-open)
    return { allowed: true, violations: [] };
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }
}
