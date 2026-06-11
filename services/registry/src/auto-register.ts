import { getDb } from '@dmr-x/db';
import { logger, eventBus, SystemEvents } from '@dmr-x/utils';
import { PROVIDER_CATALOG } from './provider-catalog.js';
import { discoverOpenAIModels, type DiscoveredModel } from './model-discovery.js';
import crypto from 'node:crypto';
import type { CapabilityTier } from '@dmr-x/core';

/**
 * Classify a model's capability tier based on its properties.
 * This determines the model's actual capability level (brain/thinker/executor/specialist/worker).
 */
function classifyCapabilityTier(model: DiscoveredModel): CapabilityTier {
  const id = (model.modelId || '').toLowerCase();
  const caps = model.capabilities || [];
  const specs = model.specializations || [];

  // Orchestrator: Multi-model coordination
  if (specs.includes('orchestration')) return 'orchestrator';

  // Brain: Top-tier models (best reasoning, largest, most capable)
  if (
    id.match(/opus|gpt-5\.5|gpt-5\.4($|-)|o3($|-)|deepseek-r1/) ||
    (id.includes('gpt-4') && !id.includes('mini') && !id.includes('nano'))
  ) {
    // Exclude mini/nano variants from brain
    if (!id.match(/mini|nano|flash|haiku/)) return 'brain';
  }

  // Thinker: Reasoning/thinking models
  if (
    id.match(/o3-mini|o4-mini|deepseek-r1/) ||
    (caps.includes('reasoning') && !id.match(/mini|nano|flash/))
  ) {
    return 'thinker';
  }

  // Specialist: Domain-specific narrow AI
  if (
    id.match(/codestral|v0|mimo|sonar|embed|rerank|whisper|piper|kokoro|orpheus|ultralytics|yolo/) ||
    specs.some(s => ['database_schema', 'database_query', 'ui_component', 'embedding', 'reranking', 'stt', 'tts', 'music_generation', 'vision', '3d'].includes(s))
  ) {
    return 'specialist';
  }

  // Worker: Fast/cheap models
  if (
    specs.some(s => ['fast', 'cheap'].includes(s)) ||
    id.match(/mini|flash|haiku|nano/)
  ) {
    return 'worker';
  }

  // Default: Executor (general-purpose)
  return 'executor';
}

/**
 * Insert a batch of model profiles for a provider.
 * Centralized so both auto-register and the backfill can share it.
 */
function insertModelProfiles(
  providerId: string,
  models: DiscoveredModel[],
  isActive: boolean,
): number {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO model_profiles (
      id, provider_id, model_id, display_name, modality, intelligence_layer, capability_tier,
      supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
      context_window, max_output_tokens,
      input_cost_per_1k, output_cost_per_1k, cost_per_image,
      quality_score, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let count = 0;
  for (const m of models) {
    if (!m.modelId) continue;
    const caps = new Set(m.capabilities);
    const capabilityTier = classifyCapabilityTier(m);
    const id = crypto.randomUUID();
    const result = insert.run(
      id,
      providerId,
      m.modelId,
      m.displayName || m.modelId,
      m.modality || 'llm',
      'executor', // intelligence_layer (source: cloud by default)
      capabilityTier,
      caps.has('streaming') ? 1 : 0,
      caps.has('vision') ? 1 : 0,
      caps.has('tool_use') ? 1 : 0,
      caps.has('json_mode') ? 1 : 0,
      caps.has('function_call') ? 1 : 0,
      caps.has('reasoning') ? 1 : 0,
      m.contextWindow,
      m.maxOutputTokens,
      m.inputCostPer1M / 1000,
      m.outputCostPer1M / 1000,
      m.costPerImage,
      0.5,
      isActive ? 1 : 0,
    );
    if (result.changes > 0) {
      count += 1;
      eventBus.emit(SystemEvents.MODEL_REGISTERED, {
        id,
        providerId,
        modelId: m.modelId,
        modality: m.modality || 'llm',
        capabilityTier,
      });
    }
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

      // Resolve model list: static catalog OR live /v1/models discovery
      let modelsForInsert: Array<{
        modelId: string;
        displayName: string;
        modality: string;
        contextWindow: number | null;
        maxOutputTokens: number | null;
        inputCostPer1M: number;
        outputCostPer1M: number;
        costPerImage: number;
        capabilities: string[];
        specializations: string[];
        rateLimits?: { rpm?: number; rpd?: number; tpm?: number; tpd?: number };
        monthlyTokenBudget?: number;
        intelligenceRank?: number;
        speedRank?: number;
      }> = [];

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
      } else if (template.apiFormat === 'openai' && template.baseUrl) {
        // Live discovery for catalog entries that don't pre-declare models
        try {
          const discovered = await discoverOpenAIModels({
            baseUrl: template.baseUrl,
            apiKey: apiKey || '',
          });
          if (discovered.length > 0) {
            modelsForInsert = discovered;
            logger.info(
              { provider: template.id, count: discovered.length },
              'Discovered models from provider /v1/models',
            );
          }
        } catch (err) {
          logger.warn(
            { err, provider: template.id },
            'Model discovery failed during first register; provider will have no models',
          );
        }
      }

      // Create model profiles (rich variant with rate-limit / rank fields)
      const insert = db.prepare(
        `INSERT INTO model_profiles (
          id, provider_id, model_id, display_name, modality, intelligence_layer, capability_tier,
          supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
          context_window, max_output_tokens,
          input_cost_per_1k, output_cost_per_1k, cost_per_image,
          quality_score, is_active,
          rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
          monthly_token_budget, intelligence_rank, speed_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of modelsForInsert) {
        if (!m.modelId) continue;
        const caps = new Set(m.capabilities);
        // Convert to DiscoveredModel-like object for classification
        const capabilityTier = classifyCapabilityTier({
          modelId: m.modelId,
          displayName: m.displayName,
          modality: m.modality,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          inputCostPer1M: m.inputCostPer1M,
          outputCostPer1M: m.outputCostPer1M,
          costPerImage: m.costPerImage,
          capabilities: m.capabilities,
          specializations: m.specializations,
        });
        insert.run(
          crypto.randomUUID(),
          providerId,
          m.modelId,
          m.displayName || m.modelId,
          m.modality || 'llm',
          'executor', // intelligence_layer (source: cloud by default)
          capabilityTier,
          caps.has('streaming') ? 1 : 0,
          caps.has('vision') ? 1 : 0,
          caps.has('tool_use') ? 1 : 0,
          caps.has('json_mode') ? 1 : 0,
          caps.has('function_call') ? 1 : 0,
          caps.has('reasoning') ? 1 : 0,
          m.contextWindow,
          m.maxOutputTokens,
          m.inputCostPer1M / 1000,
          m.outputCostPer1M / 1000,
          m.costPerImage,
          0.5,
          isActive ? 1 : 0,
          m.rateLimits?.rpm ?? null,
          m.rateLimits?.rpd ?? null,
          m.rateLimits?.tpm ?? null,
          m.rateLimits?.tpd ?? null,
          m.monthlyTokenBudget ?? null,
          m.intelligenceRank ?? null,
          m.speedRank ?? null,
        );
      }

      registered.push(template.id);
      logger.info(
        { provider: template.id, models: modelsForInsert.length, hasKey },
        hasKey ? 'Auto-registered provider (key found)' : 'Registered provider (no key — add one to activate)'
      );
    } catch (error) {
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
export async function discoverMissingModels(): Promise<number> {
  const db = getDb();

  // Phase 1: collect eligible providers via sync DB lookups (cheap, no I/O)
  const eligible: Array<{ providerId: string; templateId: string; baseUrl: string }> = [];
  for (const template of PROVIDER_CATALOG) {
    if (template.apiFormat !== 'openai' || !template.baseUrl) continue;

    const row = db
      .prepare('SELECT id FROM providers WHERE name = ?')
      .get(template.id) as { id: string } | undefined;
    if (!row) continue;

    const hasAny = db
      .prepare('SELECT 1 FROM model_profiles WHERE provider_id = ? LIMIT 1')
      .get(row.id);
    if (hasAny) continue;

    eligible.push({ providerId: row.id, templateId: template.id, baseUrl: template.baseUrl });
  }

  // Phase 2: discover models in parallel. Each fetch is capped by its own
  // 1s AbortController timeout inside discoverOpenAIModels, so the total wait
  // is bounded by ~1s regardless of how many providers are in the catalog.
  const discoveries = await Promise.all(
    eligible.map(async ({ templateId, baseUrl }) => {
      try {
        const discovered = await discoverOpenAIModels({ baseUrl, apiKey: '' });
        if (discovered.length === 0) {
          logger.warn(
            { provider: templateId },
            'discoverMissingModels: /v1/models returned empty; provider will stay without models',
          );
          return null;
        }
        return { templateId, discovered };
      } catch (err) {
        logger.warn(
          { err, provider: templateId },
          'discoverMissingModels: discovery failed',
        );
        return null;
      }
    }),
  );

  // Phase 3: insert serially. Writes to SQLite must be serialised — sql.js
  // is single-threaded and concurrent inserts from the parallel discoveries
  // can corrupt the prepared-statement cache.
  let totalInserted = 0;
  for (let i = 0; i < discoveries.length; i++) {
    const result = discoveries[i];
    if (!result) continue;
    const { providerId } = eligible[i];
    const inserted = insertModelProfiles(providerId, result.discovered, true);
    totalInserted += inserted;
    logger.info(
      { provider: result.templateId, inserted },
      'Backfilled model profiles via discovery',
    );
  }

  return totalInserted;
}

