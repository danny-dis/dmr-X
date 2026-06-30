import type { SecretsProvider, SecretVersion } from './types.js';
import { LocalSecretsProvider } from './local-provider.js';
import { logger } from '@dmr-x/utils';

export interface SecretsManagerConfig {
  provider?: SecretsProvider;
}

export class SecretsManager {
  private provider: SecretsProvider;

  constructor(config?: SecretsManagerConfig) {
    this.provider = config?.provider || new LocalSecretsProvider();
  }

  async getSecret(secretId: string): Promise<string | null> {
    const version = await this.provider.get(secretId);
    if (!version) return null;
    
    try {
      return (this.provider as LocalSecretsProvider).decryptValue(version.encryptedValue);
    } catch (err) {
      logger.error({ err, secretId }, 'Failed to decrypt secret');
      return null;
    }
  }

  async putSecret(secretId: string, value: string): Promise<void> {
    await this.provider.put(secretId, value);
    logger.info({ secretId }, 'Secret stored');
  }

  async rotateSecret(secretId: string, newValue: string): Promise<void> {
    await this.provider.rotate(secretId, newValue);
    logger.info({ secretId }, 'Secret rotated');
  }

  async revokeSecret(secretId: string): Promise<void> {
    await this.provider.revoke(secretId);
    logger.info({ secretId }, 'Secret revoked');
  }

  async listVersions(secretId: string): Promise<SecretVersion[]> {
    return this.provider.listVersions(secretId);
  }

  async resolveSecret(secretId: string, fallback?: string): Promise<string | null> {
    const value = await this.getSecret(secretId);
    return value ?? fallback ?? null;
  }
}

export const secretsManager = new SecretsManager();
