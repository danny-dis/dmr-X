import { getPool } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { PROVIDER_CATALOG, getProviderTemplate, type ProviderTemplate, type ModelTemplate } from './provider-catalog.js';

/**
 * Auto-register providers from environment variables
 *
 * Scans env for known API keys and auto-creates provider + model entries.
 */
export async function autoRegisterProviders(): Promise<string[]> {
  const registered: string[] = [];
  const pool = getPool();

  for (const template of PROVIDER_CATALOG) {
    const apiKey = process.env[template.envKey];

    if (!apiKey && template.category !== 'local') {
      continue; // No API key = skip (except local providers)
    }

    // Check if provider already exists
    const existing = await pool.query(
      'SELECT id FROM providers WHERE name = $1',
      [template.id]
    );

    if (existing.rows.length > 0) {
      logger.debug({ provider: template.id }, 'Provider already registered');
      continue;
    }

    try {
      // Create provider
      const providerResult = await pool.query(
        `INSERT INTO providers (name, adapter_type, base_url, api_key_ref, config)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          template.id,
          template.id,
          template.baseUrl,
          template.envKey,
          JSON.stringify({
            authMethod: template.authMethod,
            authHeader: template.authHeader,
            apiFormat: template.apiFormat,
            streaming: template.streaming,
            toolCalling: template.toolCalling,
          }),
        ]
      );

      const providerId = providerResult.rows[0].id;

      // Create model profiles
      for (const model of template.models) {
        await pool.query(
          `INSERT INTO model_profiles (
            provider_id, model_id, display_name, modality, intelligence_layer,
            supports_streaming, supports_vision, supports_tool_use, supports_json_mode,
            context_window, max_output_tokens,
            input_cost_per_1k, output_cost_per_1k, cost_per_image,
            quality_score, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            providerId,
            model.id,
            model.id,
            model.modalities[0] || 'llm',
            'executor',
            model.capabilities.includes('streaming'),
            model.capabilities.includes('vision'),
            model.capabilities.includes('tool_use'),
            model.capabilities.includes('json_mode'),
            model.contextWindow,
            model.maxOutputTokens,
            (model.inputCostPer1M || 0) / 1000,  // Convert from per-1M to per-1K
            (model.outputCostPer1M || 0) / 1000,
            model.costPerImage || 0,
            0.5, // Default quality score
            true,
          ]
        );
      }

      registered.push(template.id);
      logger.info(
        { provider: template.id, models: template.models.length },
        'Auto-registered provider'
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
  const pool = getPool();

  // Check if already exists
  const existing = await pool.query(
    'SELECT id FROM providers WHERE name = $1',
    [merged.id]
  );

  if (existing.rows.length > 0) {
    throw new Error(`Provider '${merged.id}' is already registered.`);
  }

  // Create provider
  const result = await pool.query(
    `INSERT INTO providers (name, adapter_type, base_url, api_key_ref, config)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      merged.id,
      merged.id,
      merged.baseUrl,
      merged.envKey,
      JSON.stringify({
        authMethod: merged.authMethod,
        apiFormat: merged.apiFormat,
        streaming: merged.streaming,
        toolCalling: merged.toolCalling,
      }),
    ]
  );

  const providerId_result = result.rows[0].id;

  // Create models
  for (const model of merged.models) {
    await pool.query(
      `INSERT INTO model_profiles (
        provider_id, model_id, display_name, modality, intelligence_layer,
        supports_streaming, supports_vision, supports_tool_use,
        context_window, input_cost_per_1k, output_cost_per_1k, cost_per_image,
        quality_score, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        providerId_result,
        model.id,
        model.id,
        model.modalities[0] || 'llm',
        'executor',
        model.capabilities.includes('streaming'),
        model.capabilities.includes('vision'),
        model.capabilities.includes('tool_use'),
        model.contextWindow,
        (model.inputCostPer1M || 0) / 1000,
        (model.outputCostPer1M || 0) / 1000,
        model.costPerImage || 0,
        0.5,
        true,
      ]
    );
  }

  logger.info({ provider: merged.id, models: merged.models.length }, 'Registered provider');
  return providerId_result;
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
