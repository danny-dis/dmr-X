/**
 * Dynamic Rate Limit Detection for DMR-X
 *
 * Parses rate limit headers from provider responses to track real-time
 * remaining quota. Enables smart key rotation and accurate routing.
 */

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('quota:dynamic-limits');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitHeaders {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsResetMs?: number;  // epoch milliseconds
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensResetMs?: number;
  rawHeaders?: Record<string, string>;
}

export interface RateLimitState {
  keyId: string;
  providerId: string;
  modelId?: string;
  headers: RateLimitHeaders;
  discoveredAt: Date;
}

export interface KeyQuotaStatus {
  keyId: string;
  providerId: string;
  modelId?: string;
  requestsRemaining: number | null;
  requestsLimit: number | null;
  tokensRemaining: number | null;
  tokensLimit: number | null;
  resetAtMs: number | null;
  percentRemaining: number;  // 0-100, null values = 100 (unknown = assume available)
  isExhausted: boolean;
}

// ---------------------------------------------------------------------------
// Provider Header Configurations
// ---------------------------------------------------------------------------

interface ProviderHeaderConfig {
  requestsLimit: string[];
  requestsRemaining: string[];
  requestsReset: string[];
  tokensLimit: string[];
  tokensRemaining: string[];
  tokensReset: string[];
}

const PROVIDER_HEADER_CONFIGS: Record<string, ProviderHeaderConfig> = {
  openai: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  anthropic: {
    requestsLimit: ['anthropic-ratelimit-requests-limit'],
    requestsRemaining: ['anthropic-ratelimit-requests-remaining'],
    requestsReset: ['anthropic-ratelimit-requests-reset'],
    tokensLimit: ['anthropic-ratelimit-tokens-limit'],
    tokensRemaining: ['anthropic-ratelimit-tokens-remaining'],
    tokensReset: ['anthropic-ratelimit-tokens-reset'],
  },
  groq: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  deepseek: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  cerebras: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  together: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  fireworks: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  mistral: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  xai: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  // Providers using standard x-ratelimit-* headers
  sambanova: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  nvidia: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  openrouter: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  google: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  huggingface: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  cohere: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
  moonshot: {
    requestsLimit: ['x-ratelimit-limit-requests'],
    requestsRemaining: ['x-ratelimit-remaining-requests'],
    requestsReset: ['x-ratelimit-reset-requests'],
    tokensLimit: ['x-ratelimit-limit-tokens'],
    tokensRemaining: ['x-ratelimit-remaining-tokens'],
    tokensReset: ['x-ratelimit-reset-tokens'],
  },
};

// Generic fallback config for unknown providers (tries standard x-ratelimit-* headers)
const GENERIC_HEADER_CONFIG: ProviderHeaderConfig = {
  requestsLimit: ['x-ratelimit-limit-requests', 'ratelimit-limit-requests'],
  requestsRemaining: ['x-ratelimit-remaining-requests', 'ratelimit-remaining-requests'],
  requestsReset: ['x-ratelimit-reset-requests', 'ratelimit-reset-requests'],
  tokensLimit: ['x-ratelimit-limit-tokens', 'ratelimit-limit-tokens'],
  tokensRemaining: ['x-ratelimit-remaining-tokens', 'ratelimit-remaining-tokens'],
  tokensReset: ['x-ratelimit-reset-tokens', 'ratelimit-reset-tokens'],
};

// ---------------------------------------------------------------------------
// Header Parsing
// ---------------------------------------------------------------------------

/**
 * Parse rate limit headers from a provider response.
 * Falls back to generic x-ratelimit-* patterns for unknown providers.
 */
export function parseRateLimitHeaders(
  headers: Headers | Record<string, string>,
  provider: string
): RateLimitHeaders {
  const config = PROVIDER_HEADER_CONFIGS[provider] ?? GENERIC_HEADER_CONFIG;

  const getHeader = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  };

  const parseNumber = (value: string | null): number | undefined => {
    if (value === null) return undefined;
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  };

  const parseResetTime = (value: string | null): number | undefined => {
    if (value === null) return undefined;
    
    // Try parsing as seconds from now
    const seconds = Number(value);
    if (!Number.isNaN(seconds)) {
      // If it's a small number, treat as seconds from now
      if (seconds < 3600) {
        return Date.now() + seconds * 1000;
      }
      // Otherwise treat as epoch timestamp
      return seconds * 1000;
    }
    
    // Try parsing as HTTP date
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
    
    return undefined;
  };

  // Try each header name in the config (some providers use different names)
  const findFirst = (names: string[]): string | null => {
    for (const name of names) {
      const value = getHeader(name);
      if (value !== null) return value;
    }
    return null;
  };

  return {
    requestsLimit: parseNumber(findFirst(config.requestsLimit)),
    requestsRemaining: parseNumber(findFirst(config.requestsRemaining)),
    requestsResetMs: parseResetTime(findFirst(config.requestsReset)),
    tokensLimit: parseNumber(findFirst(config.tokensLimit)),
    tokensRemaining: parseNumber(findFirst(config.tokensRemaining)),
    tokensResetMs: parseResetTime(findFirst(config.tokensReset)),
  };
}

/**
 * Check if a provider has a known header config (all providers are supported via generic fallback)
 */
export function supportsRateLimitHeaders(provider: string): boolean {
  // All providers are now supported via the generic x-ratelimit-* fallback
  return true;
}

// ---------------------------------------------------------------------------
// Quota Status Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate quota status for a key based on rate limit headers
 */
export function calculateQuotaStatus(params: {
  keyId: string;
  providerId: string;
  modelId?: string;
  headers: RateLimitHeaders;
  defaultLimits?: {
    rpm?: number;
    tpm?: number;
  };
}): KeyQuotaStatus {
  const { keyId, providerId, modelId, headers, defaultLimits } = params;

  // Use discovered limits or fall back to defaults
  const requestsLimit = headers.requestsLimit ?? defaultLimits?.rpm ?? null;
  const tokensLimit = headers.tokensLimit ?? defaultLimits?.tpm ?? null;
  const requestsRemaining = headers.requestsRemaining ?? null;
  const tokensRemaining = headers.tokensRemaining ?? null;

  // Calculate reset time (use the later of request/token reset)
  const resetAtMs = Math.max(
    headers.requestsResetMs ?? 0,
    headers.tokensResetMs ?? 0
  ) || null;

  // Calculate percentage remaining
  let percentRemaining = 100;
  if (requestsLimit !== null && requestsRemaining !== null) {
    percentRemaining = Math.min(percentRemaining, (requestsRemaining / requestsLimit) * 100);
  }
  if (tokensLimit !== null && tokensRemaining !== null) {
    percentRemaining = Math.min(percentRemaining, (tokensRemaining / tokensLimit) * 100);
  }

  // Check if exhausted
  const isExhausted = 
    (requestsRemaining !== null && requestsRemaining <= 0) ||
    (tokensRemaining !== null && tokensRemaining <= 0);

  return {
    keyId,
    providerId,
    modelId,
    requestsRemaining,
    requestsLimit,
    tokensRemaining,
    tokensLimit,
    resetAtMs,
    percentRemaining,
    isExhausted,
  };
}

/**
 * Compare two keys by quota status (for sorting)
 * Returns negative if a should be preferred over b
 */
export function compareKeyQuota(
  a: KeyQuotaStatus,
  b: KeyQuotaStatus
): number {
  // Exhausted keys always go last
  if (a.isExhausted !== b.isExhausted) {
    return a.isExhausted ? 1 : -1;
  }

  // Prefer keys with more percentage remaining
  return b.percentRemaining - a.percentRemaining;
}

// ---------------------------------------------------------------------------
// Error Message Parsing (Self-Correcting)
// ---------------------------------------------------------------------------

interface ParsedLimit {
  limit: number;
  axis: 'rpm' | 'tpm' | 'rpd' | 'tpd';
}

/**
 * Parse rate limit from provider error messages
 * Examples:
 * - Groq: "Limit 30000, Requested 33476"
 * - OpenAI: "You have exceeded your request rate limit"
 */
export function parseLimitFromError(errorMessage: string): ParsedLimit | null {
  // Pattern: "Limit NNNN, Requested NNNN"
  const limitMatch = errorMessage.match(/Limit\s+(\d+)/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10);
    // Determine axis from context
    if (errorMessage.toLowerCase().includes('token')) {
      return { limit, axis: 'tpm' };
    }
    return { limit, axis: 'rpm' };
  }

  // Pattern: "rate limit of NNNN requests"
  const rateLimitMatch = errorMessage.match(/rate limit of (\d+) requests/i);
  if (rateLimitMatch) {
    return { limit: parseInt(rateLimitMatch[1], 10), axis: 'rpm' };
  }

  // Pattern: "token rate limit of NNNN"
  const tokenLimitMatch = errorMessage.match(/token.*?limit of (\d+)/i);
  if (tokenLimitMatch) {
    return { limit: parseInt(tokenLimitMatch[1], 10), axis: 'tpm' };
  }

  return null;
}
