import type { SecretsProvider, SecretVersion } from './types.js';
import { LocalSecretsProvider } from './local-provider.js';
import { logger } from '@dmr-x/utils';

const CACHE_TTL_MS = 5_000; // 5 seconds

export interface SecretsManagerConfig {
  provider?: SecretsProvider;
  cacheTtlMs?: number;
}

export class SecretsManager {
  private provider: SecretsProvider;
  private cacheTtlMs: number;
  private cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(config?: SecretsManagerConfig) {
    this.provider = config?.provider || new LocalSecretsProvider();
    this.cacheTtlMs = config?.cacheTtlMs ?? CACHE_TTL_MS;
  }

  async getSecret(secretId: string): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const version = await this.provider.get(secretId);
    if (!version) return null;

    try {
      const value = this.provider.decryptValue(version.encryptedValue);
      // Cache the decrypted value
      this.cache.set(secretId, { value, expiresAt: Date.now() + this.cacheTtlMs });
      return value;
    } catch (err) {
      logger.error({ err, secretId }, 'Failed to decrypt secret');
      return null;
    }
  }

  async putSecret(secretId: string, value: string): Promise<void> {
    await this.provider.put(secretId, value);
    this.cache.delete(secretId); // Invalidate cache
    logger.info({ secretId }, 'Secret stored');
  }

  async rotateSecret(secretId: string, newValue: string): Promise<void> {
    await this.provider.rotate(secretId, newValue);
    this.cache.delete(secretId); // Invalidate cache
    logger.info({ secretId }, 'Secret rotated');
  }

  async revokeSecret(secretId: string): Promise<void> {
    await this.provider.revoke(secretId);
    this.cache.delete(secretId); // Invalidate cache
    logger.info({ secretId }, 'Secret revoked');
  }

  async listVersions(secretId: string): Promise<SecretVersion[]> {
    return this.provider.listVersions(secretId);
  }

  async resolveSecret(secretId: string, fallback?: string): Promise<string | null> {
    const value = await this.getSecret(secretId);
    return value ?? fallback ?? null;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const secretsManager = new SecretsManager();
