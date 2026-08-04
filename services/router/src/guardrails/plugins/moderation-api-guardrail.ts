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
  /** Model id for providers that classify via a generation endpoint (anthropic/google) */
  model?: string;
  /** Google Vertex AI project (required when baseUrl is aiplatform.googleapis.com) */
  project?: string;
  /** Google Vertex AI location (default: us-central1) */
  location?: string;
}

interface OpenAIModerationResponse {
  id: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

/**
 * Anthropic/Google don't have a dedicated moderation endpoint, so we prompt a
 * chat model to act as a strict classifier and ask it to reply with a single
 * JSON object. Models routinely wrap that JSON in prose or a ```json fence
 * even when told not to, so we parse defensively:
 *   1. try the raw text as-is,
 *   2. strip a markdown code fence and try the interior,
 *   3. fall back to the first balanced {...} object found anywhere in the text.
 * Returns null when none of that yields a JSON object — callers treat null as
 * a classification failure and fail closed (see `checkAnthropic`).
 */
function extractStructuredJson(text: string): { flagged?: unknown; categories?: unknown } | null {
  const candidates: string[] = [text.trim()];

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
  }

  const braceStart = text.indexOf('{');
  if (braceStart !== -1) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(braceStart, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === 'object') {
        return value as { flagged?: unknown; categories?: unknown };
      }
    } catch {
      // Not valid JSON — try the next candidate.
    }
  }

  return null;
}

/**
 * Subset of the category values the `checkAnthropic` system prompt allows
 * the classifier to return (hate, harassment, self_harm, sexual, violence,
 * dangerous, illegal) that we treat as severe enough to block outright.
 * Harassment and sexual content are still flagged (medium) but not treated
 * as automatically blocking on their own.
 */
const HIGH_MODERATION_CATEGORIES = ['hate', 'self_harm', 'violence', 'dangerous', 'illegal'] as const;

/**
 * Gemini `safetySettings` category enum values. We set every threshold to
 * BLOCK_NONE so the model doesn't refuse on our behalf — instead it returns
 * `safetyRatings` for every category, which `checkGoogle` scores itself.
 */
const GEMINI_SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const;

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
      model: config.model ?? (config.provider === 'google' ? 'gemini-1.5-pro' : 'claude-3-haiku-20240307'),
      project: config.project ?? '',
      location: config.location ?? 'us-central1',
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
      // Fail CLOSED: a moderation provider outage must not let content through
      return {
        allowed: false,
        violations: [{
          type: 'moderation_error',
          severity: 'high',
          description: `Moderation check failed (${this.config.provider}): ${(err as Error).message}`,
          plugin: this.name,
        }],
      };
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
          model: this.config.model,
          max_tokens: 512,
          temperature: 0,
          system: [
            'You are a strict content moderation classifier.',
            'Given the user message, respond with ONLY a JSON object of the form:',
            '{"flagged": true or false, "categories": ["category", ...]}.',
            'Flag the content when it contains: hate speech, harassment, violence,',
            'self-harm, sexual or explicit material, or dangerous or illegal instructions.',
            'Allowed category values: hate, harassment, self_harm, sexual, violence, dangerous, illegal.',
            'Return {"flagged": false, "categories": []} when the content is benign.',
          ].join(' '),
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Anthropic moderation returned ${response.status}`);
      }

      const data = await response.json() as Record<string, any>;
      if (data.type === 'error' ||
          data.stop_reason === 'max_tokens' ||
          !Array.isArray(data.content) ||
          typeof data.content[0]?.text !== 'string') {
        throw new Error('Anthropic moderation returned no classification output');
      }

      const parsed = extractStructuredJson(data.content[0].text);
      if (parsed === null) {
        throw new Error('Anthropic moderation returned unparseable JSON');
      }
      if (parsed.flagged !== true) {
        return { allowed: true, violations: [] };
      }

      const categories = Array.isArray(parsed.categories) ? parsed.categories.map(String) : [];
      const violations = categories
        .filter((category) => this.config.categories.length === 0 || this.config.categories.includes(category))
        .map((category) => ({
          type: 'moderation',
          severity: (HIGH_MODERATION_CATEGORIES as readonly string[]).includes(category) ? 'high' as const : 'medium' as const,
          description: `Flagged by Anthropic moderation: ${category}`,
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

  private async checkGoogle(content: string): Promise<GuardrailCheckResult> {
    const isVertex = this.config.baseUrl.includes('aiplatform.googleapis.com');
    if (isVertex && !this.config.project) {
      throw new Error('Google (Vertex AI) moderation requires a "project" in the guardrail config');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const endpoint = isVertex
        ? `${this.config.baseUrl}/projects/${this.config.project}/locations/${this.config.location}/publishers/google/models/${this.config.model}:generateContent`
        : `${this.config.baseUrl}/models/${this.config.model}:generateContent`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isVertex
            ? { 'Authorization': `Bearer ${this.config.apiKey}` }
            : { 'x-goog-api-key': this.config.apiKey }),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: content }] }],
          safetySettings: GEMINI_SAFETY_CATEGORIES.map((category) => ({ category, threshold: 'BLOCK_NONE' })),
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Google moderation returned ${response.status}`);
      }

      const data = await response.json() as Record<string, any>;
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const ratings = candidates.flatMap((c: any) => (Array.isArray(c?.safetyRatings) ? c.safetyRatings : []));

      const violations = ratings
        .filter((r: any) => (r?.blocked === true || r?.probability === 'HIGH') &&
          (this.config.categories.length === 0 || this.config.categories.includes(r.category)))
        .map((r: any) => ({
          type: 'moderation',
          severity: 'high' as const,
          description: `Flagged by Google moderation: ${r.category ?? 'unknown'}`,
          plugin: this.name,
        }));

      return {
        allowed: violations.length === 0,
        violations,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }
}
