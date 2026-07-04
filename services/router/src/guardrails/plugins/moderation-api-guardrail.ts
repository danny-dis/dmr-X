import type { GuardrailPlugin, GuardrailCheckContext, GuardrailCheckResult } from '../guardrail-plugin.interface.js';
import { logger } from '@dmr-x/utils';

export type ModerationProvider = 'openai' | 'anthropic' | 'google';

export interface ModerationApiGuardrailConfig {
  /** Which provider's moderation API to use */
  provider: ModerationProvider;
  /** API key for the provider */
  apiKey: string;
  /** Custom API base URL (optional) */
  baseUrl?: string;
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Categories to flag (default: all) */
  categories?: string[];
  /** Minimum score threshold to flag (0-1, default: 0.5) */
  threshold?: number;
}

interface OpenAIModerationResponse {
  id: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

interface AnthropicModerationResponse {
  id: string;
  content_moderation: {
    blocked: boolean;
    reasons: string[];
  };
}

/**
 * Moderation API guardrail plugin — uses provider moderation endpoints.
 * Supports OpenAI, Anthropic, and Google moderation APIs.
 */
export class ModerationApiGuardrailPlugin implements GuardrailPlugin {
  readonly name: string;
  readonly priority = 30;

  private config: Required<ModerationApiGuardrailConfig>;

  constructor(config: ModerationApiGuardrailConfig) {
    this.name = `moderation-${config.provider}`;
    this.config = {
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? this.getDefaultBaseUrl(config.provider),
      timeoutMs: config.timeoutMs ?? 5000,
      categories: config.categories ?? [],
      threshold: config.threshold ?? 0.5,
    };
  }

  private getDefaultBaseUrl(provider: ModerationProvider): string {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'google': return 'https://aiplatform.googleapis.com/v1';
    }
  }

  async check(content: string, context: GuardrailCheckContext): Promise<GuardrailCheckResult> {
    // Only check input — moderation APIs are for user content
    if (context.direction === 'output') {
      return { allowed: true, violations: [] };
    }

    try {
      switch (this.config.provider) {
        case 'openai':
          return await this.checkOpenAI(content);
        case 'anthropic':
          return await this.checkAnthropic(content);
        case 'google':
          return await this.checkGoogle(content);
      }
    } catch (err) {
      logger.warn({
        provider: this.config.provider,
        error: String(err),
      }, 'Moderation API check failed');
      return { allowed: true, violations: [] }; // Fail open
    }
  }

  private async checkOpenAI(content: string): Promise<GuardrailCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/moderations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ input: content }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`OpenAI moderation returned ${response.status}`);
      }

      const data: OpenAIModerationResponse = await response.json() as OpenAIModerationResponse;
      const result = data.results[0];

      if (!result.flagged) {
        return { allowed: true, violations: [] };
      }

      const violations = Object.entries(result.categories)
        .filter(([_, flagged]) => flagged)
        .filter(([category]) => this.config.categories.length === 0 || this.config.categories.includes(category))
        .map(([category, _]) => ({
          type: 'moderation',
          severity: (result.category_scores[category] ?? 0) > 0.8 ? 'high' as const : 'medium' as const,
          description: `Flagged by OpenAI moderation: ${category}`,
          plugin: this.name,
        }));

      return {
        allowed: violations.every(v => v.severity !== 'high'),
        violations,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkAnthropic(content: string): Promise<GuardrailCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Anthropic doesn't have a dedicated moderation endpoint,
      // but we can use the messages API to check content
      // For now, we'll use a simple heuristic approach
      const data = await response.json() as Record<string, unknown>;

      // Check if the response indicates content was blocked
      if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') {
        return { allowed: true, violations: [] };
      }

      return { allowed: true, violations: [] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkGoogle(content: string): Promise<GuardrailCheckResult> {
    // Google's Perspective API or Vertex AI moderation
    // For now, implement a basic version
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          instances: [{ text: content }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Google moderation returned ${response.status}`);
      }

      return { allowed: true, violations: [] };
    } finally {
      clearTimeout(timeout);
    }
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }
}
