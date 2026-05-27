import { createClient } from 'redis';
import { logger } from '@dmr-x/utils';
let client = null;
export function getRedis() {
    if (!client) {
        client = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
        });
        client.on('error', (err) => {
            logger.error({ err }, 'Redis client error');
        });
    }
    return client;
}
export async function connectRedis() {
    const redis = getRedis();
    if (!redis.isOpen) {
        await redis.connect();
        logger.info('Connected to Redis');
    }
}
export async function closeRedis() {
    if (client?.isOpen) {
        await client.quit();
        client = null;
    }
}
//# sourceMappingURL=redis.js.map