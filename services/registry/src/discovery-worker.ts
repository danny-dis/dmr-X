import { getDb } from '@dmr-x/db';
import { logger, eventBus, SystemEvents } from '@dmr-x/utils';
import { discoverOpenAIModels } from './model-discovery.js';
import { PROVIDER_CATALOG } from './provider-catalog.js';

/**
 * Periodically polls providers for new models.
 * If a new model is found that isn't in the database, it emits a MODEL_DISCOVERED event.
 */
export class DiscoveryWorker {
  private interval: ReturnType<typeof setInterval> | null = null;

  async start(intervalMs: number = 6 * 60 * 60 * 1000): Promise<void> {
    logger.info({ intervalMs }, 'Starting discovery worker');
    
    // Initial run
    await this.runDiscovery();

    this.interval = setInterval(() => {
      this.runDiscovery().catch(err => {
        logger.error({ err }, 'Discovery run failed');
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runDiscovery(): Promise<void> {
    const db = getDb();
    const providers = db.prepare('SELECT id, name, base_url, config FROM providers WHERE is_healthy = 1').all() as any[];

    for (const provider of providers) {
      const config = JSON.parse(provider.config || '{}');
      if (config.apiFormat !== 'openai' || !provider.base_url) continue;

      try {
        // Use an empty API key for discovery to find publicly available models
        // or the actual key if we have it in env
        const template = PROVIDER_CATALOG.find(t => t.id === provider.name);
        const apiKey = template?.envKey ? process.env[template.envKey] : '';

        const discovered = await discoverOpenAIModels({
          baseUrl: provider.base_url,
          apiKey: apiKey || '',
        });

        for (const model of discovered) {
          // Check if model already exists for this provider
          const existing = db.prepare(
            'SELECT 1 FROM model_profiles WHERE provider_id = ? AND model_id = ?'
          ).get(provider.id, model.modelId);

          if (!existing) {
            logger.info({ provider: provider.name, modelId: model.modelId }, 'New model discovered');
            eventBus.emit(SystemEvents.MODEL_DISCOVERED, {
              providerId: provider.id,
              providerName: provider.name,
              model,
            });
          }
        }
      } catch (err) {
        logger.warn({ err, provider: provider.name }, 'Discovery failed for provider');
      }
    }
  }
}

export const discoveryWorker = new DiscoveryWorker();
