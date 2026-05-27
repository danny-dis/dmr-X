import { createHash } from 'node:crypto';
import { getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
/**
 * Sticky session service for multi-turn conversations.
 *
 * Keeps conversations on the same model for 30 minutes to prevent
 * hallucination from model switching. Keyed on SHA1 of first user message.
 *
 * Redis key: sticky:{hash} -> "providerId:modelId" with TTL=1800s
 */
const DEFAULT_TTL_SECONDS = 1800; // 30 minutes
/**
 * Hash a conversation's first user message to create a stable session key.
 */
export function hashConversation(messages) {
    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (!firstUserMessage)
        return null;
    const content = typeof firstUserMessage.content === 'string'
        ? firstUserMessage.content
        : JSON.stringify(firstUserMessage.content);
    return createHash('sha1').update(content).digest('hex');
}
/**
 * Get the sticky provider for a conversation hash.
 */
export async function getStickyProvider(conversationHash) {
    const redis = getRedis();
    const key = `sticky:${conversationHash}`;
    const value = await redis.get(key);
    if (!value)
        return null;
    const [providerId, modelId] = value.split(':');
    if (!providerId || !modelId)
        return null;
    return { providerId, modelId };
}
/**
 * Set a sticky provider for a conversation hash.
 */
export async function setStickyProvider(conversationHash, providerId, modelId, ttlSeconds = DEFAULT_TTL_SECONDS) {
    const redis = getRedis();
    const key = `sticky:${conversationHash}`;
    await redis.set(key, `${providerId}:${modelId}`, { EX: ttlSeconds });
    logger.debug({ conversationHash, providerId, modelId, ttlSeconds }, 'Sticky session set');
}
//# sourceMappingURL=sticky-session.js.map