import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { PROVIDER_CATALOG } from './provider-catalog.js';
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
      // If provider exists but now has a key, activate it and its models
      if (hasKey && template.envKey) {
        const currentConfig = db.prepare('SELECT config FROM providers WHERE id = ?').get(existing.id) as { config: string } | undefined;
        const cfg = JSON.parse(currentConfig?.config || '{}');
        if (!cfg.hasKey) {
          // Key was just added — activate provider and its models
          cfg.hasKey = true;
          db.prepare(
            `UPDATE providers SET is_healthy = 1, config = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(JSON.stringify(cfg), existing.id);
          db.prepare(
            `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now') WHERE provider_id = ?`
          ).run(existing.id);
          logger.info({ provider: template.id }, 'Activated provider — API key now available');
        }
      }
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
            id, provider_id, model_id, display_name, modality, intelligence_layer,
            supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
            context_window, max_output_tokens,
            input_cost_per_1k, output_cost_per_1k, cost_per_image,
            quality_score, is_active,
            rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
            monthly_token_budget, intelligence_rank, speed_rank
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          providerId,
          model.id,
          model.id,
          model.modalities[0] || 'llm',
          'executor',
          model.capabilities.includes('streaming') ? 1 : 0,
          model.capabilities.includes('vision') ? 1 : 0,
          model.capabilities.includes('tool_use') ? 1 : 0,
          model.capabilities.includes('json_mode') ? 1 : 0,
          model.capabilities.includes('function_call') ? 1 : 0,
          model.capabilities.includes('reasoning') ? 1 : 0,
          model.contextWindow ?? null,
          model.maxOutputTokens ?? null,
          (model.inputCostPer1M ?? 0) / 1000,
          (model.outputCostPer1M ?? 0) / 1000,
          model.costPerImage ?? 0,
          0.5,
          isActive ? 1 : 0,
          model.freeTier?.rateLimits.rpm ?? null,
          model.freeTier?.rateLimits.rpd ?? null,
          model.freeTier?.rateLimits.tpm ?? null,
          model.freeTier?.rateLimits.tpd ?? null,
          model.freeTier?.monthlyTokenBudget ?? null,
          model.freeTier?.intelligenceRank ?? null,
          model.freeTier?.speedRank ?? null,
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

