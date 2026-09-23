/**
 * Provider quota adapters — Phase 4 of the free inference control plane.
 *
 * Each adapter translates provider-specific response headers into the
 * canonical QuotaDimension format. This is the bridge between the heterogeneous
 * provider APIs and the unified quota domain.
 *
 * See docs/DMRX-FREE-INFERENCE-IMPLEMENTATION-PLAN.md Phase 4.
 */

import {
  QuotaDimension,
  QuotaScope,
  QuotaState,
  QuotaUnit,
  ReplenishmentModel,
  DemandVector,
} from './quota-dimensions.js';
import { buildDimension } from './quota-vector.js';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export interface QuotaEvent {
  state: QuotaState;
  retryable: boolean;
  dimension?: QuotaUnit;
  retryAtMs?: number | null;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Scope identification
// ---------------------------------------------------------------------------

export interface ScopeInfo {
  keyId: string;
  modelId: string;
  projectId?: string;
  accountId?: string;
}

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

export interface ProviderQuotaAdapter {
  providerId: string;

  /**
   * Parse provider-specific headers into canonical QuotaDimension[].
   * Returns one dimension per measured axis (requests, tokens, concurrency, etc).
   */
  parseHeaders(
    headers: Record<string, string>,
    scopeInfo: ScopeInfo,
  ): QuotaDimension[];

  /**
   * Classify an error response into a QuotaEvent for state transitions.
   */
  classifyError(error: {
    status?: number;
    message?: string;
    code?: string;
    headers?: Record<string, string>;
  }): QuotaEvent;

  /**
   * Estimate resource demand for a request.
   */
  estimateDemand(request: {
    messages?: unknown[];
    max_tokens?: number;
  }): DemandVector;
}

// ---------------------------------------------------------------------------
// Helper: parse standard x-ratelimit-* headers
// ---------------------------------------------------------------------------

function parseStandardHeaders(
  headers: Record<string, string>,
  scopeInfo: ScopeInfo,
  scope: QuotaScope = 'key',
  prefix: string = 'x-ratelimit',
): QuotaDimension[] {
  const dims: QuotaDimension[] = [];
  const now = Date.now();

  const reqLimit = parseInt(headers[`${prefix}-limit-requests`] ?? '');
  const reqRemaining = parseInt(headers[`${prefix}-remaining-requests`] ?? '');
  const reqReset = headers[`${prefix}-reset-requests`];

  if (!isNaN(reqLimit) || !isNaN(reqRemaining)) {
    const state: QuotaState =
      reqRemaining === 0 ? 'exhausted' :
      reqRemaining !== undefined && reqRemaining < 0 ? 'exhausted' :
      'available';

    dims.push(buildDimension({
      unit: 'requests',
      scope,
      scopeId: scopeInfo.keyId,
      limit: isNaN(reqLimit) ? null : reqLimit,
      remaining: isNaN(reqRemaining) ? null : Math.max(0, reqRemaining),
      replenishment: 'sliding_window',
      resetAtMs: reqReset ? parseResetTime(reqReset) : null,
      state,
      confidence: 0.9,
      observedAtMs: now,
    }));
  }

  const tokLimit = parseInt(headers[`${prefix}-limit-tokens`] ?? '');
  const tokRemaining = parseInt(headers[`${prefix}-remaining-tokens`] ?? '');
  const tokReset = headers[`${prefix}-reset-tokens`];

  if (!isNaN(tokLimit) || !isNaN(tokRemaining)) {
    const state: QuotaState =
      tokRemaining === 0 ? 'exhausted' :
      tokRemaining !== undefined && tokRemaining < 0 ? 'exhausted' :
      'available';

    dims.push(buildDimension({
      unit: 'total_tokens',
      scope,
      scopeId: scopeInfo.modelId,
      limit: isNaN(tokLimit) ? null : tokLimit,
      remaining: isNaN(tokRemaining) ? null : Math.max(0, tokRemaining),
      replenishment: 'sliding_window',
      resetAtMs: tokReset ? parseResetTime(tokReset) : null,
      state,
      confidence: 0.9,
      observedAtMs: now,
    }));
  }

  return dims;
}

function parseResetTime(value: string): number | null {
  const seconds = Number(value);
  if (!isNaN(seconds)) {
    if (seconds < 3600) return Date.now() + seconds * 1000;
    return seconds * 1000;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.getTime();
}

// ---------------------------------------------------------------------------
// Generic adapter (fallback)
// ---------------------------------------------------------------------------

class GenericAdapter implements ProviderQuotaAdapter {
  providerId = 'generic';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    return parseStandardHeaders(headers, scopeInfo);
  }

  classifyError(error: { status?: number; message?: string; code?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Rate limited' };
    }
    if (error.status === 401 || error.status === 403) {
      return { state: 'unknown', retryable: false, reason: 'Auth failure' };
    }
    if (error.status === 400) {
      return { state: 'unknown', retryable: false, reason: 'Bad request' };
    }
    if (error.status && error.status >= 500) {
      return { state: 'unknown', retryable: true, reason: 'Server error' };
    }
    return { state: 'unknown', retryable: false, reason: 'Unknown error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Google Gemini adapter
// ---------------------------------------------------------------------------

class GeminiAdapter implements ProviderQuotaAdapter {
  providerId = 'gemini';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Gemini uses project-level quota
    const projectId = scopeInfo.projectId || scopeInfo.keyId;

    // RPM
    const rpmLimit = parseInt(headers['x-ratelimit-limit-requests'] ?? '');
    const rpmRemaining = parseInt(headers['x-ratelimit-remaining-requests'] ?? '');
    if (!isNaN(rpmLimit) || !isNaN(rpmRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'project',
        scopeId: projectId,
        limit: isNaN(rpmLimit) ? null : rpmLimit,
        remaining: isNaN(rpmRemaining) ? null : rpmRemaining,
        replenishment: 'sliding_window',
        resetAtMs: now + 60_000,
        state: rpmRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.85,
        observedAtMs: now,
      }));
    }

    // Input TPM
    const tpmLimit = parseInt(headers['x-ratelimit-limit-tokens'] ?? '');
    const tpmRemaining = parseInt(headers['x-ratelimit-remaining-tokens'] ?? '');
    if (!isNaN(tpmLimit) || !isNaN(tpmRemaining)) {
      dims.push(buildDimension({
        unit: 'input_tokens',
        scope: 'project',
        scopeId: projectId,
        limit: isNaN(tpmLimit) ? null : tpmLimit,
        remaining: isNaN(tpmRemaining) ? null : tpmRemaining,
        replenishment: 'sliding_window',
        resetAtMs: now + 60_000,
        state: tpmRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.85,
        observedAtMs: now,
      }));
    }

    // RPD
    const rpdLimit = parseInt(headers['x-ratelimit-limit-requests-day'] ?? '');
    const rpdRemaining = parseInt(headers['x-ratelimit-remaining-requests-day'] ?? '');
    if (!isNaN(rpdLimit) || !isNaN(rpdRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'project',
        scopeId: projectId,
        limit: isNaN(rpdLimit) ? null : rpdLimit,
        remaining: isNaN(rpdRemaining) ? null : rpdRemaining,
        replenishment: 'fixed_window',
        resetAtMs: now + 24 * 60 * 60 * 1000,
        state: rpdRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.8,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, dimension: 'requests', reason: 'Gemini rate limit' };
    }
    if (error.status === 400 && error.message?.includes('API key')) {
      return { state: 'unknown', retryable: false, reason: 'Invalid API key' };
    }
    return { state: 'unknown', retryable: false, reason: 'Gemini error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Groq adapter
// ---------------------------------------------------------------------------

class GroqAdapter implements ProviderQuotaAdapter {
  providerId = 'groq';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Groq exposes RPM, RPD, TPM, TPD, and optional ITPM/OTPM
    const configs: Array<{ prefix: string; unit: QuotaUnit; scope: QuotaScope; scopeId: string }> = [
      { prefix: 'x-ratelimit-limit-requests', unit: 'requests', scope: 'key', scopeId: scopeInfo.keyId },
      { prefix: 'x-ratelimit-limit-tokens', unit: 'total_tokens', scope: 'model', scopeId: scopeInfo.modelId },
    ];

    for (const cfg of configs) {
      const limit = parseInt(headers[`${cfg.prefix}`] ?? '');
      const remaining = parseInt(headers[`${cfg.prefix.replace('limit', 'remaining')}`] ?? '');
      const reset = headers[`${cfg.prefix.replace('limit', 'reset')}`];

      if (!isNaN(limit) || !isNaN(remaining)) {
        dims.push(buildDimension({
          unit: cfg.unit,
          scope: cfg.scope,
          scopeId: cfg.scopeId,
          limit: isNaN(limit) ? null : limit,
          remaining: isNaN(remaining) ? null : remaining,
          replenishment: 'sliding_window',
          resetAtMs: reset ? parseResetTime(reset) : null,
          state: remaining === 0 ? 'exhausted' : 'available',
          confidence: 0.9,
          observedAtMs: now,
        }));
      }
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Groq rate limit' };
    }
    return { state: 'unknown', retryable: false, reason: 'Groq error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Cerebras adapter
// ---------------------------------------------------------------------------

class CerebrasAdapter implements ProviderQuotaAdapter {
  providerId = 'cerebras';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Cerebras uses token-bucket replenishment
    const reqLimit = parseInt(headers['x-ratelimit-limit-requests'] ?? '');
    const reqRemaining = parseInt(headers['x-ratelimit-remaining-requests'] ?? '');
    if (!isNaN(reqLimit) || !isNaN(reqRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: scopeInfo.keyId,
        limit: isNaN(reqLimit) ? null : reqLimit,
        remaining: isNaN(reqRemaining) ? null : reqRemaining,
        replenishment: 'token_bucket',
        resetAtMs: now + 60_000,
        state: reqRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.85,
        observedAtMs: now,
      }));
    }

    const tokLimit = parseInt(headers['x-ratelimit-limit-tokens'] ?? '');
    const tokRemaining = parseInt(headers['x-ratelimit-remaining-tokens'] ?? '');
    if (!isNaN(tokLimit) || !isNaN(tokRemaining)) {
      dims.push(buildDimension({
        unit: 'total_tokens',
        scope: 'model',
        scopeId: scopeInfo.modelId,
        limit: isNaN(tokLimit) ? null : tokLimit,
        remaining: isNaN(tokRemaining) ? null : tokRemaining,
        replenishment: 'token_bucket',
        resetAtMs: now + 60_000,
        state: tokRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.85,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Cerebras rate limit' };
    }
    return { state: 'unknown', retryable: false, reason: 'Cerebras error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    // Cerebras recommends reserving input + max_output
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// SambaNova adapter
// ---------------------------------------------------------------------------

class SambaNovaAdapter implements ProviderQuotaAdapter {
  providerId = 'sambanova';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Minute request limit
    const rpmLimit = parseInt(headers['x-ratelimit-limit-requests'] ?? '');
    const rpmRemaining = parseInt(headers['x-ratelimit-remaining-requests'] ?? '');
    if (!isNaN(rpmLimit) || !isNaN(rpmRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: scopeInfo.keyId,
        limit: isNaN(rpmLimit) ? null : rpmLimit,
        remaining: isNaN(rpmRemaining) ? null : rpmRemaining,
        replenishment: 'sliding_window',
        resetAtMs: now + 60_000,
        state: rpmRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.85,
        observedAtMs: now,
      }));
    }

    // Daily request limit (separate bucket)
    const rpdLimit = parseInt(headers['x-ratelimit-limit-requests-day'] ?? '');
    const rpdRemaining = parseInt(headers['x-ratelimit-remaining-requests-day'] ?? '');
    if (!isNaN(rpdLimit) || !isNaN(rpdRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: `${scopeInfo.keyId}:daily`,
        limit: isNaN(rpdLimit) ? null : rpdLimit,
        remaining: isNaN(rpdRemaining) ? null : rpdRemaining,
        replenishment: 'fixed_window',
        resetAtMs: now + 24 * 60 * 60 * 1000,
        state: rpdRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.8,
        observedAtMs: now,
      }));
    }

    // Daily token limit
    const tpdLimit = parseInt(headers['x-ratelimit-limit-tokens-day'] ?? '');
    const tpdRemaining = parseInt(headers['x-ratelimit-remaining-tokens-day'] ?? '');
    if (!isNaN(tpdLimit) || !isNaN(tpdRemaining)) {
      dims.push(buildDimension({
        unit: 'total_tokens',
        scope: 'model',
        scopeId: scopeInfo.modelId,
        limit: isNaN(tpdLimit) ? null : tpdLimit,
        remaining: isNaN(tpdRemaining) ? null : tpdRemaining,
        replenishment: 'fixed_window',
        resetAtMs: now + 24 * 60 * 60 * 1000,
        state: tpdRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.8,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'SambaNova rate limit' };
    }
    return { state: 'unknown', retryable: false, reason: 'SambaNova error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// OpenRouter adapter
// ---------------------------------------------------------------------------

class OpenRouterAdapter implements ProviderQuotaAdapter {
  providerId = 'openrouter';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    // OpenRouter has two layers: DMR-X→OpenRouter→upstream
    // We only track OpenRouter account-level quota here
    return parseStandardHeaders(headers, scopeInfo, 'account');
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      // Don't conflate upstream failures with account exhaustion
      return { state: 'cooling_down', retryable: true, reason: 'OpenRouter rate limit (account-level)' };
    }
    if (error.status === 402) {
      return { state: 'exhausted', retryable: false, reason: 'OpenRouter account exhausted' };
    }
    return { state: 'unknown', retryable: false, reason: 'OpenRouter error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Mistral adapter
// ---------------------------------------------------------------------------

class MistralAdapter implements ProviderQuotaAdapter {
  providerId = 'mistral';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Mistral uses minute-specific header names
    const reqLimit = parseInt(headers['x-ratelimit-limit-req-minute'] ?? '');
    const reqRemaining = parseInt(headers['x-ratelimit-remaining-req-minute'] ?? '');
    if (!isNaN(reqLimit) || !isNaN(reqRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'key',
        scopeId: scopeInfo.keyId,
        limit: isNaN(reqLimit) ? null : reqLimit,
        remaining: isNaN(reqRemaining) ? null : reqRemaining,
        replenishment: 'sliding_window',
        resetAtMs: now + 60_000,
        state: reqRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.9,
        observedAtMs: now,
      }));
    }

    const tokLimit = parseInt(headers['x-ratelimit-limit-tokens-minute'] ?? '');
    const tokRemaining = parseInt(headers['x-ratelimit-remaining-tokens-minute'] ?? '');
    if (!isNaN(tokLimit) || !isNaN(tokRemaining)) {
      dims.push(buildDimension({
        unit: 'total_tokens',
        scope: 'model',
        scopeId: scopeInfo.modelId,
        limit: isNaN(tokLimit) ? null : tokLimit,
        remaining: isNaN(tokRemaining) ? null : tokRemaining,
        replenishment: 'sliding_window',
        resetAtMs: now + 60_000,
        state: tokRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.9,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Mistral rate limit' };
    }
    return { state: 'unknown', retryable: false, reason: 'Mistral error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Cohere adapter
// ---------------------------------------------------------------------------

class CohereAdapter implements ProviderQuotaAdapter {
  providerId = 'cohere';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Cohere trial quotas via x-trial-endpoint-call-*
    const trialLimit = parseInt(headers['x-trial-endpoint-call-limit'] ?? '');
    const trialRemaining = parseInt(headers['x-trial-endpoint-call-remaining'] ?? '');
    if (!isNaN(trialLimit) || !isNaN(trialRemaining)) {
      dims.push(buildDimension({
        unit: 'requests',
        scope: 'account',
        scopeId: scopeInfo.accountId || scopeInfo.keyId,
        limit: isNaN(trialLimit) ? null : trialLimit,
        remaining: isNaN(trialRemaining) ? null : trialRemaining,
        replenishment: 'fixed_window',
        resetAtMs: now + 30 * 24 * 60 * 60 * 1000, // monthly
        state: trialRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.8,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Cohere trial rate limit' };
    }
    if (error.status === 402) {
      return { state: 'exhausted', retryable: false, reason: 'Cohere trial exhausted' };
    }
    return { state: 'unknown', retryable: false, reason: 'Cohere error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI adapter
// ---------------------------------------------------------------------------

class CloudflareAdapter implements ProviderQuotaAdapter {
  providerId = 'cloudflare';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    const dims: QuotaDimension[] = [];
    const now = Date.now();

    // Cloudflare tracks Neurons/day
    const neuronLimit = parseInt(headers['x-ratelimit-limit-neurons'] ?? '');
    const neuronRemaining = parseInt(headers['x-ratelimit-remaining-neurons'] ?? '');
    if (!isNaN(neuronLimit) || !isNaN(neuronRemaining)) {
      dims.push(buildDimension({
        unit: 'neurons',
        scope: 'account',
        scopeId: scopeInfo.accountId || scopeInfo.keyId,
        limit: isNaN(neuronLimit) ? null : neuronLimit,
        remaining: isNaN(neuronRemaining) ? null : neuronRemaining,
        replenishment: 'fixed_window',
        resetAtMs: now + 24 * 60 * 60 * 1000,
        state: neuronRemaining === 0 ? 'exhausted' : 'available',
        confidence: 0.8,
        observedAtMs: now,
      }));
    }

    return dims;
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'Cloudflare neurons exhausted' };
    }
    return { state: 'unknown', retryable: false, reason: 'Cloudflare error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Hugging Face adapter
// ---------------------------------------------------------------------------

class HuggingFaceAdapter implements ProviderQuotaAdapter {
  providerId = 'huggingface';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    // HF free allocation is monthly credit balance
    return parseStandardHeaders(headers, scopeInfo, 'account');
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'HF rate limit' };
    }
    if (error.status === 402) {
      return { state: 'exhausted', retryable: false, reason: 'HF monthly credit exhausted' };
    }
    return { state: 'unknown', retryable: false, reason: 'HF error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// NVIDIA NIM adapter
// ---------------------------------------------------------------------------

class NvidiaNimAdapter implements ProviderQuotaAdapter {
  providerId = 'nvidia';

  parseHeaders(headers: Record<string, string>, scopeInfo: ScopeInfo): QuotaDimension[] {
    return parseStandardHeaders(headers, scopeInfo, 'model');
  }

  classifyError(error: { status?: number; message?: string }): QuotaEvent {
    if (error.status === 429) {
      return { state: 'cooling_down', retryable: true, reason: 'NVIDIA NIM rate limit' };
    }
    return { state: 'unknown', retryable: false, reason: 'NVIDIA NIM error' };
  }

  estimateDemand(request: { messages?: unknown[]; max_tokens?: number }): DemandVector {
    const outputTokens = request.max_tokens ?? 1000;
    const messages = request.messages ?? [];
    const inputChars = JSON.stringify(messages).length;
    const inputTokens = Math.ceil(inputChars / 4);
    return { requests: 1, inputTokens, outputTokens, concurrency: 1 };
  }
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const ADAPTERS: Map<string, ProviderQuotaAdapter> = new Map([
  ['gemini', new GeminiAdapter()],
  ['groq', new GroqAdapter()],
  ['cerebras', new CerebrasAdapter()],
  ['sambanova', new SambaNovaAdapter()],
  ['openrouter', new OpenRouterAdapter()],
  ['mistral', new MistralAdapter()],
  ['cohere', new CohereAdapter()],
  ['cloudflare', new CloudflareAdapter()],
  ['huggingface', new HuggingFaceAdapter()],
  ['nvidia', new NvidiaNimAdapter()],
]);

const GENERIC = new GenericAdapter();

/**
 * Get the adapter for a provider. Falls back to generic for unknown providers.
 */
export function getProviderAdapter(providerId: string): ProviderQuotaAdapter {
  return ADAPTERS.get(providerId.toLowerCase()) ?? GENERIC;
}

/**
 * Check if a provider has a dedicated adapter.
 */
export function hasProviderAdapter(providerId: string): boolean {
  return ADAPTERS.has(providerId.toLowerCase());
}

/**
 * Get all registered provider IDs.
 */
export function getRegisteredProviders(): string[] {
  return Array.from(ADAPTERS.keys());
}
