import { createClient, type RedisClientType } from 'redis';
import { logger } from '@dmr-x/utils';

let client: RedisClientType | null = null;

export function getRedis(): RedisClientType {
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

export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis.isOpen) {
    await redis.connect();
    logger.info('Connected to Redis');
  }
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) {
    await client.quit();
    client = null;
  }
}
