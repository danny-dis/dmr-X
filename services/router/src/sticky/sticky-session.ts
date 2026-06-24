import { createHash } from 'node:crypto';

import { createNamespacedCache } from '@dmr-x/db';
import type { RateLimitService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';

const cache = createNamespacedCache('sticky');

/**
 * Sticky session service for multi-turn conversations.
 *
 * Keeps conversations on the same model for 30 minutes to prevent
 * hallucination from model switching. Keyed on SHA1 of first user message.
 *
 * Redis key: sticky:{hash} -> "providerId:modelId" with TTL=1800s
 */

const DEFAULT_TTL_SECONDS = 1800; // 30 minutes

export interface StickySession {
  providerId: string;
  modelId: string;
}

/**
 * Hash a conversation's first user message to create a stable session key.
 */
export function hashConversation(messages: Array<{ role: string; content: string | any }>): string | null {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return null;

  const content = typeof firstUserMessage.content === 'string'
    ? firstUserMessage.content
    : JSON.stringify(firstUserMessage.content);

  return createHash('sha1').update(content).digest('hex');
}

/**
 * Get the sticky provider for a conversation hash.
 * Optionally checks if the sticky provider is still available (not rate-limited).
 * Optionally checks free-tier compatibility when freeTierStrategy is 'prioritize'.
 */
export async function getStickyProvider(
  conversationHash: string,
  rateLimitService?: RateLimitService,
  freeTierStrategy?: string,
  isFreeModel?: (providerId: string, modelId: string) => boolean
): Promise<StickySession | null> {
  const key = conversationHash;

  const value = cache.get(key);
  if (!value) return null;

  const [providerId, modelId] = value.split(':');
  if (!providerId || !modelId) return null;

  // Check if sticky provider is free-tier compatible when strategy is 'prioritize'
  if (freeTierStrategy === 'prioritize' && isFreeModel) {
    if (!isFreeModel(providerId, modelId)) {
      cache.del(key);
      logger.info({ providerId, modelId }, 'Sticky session broken - provider not free-tier');
      return null;
    }
  }

  // Check if the sticky provider is still available (not rate-limited)
  if (rateLimitService) {
    const check = rateLimitService.checkLimit(providerId, modelId, 0);
    if (!check.allowed) {
      cache.del(key);
      logger.info({ providerId, modelId, reason: check.reason }, 'Sticky session broken - provider rate-limited');
      return null;
    }
  }

  return { providerId, modelId };
}

/**
 * Break a sticky session for a conversation hash.
 */
export async function breakStickySession(conversationHash: string, reason: string): Promise<void> {
  cache.del(conversationHash);
  logger.info({ conversationHash, reason }, 'Sticky session broken');
}

/**
 * Set a sticky provider for a conversation hash.
 * TTL can be adjusted based on provider rate limits.
 */
export async function setStickyProvider(
  conversationHash: string,
  providerId: string,
  modelId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  rateLimitRpm?: number
): Promise<void> {
  // Adjust TTL based on rate limits - providers with tight limits get shorter sticky sessions
  if (rateLimitRpm && rateLimitRpm > 0) {
    // For a 3 RPM provider, sticky TTL should be ~20 seconds (1 request buffer)
    // For a 30 RPM provider, sticky TTL can be the full 30 minutes
    const adjustedTtl = Math.min(ttlSeconds, Math.max(20, Math.floor(60 / rateLimitRpm) * 10));
    ttlSeconds = adjustedTtl;
  }

  cache.set(conversationHash, `${providerId}:${modelId}`, ttlSeconds);

  logger.debug(
    { conversationHash, providerId, modelId, ttlSeconds },
    'Sticky session set'
  );
}
