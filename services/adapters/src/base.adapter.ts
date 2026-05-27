import type {
  ProviderAdapter,
  ProviderConfig,
  HealthStatus,
  ModelInfo,
  ExecuteOptions,
} from './adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

export abstract class BaseAdapter implements ProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly supportedModalities: Modality[];

  protected config: ProviderConfig = { baseUrl: '' };
  protected initialized = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    logger.info({ providerId: this.providerId }, 'Adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.checkHealth();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected abstract checkHealth(): Promise<void>;

  abstract execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
  abstract executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
  abstract listModels(): Promise<ModelInfo[]>;

  async dispose(): Promise<void> {
    this.initialized = false;
    logger.info({ providerId: this.providerId }, 'Adapter disposed');
  }

  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.providerId} not initialized`);
    }
  }

  protected async fetchWithTimeout(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {}
  ): Promise<Response> {
    const { timeoutMs = 30000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
