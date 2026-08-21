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
 *
 * `requestedModel` is part of the key because the pin is only valid for the
 * model target it was created under. Keying on the prompt alone made every
 * requested model share a single pin, so two callers that happen to open with
 * the same first message cross-contaminate: a free-only alias (`auto-eco`,
 * `free-*`) could inherit a paid pin set by `auto-smart`, silently breaking its
 * cost contract, and one alias's dead pin would surface as a 502 on a
 * completely different alias. A real multi-turn client keeps `model` constant
 * across turns, so including it here does not weaken stickiness.
 */
export function hashConversation(
  messages: Array<{ role: string; content: string | any }>,
  requestedModel?: string
): string | null {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return null;

  const content = typeof firstUserMessage.content === 'string'
    ? firstUserMessage.content
    : JSON.stringify(firstUserMessage.content);

  // Newline separator: a model id can never contain one, so the two fields
  // cannot run together into an ambiguous key.
  return createHash('sha1').update(`${requestedModel ?? ''}\n${content}`).digest('hex');
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
 *
 * NOTE (free-tier context handoff): when a sticky pin is broken mid-conversation
 * — e.g. the pinned free model hits a 429/402 cooldown and the router falls back
 * to a DIFFERENT model — the new turn answers from a different model with a
 * different context window and different system prompt expectations. The router
 * does NOT re-send the prior turn's context; the caller is responsible for
 * continuing the conversation thread. Breaking here only releases the pin so the
 * next turn re-selects freely. Anything that relied on the pinned model's
 * specific context (long-system-prompt assumptions, cached prefix, tool schema)
 * must be re-established by the caller, otherwise the handoff model sees a
 * context it did not produce. This is a known limitation of the free-tier
 * sticky break, documented here so it is not mistaken for a silent context loss.
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
