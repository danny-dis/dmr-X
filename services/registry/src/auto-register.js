import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import { PROVIDER_CATALOG } from './provider-catalog.js';
import { discoverOpenAIModels } from './model-discovery.js';
import crypto from 'node:crypto';
/**
 * Insert a batch of model profiles for a provider.
 * Centralized so both auto-register and the backfill can share it.
 */
function insertModelProfiles(providerId, models, isActive) {
    const db = getDb();
    const insert = db.prepare(`INSERT OR IGNORE INTO model_profiles (
      id, provider_id, model_id, display_name, modality, intelligence_layer,
      supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
      context_window, max_output_tokens,
      input_cost_per_1k, output_cost_per_1k, cost_per_image,
      quality_score, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let count = 0;
    for (const m of models) {
        if (!m.modelId)
            continue;
        const caps = new Set(m.capabilities);
        const result = insert.run(crypto.randomUUID(), providerId, m.modelId, m.displayName || m.modelId, m.modality || 'llm', 'executor', caps.has('streaming') ? 1 : 0, caps.has('vision') ? 1 : 0, caps.has('tool_use') ? 1 : 0, caps.has('json_mode') ? 1 : 0, caps.has('function_call') ? 1 : 0, caps.has('reasoning') ? 1 : 0, m.contextWindow, m.maxOutputTokens, m.inputCostPer1M / 1000, m.outputCostPer1M / 1000, m.costPerImage, 0.5, isActive ? 1 : 0);
        if (result.changes > 0)
            count += 1;
    }
    return count;
}
/**
 * Auto-register providers from environment variables
 *
 * Scans env for known API keys and auto-creates provider + model entries.
 * For catalog entries with empty `models` arrays (e.g. Pollinations), the
 * model list is fetched live from the provider's `/v1/models` endpoint.
 */
export async function autoRegisterProviders() {
    const registered = [];
    const db = getDb();
    for (const template of PROVIDER_CATALOG) {
        const apiKey = template.envKey ? process.env[template.envKey] : undefined;
        const hasKey = !!apiKey;
        // Check if provider already exists
        const existing = db.prepare('SELECT id FROM providers WHERE name = ?').get(template.id);
        if (existing) {
            // If provider exists but now has a key, activate it and its models
            if (hasKey && template.envKey) {
                const currentConfig = db.prepare('SELECT config FROM providers WHERE id = ?').get(existing.id);
                const cfg = JSON.parse(currentConfig?.config || '{}');
                if (!cfg.hasKey) {
                    // Key was just added — activate provider and its models
                    cfg.hasKey = true;
                    db.prepare(`UPDATE providers SET is_healthy = 1, config = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(cfg), existing.id);
                    db.prepare(`UPDATE model_profiles SET is_active = 1, updated_at = datetime('now') WHERE provider_id = ?`).run(existing.id);
                    logger.info({ provider: template.id }, 'Activated provider — API key now available');
                }
            }
            continue;
        }
        try {
            // Create provider
            const providerId = crypto.randomUUID();
            const isActive = hasKey || template.envKey === '';
            db.prepare(`INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, is_healthy, config)
         VALUES (?, ?, ?, ?, ?, ?, ?)`).run(providerId, template.id, template.id, template.baseUrl, template.envKey || '', isActive ? 1 : 0, JSON.stringify({
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
            }));
            // Resolve model list: static catalog OR live /v1/models discovery
            let modelsForInsert = [];
            if (template.models.length > 0) {
                for (const m of template.models) {
                    modelsForInsert.push({
                        modelId: m.id,
                        displayName: m.id,
                        modality: m.modalities[0] || 'llm',
                        contextWindow: m.contextWindow ?? null,
                        maxOutputTokens: m.maxOutputTokens ?? null,
                        inputCostPer1M: m.inputCostPer1M ?? 0,
                        outputCostPer1M: m.outputCostPer1M ?? 0,
                        costPerImage: m.costPerImage ?? 0,
                        capabilities: m.capabilities,
                        specializations: m.specializations,
                        rateLimits: m.freeTier?.rateLimits,
                        monthlyTokenBudget: m.freeTier?.monthlyTokenBudget,
                        intelligenceRank: m.freeTier?.intelligenceRank,
                        speedRank: m.freeTier?.speedRank,
                    });
                }
            }
            else if (template.apiFormat === 'openai' && template.baseUrl) {
                // Live discovery for catalog entries that don't pre-declare models
                try {
                    const discovered = await discoverOpenAIModels({
                        baseUrl: template.baseUrl,
                        apiKey: apiKey || '',
                    });
                    if (discovered.length > 0) {
                        modelsForInsert = discovered;
                        logger.info({ provider: template.id, count: discovered.length }, 'Discovered models from provider /v1/models');
                    }
                }
                catch (err) {
                    logger.warn({ err, provider: template.id }, 'Model discovery failed during first register; provider will have no models');
                }
            }
            // Create model profiles (rich variant with rate-limit / rank fields)
            const insert = db.prepare(`INSERT INTO model_profiles (
          id, provider_id, model_id, display_name, modality, intelligence_layer,
          supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
          context_window, max_output_tokens,
          input_cost_per_1k, output_cost_per_1k, cost_per_image,
          quality_score, is_active,
          rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
          monthly_token_budget, intelligence_rank, speed_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const m of modelsForInsert) {
                if (!m.modelId)
                    continue;
                const caps = new Set(m.capabilities);
                insert.run(crypto.randomUUID(), providerId, m.modelId, m.displayName || m.modelId, m.modality || 'llm', 'executor', caps.has('streaming') ? 1 : 0, caps.has('vision') ? 1 : 0, caps.has('tool_use') ? 1 : 0, caps.has('json_mode') ? 1 : 0, caps.has('function_call') ? 1 : 0, caps.has('reasoning') ? 1 : 0, m.contextWindow, m.maxOutputTokens, m.inputCostPer1M / 1000, m.outputCostPer1M / 1000, m.costPerImage, 0.5, isActive ? 1 : 0, m.rateLimits?.rpm ?? null, m.rateLimits?.rpd ?? null, m.rateLimits?.tpm ?? null, m.rateLimits?.tpd ?? null, m.monthlyTokenBudget ?? null, m.intelligenceRank ?? null, m.speedRank ?? null);
            }
            registered.push(template.id);
            logger.info({ provider: template.id, models: modelsForInsert.length, hasKey }, hasKey ? 'Auto-registered provider (key found)' : 'Registered provider (no key — add one to activate)');
        }
        catch (error) {
            logger.error({ err: error, provider: template.id }, 'Failed to auto-register provider');
        }
    }
    return registered;
}
/**
 * Backfill model profiles for providers whose catalog entry was empty
 * (`template.models: []`) but whose DB row exists with no model_profiles
 * yet — e.g. databases created before the live-discovery logic existed.
 *
 * Idempotent: if a provider already has any model_profiles, it is skipped.
 * Returns the total number of new model rows inserted.
 */
export async function discoverMissingModels() {
    const db = getDb();
    let totalInserted = 0;
    for (const template of PROVIDER_CATALOG) {
        if (template.apiFormat !== 'openai' || !template.baseUrl)
            continue;
        const row = db
            .prepare('SELECT id FROM providers WHERE name = ?')
            .get(template.id);
        if (!row)
            continue;
        const hasAny = db
            .prepare('SELECT 1 FROM model_profiles WHERE provider_id = ? LIMIT 1')
            .get(row.id);
        if (hasAny)
            continue;
        try {
            const discovered = await discoverOpenAIModels({
                baseUrl: template.baseUrl,
                apiKey: '',
            });
            if (discovered.length === 0) {
                logger.warn({ provider: template.id }, 'discoverMissingModels: /v1/models returned empty; provider will stay without models');
                continue;
            }
            const isActive = 1; // backfill targets already-active providers
            const inserted = insertModelProfiles(row.id, discovered, Boolean(isActive));
            totalInserted += inserted;
            logger.info({ provider: template.id, inserted }, 'Backfilled model profiles via discovery');
        }
        catch (err) {
            logger.warn({ err, provider: template.id }, 'discoverMissingModels: discovery failed');
        }
    }
    return totalInserted;
}
//# sourceMappingURL=auto-register.js.map