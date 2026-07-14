import crypto from 'node:crypto';

import type { CapabilityTier, ArchitectureTier } from '@dmr-x/core';
import { getDb } from '@dmr-x/db';
import { logger, eventBus, SystemEvents } from '@dmr-x/utils';

import { discoverOpenAIModels, type DiscoveredModel } from './model-discovery.js';
import { PROVIDER_CATALOG, type ProviderTemplate, type ModelTemplate } from './provider-catalog.js';

/**
 * Build a lookup map of catalog models keyed by `${providerId}/${modelId}`.
 * Used to enrich models discovered from `/v1/models` with known costs,
 * context windows, and capabilities from the static catalog.
 */
function buildCatalogLookup(): Map<string, ModelTemplate> {
  const lookup = new Map<string, ModelTemplate>();
  for (const template of PROVIDER_CATALOG) {
    for (const m of template.models) {
      lookup.set(`${template.id}/${m.id}`, m);
    }
  }
  return lookup;
}

/**
 * Enrich a discovered model with catalog data when available.
 * Fills in cost, context window, capabilities, and specializations
 * that the upstream /v1/models endpoint doesn't provide.
 */
function enrichFromCatalog(
  providerId: string,
  model: DiscoveredModel,
  catalog: Map<string, ModelTemplate>,
): DiscoveredModel {
  const key = `${providerId}/${model.modelId}`;
  const tmpl = catalog.get(key);
  if (!tmpl) return model;

  return {
    ...model,
    displayName: model.displayName || tmpl.id,
    modality: model.modality || tmpl.modalities[0] || 'llm',
    contextWindow: model.contextWindow ?? tmpl.contextWindow ?? null,
    maxOutputTokens: model.maxOutputTokens ?? tmpl.maxOutputTokens ?? null,
    inputCostPer1M: model.inputCostPer1M || tmpl.inputCostPer1M || 0,
    outputCostPer1M: model.outputCostPer1M || tmpl.outputCostPer1M || 0,
    costPerImage: model.costPerImage || tmpl.costPerImage || 0,
    capabilities: model.capabilities.length > 0 ? model.capabilities : tmpl.capabilities,
    specializations: model.specializations.length > 0 ? model.specializations : tmpl.specializations,
    subscriptionOnly: tmpl.subscriptionOnly,
  };
}

/**
 * True when a catalog entry points at a default-localhost URL AND the user
 * has not set the envKey override. Such providers are auto-registered but
 * will fail any /v1/models probe with ECONNREFUSED on every boot, which used
 * to surface as an unhandled rejection in the background init path.
 *
 * Skip /v1/models discovery for these — there's nothing to discover until
 * the user actually runs the local stack (or points the env var elsewhere).
 */
function isLocalProviderUnconfigured(template: ProviderTemplate): boolean {
  if (!template.baseUrl || !template.envKey) return false;
  let host: string;
  try {
    host = new URL(template.baseUrl).hostname;
  } catch {
    return false;
  }
  const isLocalHost =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return isLocalHost && !process.env[template.envKey];
}

// Re-export so callers can use the same short-circuit
export { isLocalProviderUnconfigured };

/**
 * Classify a model's capability tier based on its properties.
 * This determines the model's actual capability level (frontier/strong/balanced/fast/economy).
 * 
 * Uses model ID patterns, pricing, context window, and capabilities to infer tier.
 */
function classifyCapabilityTier(model: DiscoveredModel): CapabilityTier {
  const id = (model.modelId || '').toLowerCase();
  const caps = model.capabilities || [];
  const specs = model.specializations || [];
  const contextWindow = model.contextWindow || 0;
  const inputCost = model.inputCostPer1M || 0;

  // Frontier: Best available models (highest cost, largest context, most capabilities)
  if (
    id.match(/opus|gpt-5\.5|gpt-5\.4($|-)|o3($|-)|gemini.*pro|mythos|fable/) ||
    (inputCost >= 10 && contextWindow >= 128000) ||
    (id.includes('gpt-4') && !id.includes('mini') && !id.includes('nano') && contextWindow >= 100000)
  ) {
    if (!id.match(/mini|nano|flash|haiku|lite/)) return 'frontier';
  }

  // Strong: High capability models (good cost/performance ratio)
  if (
    id.match(/sonnet|gpt-5\.4|gemini.*flash(?!.*lite)|llama.*70b|llama.*405b|deepseek.*v[34]|qwen.*235b|grok/) ||
    (inputCost >= 2 && inputCost < 10 && contextWindow >= 32000) ||
    caps.includes('reasoning')
  ) {
    if (!id.match(/mini|nano|flash.*lite|haiku/)) return 'strong';
  }

  // Balanced: Good all-around models (moderate cost, decent capabilities)
  if (
    id.match(/haiku|flash(?!.*lite)|mistral.*large|qwen.*[72]b|phi-3/) ||
    (inputCost >= 0.5 && inputCost < 2) ||
    specs.some(s => ['general', 'code', 'analysis'].includes(s))
  ) {
    return 'balanced';
  }

  // Fast: Optimized for speed (low cost, fast inference)
  if (
    id.match(/mini|nano|flash.*lite|haiku.*3\.5/) ||
    specs.some(s => ['fast', 'cheap'].includes(s)) ||
    (inputCost < 0.5 && contextWindow < 128000)
  ) {
    return 'fast';
  }

  // Economy: Cheapest/simplest models
  if (
    id.match(/phi-4.*mini|gemma.*4b|smolllm|tiny|1b|3b/) ||
    inputCost < 0.1 ||
    contextWindow < 8000
  ) {
    return 'economy';
  }

  // Default: Balanced (safe fallback)
  return 'balanced';
}

/**
 * Infer model architecture tier from model properties.
 * This is Dimension 2 of the 9-dimension taxonomy.
 */
function inferArchitectureTier(model: DiscoveredModel): ArchitectureTier {
  const id = (model.modelId || '').toLowerCase();
  const caps = model.capabilities || [];

  // MoE: Mixture of Experts models
  if (id.match(/mixtral|moe|grok|deepseek.*v[34]|mistral.*large|qwen.*235b|phi-4.*moe/)) {
    return 'moe';
  }

  // SSM: State-space models
  if (id.match(/mamba|jamba|ssm/)) {
    return 'ssm';
  }

  // Hybrid: Hybrid architectures
  if (id.match(/hybrid|zamba|jamba.*hybrid/)) {
    return 'hybrid';
  }

  // Dense: Standard transformer models (most models)
  if (id.match(/gpt|claude|gemini|llama|phi|qwen|deepseek.*v[12]|mistral(?!.*large)|yi|command|embed|whisper|dall|stable|flux/)) {
    return 'dense';
  }

  // Default: Unknown for models we can't classify
  return 'unknown';
}

/**
 * Infer task categories from model capabilities and specializations.
 */
function inferTaskCategories(model: DiscoveredModel): string[] {
  const categories: string[] = [];
  const id = (model.modelId || '').toLowerCase();
  const caps = model.capabilities || [];
  const specs = model.specializations || [];
  const modality = model.modality || 'llm';

  // General chat (default for LLMs)
  if (modality === 'llm' && !specs.some(s => ['embedding', 'reranking', 'stt', 'tts'].includes(s))) {
    categories.push('general');
  }

  // Reasoning
  if (caps.includes('reasoning') || id.match(/o3|o4|r1|think|reason/)) {
    categories.push('reasoning');
  }

  // Code
  if (id.match(/codestral|coder|code|devstral/) || specs.includes('coding')) {
    categories.push('code');
  }

  // Vision
  if (caps.includes('vision') || id.match(/vision|gpt-4o|gemini/)) {
    categories.push('vision');
  }

  // Image generation
  if (modality === 'diffusion' || specs.includes('image_generation') || id.match(/dall-e|stable|flux|imagen/)) {
    categories.push('image_generation');
  }

  // TTS
  if (modality === 'audio_tts' || specs.includes('tts') || id.match(/tts|whisper|kokoro|orpheus|piper/)) {
    categories.push('tts');
  }

  // STT
  if (modality === 'audio_stt' || specs.includes('stt') || id.match(/whisper|stt|transcri/)) {
    categories.push('stt');
  }

  // Embedding
  if (modality === 'embedding' || specs.includes('embedding') || id.match(/embed/)) {
    categories.push('embedding');
  }

  // Security (for specialized models like Mythos)
  if (id.match(/mythos|fable|security|cyber/) || specs.includes('security')) {
    categories.push('security');
  }

  // Creative
  if (specs.includes('creative') || id.match(/creative|story|write/)) {
    categories.push('creative');
  }

  // Moderation
  if (modality === 'moderation' || specs.includes('moderation') || id.match(/moderat|guard|shield/)) {
    categories.push('moderation');
  }

  return categories.length > 0 ? categories : ['general'];
}

/**
 * Classify context window into a tier.
 */
function classifyContextTier(contextWindow?: number): 'short' | 'medium' | 'long' | 'ultra' | 'massive' {
  if (!contextWindow || contextWindow < 32000) return 'short';
  if (contextWindow < 128000) return 'medium';
  if (contextWindow < 1000000) return 'long';
  if (contextWindow < 10000000) return 'ultra';
  return 'massive';
}

/**
 * Infer deployment model from provider.
 */
function inferDeployment(providerId: string): 'cloud' | 'self_hosted' | 'on_device' {
  // Local/self-hosted providers
  const selfHosted = ['ollama', 'vllm', 'llamacpp', 'localai', 'lmstudio'];
  if (selfHosted.some(p => providerId.toLowerCase().includes(p))) {
    return 'self_hosted';
  }
  return 'cloud';
}

/**
 * Infer reasoning mode from model properties.
 */
function inferReasoningMode(model: DiscoveredModel): 'fixed' | 'adaptive' | 'hybrid' {
  const id = (model.modelId || '').toLowerCase();
  const caps = model.capabilities || [];

  // Adaptive: Models that auto-switch between fast/thinking (GPT-5, etc.)
  if (id.match(/gpt-5|gemini.*2\.5|adaptive/)) {
    return 'adaptive';
  }

  // Hybrid: Models with user-controlled thinking toggle (DeepSeek, Qwen3)
  if (id.match(/deepseek.*v3\.1|qwen3|r1/) || caps.includes('reasoning')) {
    return 'hybrid';
  }

  return 'fixed';
}

/**
 * Infer safety tier from model properties.
 */
function inferSafetyTier(model: DiscoveredModel): 'unrestricted' | 'standard' | 'restricted' {
  const id = (model.modelId || '').toLowerCase();

  // Restricted: Models with deliberate capability limits (Fable 5, Mythos)
  if (id.match(/mythos|fable|restricted/)) {
    return 'restricted';
  }

  // Unrestricted: Open-weight models with minimal guardrails
  if (id.match(/llama|mistral|deepseek|qwen|open/)) {
    return 'unrestricted';
  }

  return 'standard';
}

/**
 * Infer agentic level from model properties.
 */
function inferAgenticLevel(model: DiscoveredModel): 'chat' | 'tool_use' | 'autonomous' {
  const caps = model.capabilities || [];
  const specs = model.specializations || [];
  const id = (model.modelId || '').toLowerCase();

  // Autonomous: Models that can take actions independently
  if (id.match(/gpt-5|gemini.*pro|grok.*4|agentic|autonomous/)) {
    return 'autonomous';
  }

  // Tool use: Models that can call tools/functions
  if (caps.includes('tool_use') || caps.includes('function_call') || specs.includes('tool_use')) {
    return 'tool_use';
  }

  return 'chat';
}

/**
 * Get initial quality score based on capability tier.
 * Higher-tier models start with higher scores to bias selection toward better models.
 */
function getInitialQualityScore(tier: CapabilityTier): number {
  const scores: Record<CapabilityTier, number> = {
    frontier: 0.9,
    strong: 0.75,
    balanced: 0.6,
    fast: 0.5,
    economy: 0.4,
  };
  return scores[tier] ?? 0.5;
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
      id, provider_id, model_id, display_name, modality, capability_tier,
      supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
      context_window, max_output_tokens,
      input_cost_per_1k, output_cost_per_1k, cost_per_image,
      quality_score, is_active, subscription_only,
      task_categories, context_tier, deployment, reasoning_mode, safety_tier, agentic_level,
      architecture, parameter_count, active_parameters, license
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let count = 0;
  for (const m of models) {
    if (!m.modelId) continue;
    const caps = new Set(m.capabilities);
    const capabilityTier = classifyCapabilityTier(m);
    const architectureTier = inferArchitectureTier(m);
    const taskCategories = inferTaskCategories(m);
    const contextTier = classifyContextTier(m.contextWindow ?? undefined);
    const deployment = inferDeployment(providerId);
    const reasoningMode = inferReasoningMode(m);
    const safetyTier = inferSafetyTier(m);
    const agenticLevel = inferAgenticLevel(m);
    const id = crypto.randomUUID();
    const result = insert.run(
      id,
      providerId,
      m.modelId,
      m.displayName || m.modelId,
      m.modality || 'llm',
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
      getInitialQualityScore(capabilityTier),
      isActive ? 1 : 0,
      m.subscriptionOnly ? 1 : 0,
      JSON.stringify(taskCategories),
      contextTier,
      deployment,
      reasoningMode,
      safetyTier,
      agenticLevel,
      architectureTier,
      null, // parameter_count (to be filled from catalog)
      null, // active_parameters (to be filled from catalog)
      null, // license (to be filled from catalog)
    );
    if (result.changes > 0) {
      count += 1;
      eventBus.emit(SystemEvents.MODEL_REGISTERED, {
        id,
        providerId,
        modelId: m.modelId,
        modality: m.modality || 'llm',
        capabilityTier,
        taskCategories,
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
 * Discovered models are enriched with catalog data (costs, context windows,
 * capabilities) when available.
 */
export async function autoRegisterProviders(): Promise<string[]> {
  const registered: string[] = [];
  const db = getDb();
  const catalogLookup = buildCatalogLookup();

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
        // Live discovery for catalog entries that don't pre-declare models.
        // Skip unconfigured local providers (ollama/vllm/llamacpp/localai with
        // no env var set) — they'd just ECONNREFUSED against a closed port and
        // used to leak an unhandled rejection from the background init path.
        if (isLocalProviderUnconfigured(template)) {
          logger.info(
            { provider: template.id },
            'Skipping /v1/models discovery: local provider has no env override',
          );
        } else {
          try {
            const discovered = await discoverOpenAIModels({
              baseUrl: template.baseUrl,
              apiKey: apiKey || '',
            });
            if (discovered.length > 0) {
              // Enrich discovered models with catalog data (costs, context, capabilities)
              modelsForInsert = discovered.map(m => enrichFromCatalog(template.id, m, catalogLookup));
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
      }

      // Create model profiles (rich variant with rate-limit / rank fields)
      const insert = db.prepare(
        `INSERT INTO model_profiles (
          id, provider_id, model_id, display_name, modality, capability_tier,
          supports_streaming, supports_vision, supports_tool_use, supports_json_mode, supports_function_call, supports_reasoning,
          context_window, max_output_tokens,
          input_cost_per_1k, output_cost_per_1k, cost_per_image,
          quality_score, is_active,
          rate_limit_rpm, rate_limit_rpd, rate_limit_tpm, rate_limit_tpd,
          monthly_token_budget, intelligence_rank, speed_rank,
          task_categories, context_tier, deployment, reasoning_mode, safety_tier, agentic_level,
          architecture
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of modelsForInsert) {
        if (!m.modelId) continue;
        const caps = new Set(m.capabilities);
        // Convert to DiscoveredModel-like object for classification
        const discoveredModel = {
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
        };
        const capabilityTier = classifyCapabilityTier(discoveredModel);
        const architectureTier = inferArchitectureTier(discoveredModel);
        const taskCategories = inferTaskCategories(discoveredModel);
        const contextTier = classifyContextTier(m.contextWindow ?? undefined);
        const deployment = inferDeployment(template.id);
        const reasoningMode = inferReasoningMode(discoveredModel);
        const safetyTier = inferSafetyTier(discoveredModel);
        const agenticLevel = inferAgenticLevel(discoveredModel);
        insert.run(
          crypto.randomUUID(),
          providerId,
          m.modelId,
          m.displayName || m.modelId,
          m.modality || 'llm',
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
          getInitialQualityScore(capabilityTier),
          isActive ? 1 : 0,
          m.rateLimits?.rpm ?? null,
          m.rateLimits?.rpd ?? null,
          m.rateLimits?.tpm ?? null,
          m.rateLimits?.tpd ?? null,
          m.monthlyTokenBudget ?? null,
          m.intelligenceRank ?? null,
          m.speedRank ?? null,
          JSON.stringify(taskCategories),
          contextTier,
          deployment,
          reasoningMode,
          safetyTier,
          agenticLevel,
          architectureTier,
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
 * Discovered models are enriched with catalog data (costs, context windows,
 * capabilities) when available.
 * Returns the total number of new model rows inserted.
 */
export async function discoverMissingModels(): Promise<number> {
  const db = getDb();
  const catalogLookup = buildCatalogLookup();

  // Phase 1: collect eligible providers via sync DB lookups (cheap, no I/O)
  const eligible: Array<{ providerId: string; templateId: string; baseUrl: string }> = [];
  for (const template of PROVIDER_CATALOG) {
    if (template.apiFormat !== 'openai' || !template.baseUrl) continue;
    // Skip unconfigured local providers — their /v1/models is guaranteed to
    // ECONNREFUSED on every boot until the user actually runs the local stack.
    if (isLocalProviderUnconfigured(template)) continue;

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
    const { providerId, templateId } = eligible[i];
    // Enrich discovered models with catalog data (costs, context, capabilities)
    const enriched = result.discovered.map(m => enrichFromCatalog(templateId, m, catalogLookup));
    const inserted = insertModelProfiles(providerId, enriched, true);
    totalInserted += inserted;
    logger.info(
      { provider: templateId, inserted },
      'Backfilled model profiles via discovery',
    );
  }

  return totalInserted;
}

/**
 * Enrich existing model_profiles rows with catalog data (costs, context
 * windows, capabilities) where the current values are zero/null.
 * Runs once at startup so models discovered before catalog enrichment
 * was added get backfilled.
 *
 * Returns the number of rows updated.
 */
export async function enrichExistingModels(): Promise<number> {
  const db = getDb();
  const catalogLookup = buildCatalogLookup();

  // Find models that have zero costs and no context window — likely
  // discovered from /v1/models without catalog enrichment.
  const stale = db.prepare(
    `SELECT mp.id, mp.provider_id, mp.model_id, p.name as provider_name
     FROM model_profiles mp
     JOIN providers p ON p.id = mp.provider_id
     WHERE mp.is_active = 1
       AND (mp.context_window IS NULL OR mp.context_window = 0)
       AND mp.input_cost_per_1k = 0
       AND mp.output_cost_per_1k = 0`
  ).all() as Array<{ id: string; provider_id: string; model_id: string; provider_name: string }>;

  if (stale.length === 0) return 0;

  let updated = 0;
  const update = db.prepare(
    `UPDATE model_profiles SET
       display_name = COALESCE(NULLIF(?, ''), display_name),
       modality = COALESCE(NULLIF(?, ''), modality),
       context_window = COALESCE(?, context_window),
       max_output_tokens = COALESCE(?, max_output_tokens),
       input_cost_per_1k = CASE WHEN ? > 0 THEN ? ELSE input_cost_per_1k END,
       output_cost_per_1k = CASE WHEN ? > 0 THEN ? ELSE output_cost_per_1k END,
       cost_per_image = CASE WHEN ? > 0 THEN ? ELSE cost_per_image END,
       supports_streaming = CASE WHEN ? THEN 1 ELSE supports_streaming END,
       supports_vision = CASE WHEN ? THEN 1 ELSE supports_vision END,
       supports_tool_use = CASE WHEN ? THEN 1 ELSE supports_tool_use END,
       supports_json_mode = CASE WHEN ? THEN 1 ELSE supports_json_mode END,
       supports_function_call = CASE WHEN ? THEN 1 ELSE supports_function_call END,
       supports_reasoning = CASE WHEN ? THEN 1 ELSE supports_reasoning END,
       subscription_only = CASE WHEN ? THEN 1 ELSE subscription_only END,
       updated_at = datetime('now')
     WHERE id = ?`
  );

  for (const row of stale) {
    const key = `${row.provider_name}/${row.model_id}`;
    const tmpl = catalogLookup.get(key);
    if (!tmpl) continue;

    const caps = new Set(tmpl.capabilities);
    const result = update.run(
      tmpl.id,                                          // display_name
      tmpl.modalities[0] || '',                         // modality
      tmpl.contextWindow ?? null,                       // context_window
      tmpl.maxOutputTokens ?? null,                     // max_output_tokens
      tmpl.inputCostPer1M ?? 0, tmpl.inputCostPer1M ?? 0,   // input_cost_per_1k
      tmpl.outputCostPer1M ?? 0, tmpl.outputCostPer1M ?? 0, // output_cost_per_1k
      tmpl.costPerImage ?? 0, tmpl.costPerImage ?? 0,       // cost_per_image
      caps.has('streaming') ? 1 : 0,
      caps.has('vision') ? 1 : 0,
      caps.has('tool_use') ? 1 : 0,
      caps.has('json_mode') ? 1 : 0,
      caps.has('function_call') ? 1 : 0,
      caps.has('reasoning') ? 1 : 0,
      tmpl.subscriptionOnly ? 1 : 0,
      row.id,
    );
    if (result.changes > 0) updated++;
  }

  if (updated > 0) {
    logger.info({ count: updated, total: stale.length }, 'Enriched existing models with catalog data');
  }
  return updated;
}

