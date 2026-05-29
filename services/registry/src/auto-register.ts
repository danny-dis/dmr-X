import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { PROVIDER_CATALOG, getProviderTemplate, type ProviderTemplate, type ModelTemplate } from './provider-catalog.js';
import crypto from 'node:crypto';

/**
 * Auto-register providers from environment variables
 *
 * Scans env for known API keys and auto-creates provider + model entries.
 */
export async function autoRegisterProviders(): Promise<string[]> {
  const registered: string[] = [];
  const db = getDb();

  for (const template of PROVIDER_CATALOG) {
    const apiKey = template.envKey ? process.env[template.envKey] : undefined;
    const hasKey = !!apiKey;

    // Check if provider already exists
    const existing = db.prepare(
      'SELECT id FROM providers WHERE name = ?'
    ).get(template.id);

    if (existing) {
      logger.debug({ provider: template.id }, 'Provider already registered');
      continue;
    }

    try {
      // Create provider
      const providerId = crypto.randomUUID();
      const isActive = hasKey || template.envKey === '';
      
      db.prepare(
        `INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, is_healthy, config)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        providerId,
        template.id,
        template.id,
        template.baseUrl,
        template.envKey || '',
        isActive ? 1 : 0,
        JSON.stringify({
          authMethod: template.authMethod,
          authHeader: template.authHeader,
          apiFormat: template.apiFormat,
          streaming: template.streaming,
          toolCalling: template.toolCalling,
          signupUrl: template.signupUrl,
          hasKey,
          category: template.category,
          region: template.region,
          description: template.description,
        })
      );

      // Create model profiles
      for (const model of template.models) {
        db.prepare(
          `INSERT INTO model_profiles (
            provider_id, model_id, display_name, modality, intelligence_layer,
            supports_streaming, supports_vision, supports_tool_use, supports_json_mode,
            context_window, max_output_tokens,
            input_cost_per_1k, output_cost_per_1k, cost_per_image,
            quality_score, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          providerId,
          model.id,
          model.id,
          model.modalities[0] || 'llm',
          'executor',
          model.capabilities.includes('streaming') ? 1 : 0,
          model.capabilities.includes('vision') ? 1 : 0,
          model.capabilities.includes('tool_use') ? 1 : 0,
          model.capabilities.includes('json_mode') ? 1 : 0,
          model.contextWindow,
          model.maxOutputTokens,
          (model.inputCostPer1M || 0) / 1000,
          (model.outputCostPer1M || 0) / 1000,
          model.costPerImage || 0,
          0.5,
          isActive ? 1 : 0,
        );
      }

      registered.push(template.id);
      logger.info(
        { provider: template.id, models: template.models.length, hasKey },
        hasKey ? 'Auto-registered provider (key found)' : 'Registered provider (no key — add one to activate)'
      );
    } catch (error) {
      logger.error({ err: error, provider: template.id }, 'Failed to auto-register provider');
    }
  }

  return registered;
}

/**
 * Register a single provider from the catalog
 */
export async function registerProvider(
  providerId: string,
  overrides?: Partial<ProviderTemplate>
): Promise<string> {
  const template = getProviderTemplate(providerId);
  if (!template) {
    throw new Error(`Unknown provider: ${providerId}. Use 'dmrx providers list' to see available providers.`);
  }

  const merged = { ...template, ...overrides };
  const db = getDb();

  // Check if already exists
  const existing = db.prepare(
    'SELECT id FROM providers WHERE name = ?'
  ).get(merged.id);

  if (existing) {
    throw new Error(`Provider '${merged.id}' is already registered.`);
  }

  // Create provider
  const newProviderId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, config)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    newProviderId,
    merged.id,
    merged.id,
    merged.baseUrl,
    merged.envKey,
    JSON.stringify({
      authMethod: merged.authMethod,
      apiFormat: merged.apiFormat,
      streaming: merged.streaming,
      toolCalling: merged.toolCalling,
      signupUrl: merged.signupUrl,
    })
  );

  // Create models
  for (const model of merged.models) {
    db.prepare(
      `INSERT INTO model_profiles (
        provider_id, model_id, display_name, modality, intelligence_layer,
        supports_streaming, supports_vision, supports_tool_use,
        context_window, input_cost_per_1k, output_cost_per_1k, cost_per_image,
        quality_score, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newProviderId,
      model.id,
      model.id,
      model.modalities[0] || 'llm',
      'executor',
      model.capabilities.includes('streaming') ? 1 : 0,
      model.capabilities.includes('vision') ? 1 : 0,
      model.capabilities.includes('tool_use') ? 1 : 0,
      model.contextWindow,
      (model.inputCostPer1M || 0) / 1000,
      (model.outputCostPer1M || 0) / 1000,
      model.costPerImage || 0,
      0.5,
      1,
    );
  }

  logger.info({ provider: merged.id, models: merged.models.length }, 'Registered provider');
  return newProviderId;
}

/**
 * List all available providers from catalog
 */
export function listAvailableProviders(): ProviderTemplate[] {
  return PROVIDER_CATALOG;
}

/**
 * Discover models from a Hugging Face task
 */
export async function discoverHuggingFaceModels(
  task: string,
  limit: number = 20
): Promise<{ id: string; downloads: number; pipeline_tag: string }[]> {
  try {
    const response = await fetch(
      `https://huggingface.co/api/models?pipeline_tag=${task}&sort=downloads&direction=-1&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`HF API error: ${response.status}`);
    }

    const models = await response.json() as any[];
    return models.map((m) => ({
      id: m.id,
      downloads: m.downloads || 0,
      pipeline_tag: m.pipeline_tag || task,
    }));
  } catch (error) {
    logger.error({ err: error, task }, 'Failed to discover HF models');
    return [];
  }
}
