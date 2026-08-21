import crypto from 'node:crypto';

import type { CapabilityTier, ArchitectureTier } from '@dmr-x/core';
import { getDb } from '@dmr-x/db';
import { logger, eventBus, SystemEvents } from '@dmr-x/utils';

import { discoverOpenAIModels, type DiscoveredModel, OPENROUTER_VIRTUAL_MODEL_IDS } from './model-discovery.js';
import { PROVIDER_CATALOG, type ProviderTemplate, type ModelTemplate, getBenchmarkIntelligenceRank } from './provider-catalog.js';

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
    // Union costs: prefer the discovered value when it is a positive number,
    // otherwise fall back to the catalog. Clamp negatives (OpenRouter's "-1"
    // sentinel) so a bad upstream price can never reach model_profiles.
    inputCostPer1M:
      Number.isFinite(model.inputCostPer1M) && model.inputCostPer1M > 0
        ? model.inputCostPer1M
        : Math.max(0, tmpl.inputCostPer1M ?? 0),
    outputCostPer1M:
      Number.isFinite(model.outputCostPer1M) && model.outputCostPer1M > 0
        ? model.outputCostPer1M
        : Math.max(0, tmpl.outputCostPer1M ?? 0),
    costPerImage: Math.max(0, model.costPerImage || tmpl.costPerImage || 0),
    // Union capabilities. Discovery always returns at least ['streaming'] —
    // the old `length > 0` check meant the catalog's richer capability set
    // (tool_use, json_mode, reasoning, ...) was silently discarded for every
    // discovered model, starving them in the capability-filtered rankers
    // (auto-agentic / auto-coding / free-agentic).
    capabilities: Array.from(new Set([...model.capabilities, ...tmpl.capabilities])),
    specializations: Array.from(new Set([...model.specializations, ...tmpl.specializations])),
    subscriptionOnly: tmpl.subscriptionOnly,
    // Carry free-tier metadata from the catalog into the profile. The
    // discovery path used to drop it entirely, so free-tier models had no
    // intelligenceRank/speedRank → no freeTierMetadata → quality stayed at
    // the bare tier baseline.
    rateLimits: model.rateLimits ?? tmpl.freeTier?.rateLimits,
    monthlyTokenBudget: model.monthlyTokenBudget ?? tmpl.freeTier?.monthlyTokenBudget,
    // Benchmark-first intelligence rank: the hand-set catalog rank is inflated
    // for several free gateways (nemotron-3-ultra-550b-a55b:free is catalog
    // rank 9 but scores 38.3 on Artificial Analysis ≈ rank 6). When OpenRouter
    // publishes a benchmark for this model id, that measured rank wins; only
    // models with no benchmark fall through to the catalog guess.
    intelligenceRank: getBenchmarkIntelligenceRank(model.modelId) ?? model.intelligenceRank ?? tmpl.freeTier?.intelligenceRank,
    speedRank: model.speedRank ?? tmpl.freeTier?.speedRank,
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
      m.inputCostPer1M != null ? m.inputCostPer1M / 1000 : null,
      m.outputCostPer1M != null ? m.outputCostPer1M / 1000 : null,
      m.costPerImage ?? null,
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
      // Backfill api_key_ref for providers seeded before that column existed
      // (or seeded while the env var was unset). Without it, server.ts cannot
      // resolve the runtime env key, so the periodic probe sends an
      // unauthenticated request, upstream returns 401, and the provider gets
      // poisoned to is_healthy=0 — starving the candidate pool. (DMR-X §14)
      const exRow = db
        .prepare('SELECT api_key_ref, is_healthy FROM providers WHERE id = ?')
        .get(existing.id) as { api_key_ref: string | null; is_healthy: number } | undefined;
      const needsRefBackfill = !!template.envKey && !exRow?.api_key_ref;
      const needsHealthReset = hasKey && Number(exRow?.is_healthy) === 0 && !needsRefBackfill;

      // Tier backfill for rows seeded before this INSERT set `tier` explicitly
      // (see the fresh-insert branch below for why the schema default alone
      // is wrong). Only touch rows with zero rows in `provider_keys` — once an
      // operator has added a real key, `recomputeProviderTier` (admin.routes.ts)
      // owns this column and must not be second-guessed here.
      const activeKeyCount = (
        db.prepare('SELECT COUNT(*) as c FROM provider_keys WHERE provider_id = ? AND is_active = 1')
          .get(existing.id) as { c: number } | undefined
      )?.c ?? 0;
      if (activeKeyCount === 0) {
        const desiredTier: 'free' | 'paid' | 'inactive' =
          template.envKey === '' ? 'free' : hasKey ? 'paid' : 'inactive';
        const currentTierRow = db.prepare('SELECT tier FROM providers WHERE id = ?').get(existing.id) as
          | { tier: string }
          | undefined;
        if (currentTierRow && currentTierRow.tier !== desiredTier) {
          db.prepare(`UPDATE providers SET tier = ? WHERE id = ?`).run(desiredTier, existing.id);
        }
      }

      const currentConfig = db.prepare('SELECT config FROM providers WHERE id = ?').get(existing.id) as { config: string } | undefined;
      const cfg = JSON.parse(currentConfig?.config || '{}');
      const keyJustAdded = hasKey && template.envKey && !cfg.hasKey;
      if (needsRefBackfill || needsHealthReset || keyJustAdded) {
        if (needsRefBackfill) {
          db.prepare(`UPDATE providers SET api_key_ref = ? WHERE id = ?`).run(template.envKey, existing.id);
        }
        if (hasKey) {
          cfg.hasKey = true;
          db.prepare(
            `UPDATE providers SET is_healthy = 1, config = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(JSON.stringify(cfg), existing.id);
          db.prepare(
            `UPDATE model_profiles SET is_active = 1, updated_at = datetime('now')
             WHERE provider_id = ? AND operator_disabled = 0`
          ).run(existing.id);
          logger.info({ provider: template.id }, 'Re-activated provider — api_key_ref/env key now available');
        }
      }
      continue;
    }

    try {
      // Create provider
      const providerId = crypto.randomUUID();
      const isActive = hasKey || template.envKey === '';

      // `providers.tier` defaults to 'paid' at the schema level (migration
      // 015), which is right for a provider that genuinely needs — and has —
      // a paid API key, but wrong for everything else this INSERT covers:
      // it left every keyless/local template (ollama, vllm, llamacpp, …,
      // `envKey === ''`) and every catalog entry seeded without a resolved
      // key mis-tagged as 'paid' forever, since nothing ever revisits this
      // row afterwards (`recomputeProviderTier` below only fires from the
      // key-mutation admin routes, which auto-registered rows never hit).
      // That is what made every provider in the catalog show up under
      // "Paid Providers" on the Dashboard with Free/Mixed stuck at 0.
      //   - keyless template (no key ever required)      -> 'free'
      //   - key required but none resolved from env       -> 'inactive'
      //   - key required and present                      -> 'paid'
      const tier: 'free' | 'paid' | 'inactive' =
        template.envKey === '' ? 'free' : hasKey ? 'paid' : 'inactive';

      db.prepare(
        `INSERT INTO providers (id, name, adapter_type, base_url, api_key_ref, is_healthy, config, tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
        }),
        tier,
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

      // Live discovery is the source of truth for WHICH models exist and what
      // their context windows are — a hand-maintained catalog goes stale and
      // silently lists models the provider has removed (the Gemini entries
      // listed several ids that 404 upstream). The catalog is kept only to
      // enrich what the API does not publish (costs, ranks, free-tier limits).
      const canDiscover = template.apiFormat === 'openai' && !!template.baseUrl;
      let discoveredLive = false;
      if (canDiscover && !isLocalProviderUnconfigured(template)) {
        try {
          const discovered = await discoverOpenAIModels({
            baseUrl: template.baseUrl!,
            apiKey: apiKey || '',
          });
          if (discovered.length > 0) {
            modelsForInsert = discovered.map((m) => enrichFromCatalog(template.id, m, catalogLookup));
            discoveredLive = true;
            logger.info(
              { provider: template.id, count: discovered.length },
              'Discovered models from provider /v1/models',
            );
          }
        } catch (err) {
          logger.warn(
            { err, provider: template.id },
            'Live model discovery failed; falling back to catalog list',
          );
        }
      }

      if (!discoveredLive && template.models.length > 0) {
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
      } else if (!discoveredLive && canDiscover) {
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
        `INSERT OR IGNORE INTO model_profiles (
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

  // When the operator has declared a known-good provider set, discovery has no
  // reason to look anywhere else. Without this every boot fired ~100 parallel
  // /v1/models requests at providers with no credentials, which produced a wall
  // of "Unable to connect" warnings and enough event-loop pressure to make
  // /health time out for the first minute or so after a restart.
  const allowlist = new Set(
    (process.env.DMRX_PROVIDER_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Phase 1: collect eligible providers via sync DB lookups (cheap, no I/O)
  const eligible: Array<{ providerId: string; templateId: string; baseUrl: string; apiKey: string }> = [];
  let skippedNotAllowlisted = 0;
  for (const template of PROVIDER_CATALOG) {
    if (template.apiFormat !== 'openai' || !template.baseUrl) continue;
    // Skip unconfigured local providers — their /v1/models is guaranteed to
    // ECONNREFUSED on every boot until the user actually runs the local stack.
    if (isLocalProviderUnconfigured(template)) continue;
    if (allowlist.size > 0 && !allowlist.has(template.id)) {
      skippedNotAllowlisted++;
      continue;
    }

    const row = db
      .prepare('SELECT id FROM providers WHERE name = ?')
      .get(template.id) as { id: string } | undefined;
    if (!row) continue;

    // Every discoverable provider is refreshed, not only those with zero
    // models. Providers registered before this ran kept whatever the static
    // catalog said forever — including model ids the upstream has since
    // removed and context windows that were never accurate.
    // Most /v1/models endpoints require auth; discovering with an empty key
    // just 401s and yields nothing for every keyed provider.
    eligible.push({
      providerId: row.id,
      templateId: template.id,
      baseUrl: template.baseUrl,
      apiKey: (template.envKey ? process.env[template.envKey] : '') ?? '',
    });
  }

  if (skippedNotAllowlisted > 0) {
    logger.info(
      { discovering: eligible.length, skipped: skippedNotAllowlisted },
      'Model discovery scoped to DMRX_PROVIDER_ALLOWLIST',
    );
  }

  // Phase 2: discover models in parallel. Each fetch is capped by its own
  // 1s AbortController timeout inside discoverOpenAIModels, so the total wait
  // is bounded by ~1s regardless of how many providers are in the catalog.
  const discoveries = await Promise.all(
    eligible.map(async ({ templateId, baseUrl, apiKey }) => {
      try {
        const discovered = await discoverOpenAIModels({ baseUrl, apiKey });
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
  let totalRefreshed = 0;
  let totalDeactivated = 0;
  // Only overwrite a stored value when the provider actually published one —
  // a silent API (google/opencode/nvidia return just an id) must not blank out
  // what the catalog supplied.
  const refresh = db.prepare(
    `UPDATE model_profiles SET
       context_window = COALESCE(?, context_window),
       max_output_tokens = COALESCE(?, max_output_tokens),
       display_name = COALESCE(NULLIF(?, ''), display_name),
       -- Never re-enable what an operator turned off. Upstream still LISTING
       -- a model is not a reason to route to it: Google lists several models
       -- that cannot be called at all, and re-activating them each boot put
       -- guaranteed-failing candidates back in front of the router.
       is_active = CASE WHEN operator_disabled = 1 THEN 0 ELSE 1 END,
       updated_at = datetime('now')
     WHERE provider_id = ? AND model_id = ?`,
  );

  for (let i = 0; i < discoveries.length; i++) {
    const result = discoveries[i];
    if (!result) continue;
    const { providerId, templateId } = eligible[i];
    // Enrich discovered models with catalog data (costs, ranks, free-tier
    // limits) — discovery wins for anything the API publishes.
    const enriched = result.discovered.map(m => enrichFromCatalog(templateId, m, catalogLookup));
    const inserted = insertModelProfiles(providerId, enriched, true);
    totalInserted += inserted;

    for (const m of enriched) {
      if (!m.modelId) continue;
      const res = refresh.run(
        m.contextWindow ?? null,
        m.maxOutputTokens ?? null,
        m.displayName ?? '',
        providerId,
        m.modelId,
      );
      if (res.changes > 0) totalRefreshed += 1;
    }

    // Deactivate models the provider no longer lists. Stale ids linger
    // otherwise (the catalog's gemini-3.5-flash / gemini-3-flash 404 upstream)
    // and keep getting picked by the router.
    //
    // Guarded, because a truncated or partially-failed listing would otherwise
    // deactivate live models: only run when discovery returned a plausible
    // list, and never when it would deactivate the majority of what we have.
    const live = new Set(enriched.map((m) => m.modelId).filter(Boolean));
    if (live.size > 0) {
      const existing = db
        .prepare('SELECT model_id FROM model_profiles WHERE provider_id = ? AND is_active = 1')
        .all(providerId) as Array<{ model_id: string }>;
      const stale = existing.filter((r) => !live.has(r.model_id));
      // A truncated/partial listing is short. A long listing that happens to
      // invalidate most stored rows is the expected one-off correction when a
      // provider's real catalogue finally replaces hand-written entries —
      // Google served 57 models against 122 stored, most of them fictional.
      // So trust any substantial listing, and fall back to the ratio check
      // only when the response was small enough to be suspect.
      const SUBSTANTIAL_LISTING = 10;
      const looksPartial =
        live.size < SUBSTANTIAL_LISTING && existing.length > 0 && stale.length > existing.length / 2;

      if (stale.length > 0 && !looksPartial) {
        const deactivate = db.prepare(
          `UPDATE model_profiles SET is_active = 0, updated_at = datetime('now')
           WHERE provider_id = ? AND model_id = ?`,
        );
        for (const s of stale) deactivate.run(providerId, s.model_id);
        totalDeactivated += stale.length;
        logger.info(
          { provider: templateId, deactivated: stale.length, stale: stale.slice(0, 5).map((s) => s.model_id) },
          'Deactivated models no longer listed by provider',
        );
      } else if (looksPartial) {
        logger.warn(
          { provider: templateId, existing: existing.length, wouldDeactivate: stale.length },
          'Skipped stale-model cleanup — discovery looks partial (would deactivate the majority)',
        );
      }
    }

    if (inserted > 0 || totalRefreshed > 0) {
      logger.info(
        { provider: templateId, inserted, discovered: enriched.length },
        'Refreshed model profiles from provider /v1/models',
      );
    }
  }

  if (totalRefreshed > 0) {
    logger.info({ count: totalRefreshed }, 'Refreshed model metadata from live discovery');
  }
  if (totalDeactivated > 0) {
    logger.info({ count: totalDeactivated }, 'Deactivated stale models no longer served upstream');
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

/**
 * One-time repair/sanitize pass for already-persisted model_profiles rows.
 * Runs at startup, after enrichExistingModels. Fixes three classes of damage
 * caused by upstream quirks that shipped to the DB before the discovery
 * pipeline clamped them:
 *
 *  1. Negative pricing (OpenRouter's "-1" sentinel persisted as -1000).
 *     Any negative price is a sentinel, never a real cost — zero it so the
 *     cost scorers (which divide by maxCost and clamp at 1) can't explode.
 *  2. OpenRouter's virtual routing models (openrouter/auto, openrouter/fusion,
 *     ...). They delegate routing back to OpenRouter's server-side router and
 *     publish the "-1" pricing sentinel — deactivate them so they can never
 *     be picked as routing candidates.
 *  3. Capability-blind / free-tier-starved rows. Rows written before the
 *     enrichFromCatalog fix have only ['streaming'] from discovery (the
 *     catalog's tool_use/json_mode/reasoning caps were discarded), no
 *     intelligence/speed rank, and no rate limits — so they classify into a
 *     weaker tier and score at the bare tier baseline. Re-union capabilities
 *     from the catalog template and backfill the free-tier metadata.
 *
 * Returns the number of rows touched.
 */
export async function repairModelProfiles(): Promise<number> {
  const db = getDb();
  const catalogLookup = buildCatalogLookup();
  let touched = 0;

  // 1) Zero negative pricing — sentinels, never real costs.
  const neg = db.prepare(
    `UPDATE model_profiles
     SET input_cost_per_1k = 0, output_cost_per_1k = 0, cost_per_image = 0,
         updated_at = datetime('now')
     WHERE input_cost_per_1k < 0 OR output_cost_per_1k < 0 OR cost_per_image < 0`,
  ).run();
  if (neg.changes > 0) {
    touched += neg.changes;
    logger.info({ count: neg.changes }, 'Repaired negative model pricing (zeroed sentinel values)');
  }

  // 2) Deactivate OpenRouter virtual routing models.
  const virt = db.prepare(
    `UPDATE model_profiles SET is_active = 0, updated_at = datetime('now')
     WHERE is_active = 1 AND model_id IN (${OPENROUTER_VIRTUAL_MODEL_IDS.map(() => '?').join(',')})`,
  ).run(...OPENROUTER_VIRTUAL_MODEL_IDS);
  if (virt.changes > 0) {
    touched += virt.changes;
    logger.info({ count: virt.changes, models: OPENROUTER_VIRTUAL_MODEL_IDS }, 'Deactivated OpenRouter virtual routing models');
  }

  // 3) Backfill capabilities + free-tier metadata for rows that have a catalog
  //    template but were written capability-blind / starved.
  const blind = db.prepare(
    `SELECT mp.id, mp.provider_id, mp.model_id, p.name as provider_name,
            mp.supports_streaming, mp.supports_vision, mp.supports_tool_use,
            mp.supports_json_mode, mp.supports_function_call, mp.supports_reasoning
     FROM model_profiles mp
     JOIN providers p ON p.id = mp.provider_id
     WHERE mp.is_active = 1`,
  ).all() as Array<{
    id: string; provider_id: string; model_id: string; provider_name: string;
    supports_streaming: number; supports_vision: number; supports_tool_use: number;
    supports_json_mode: number; supports_function_call: number; supports_reasoning: number;
  }>;

  const update = db.prepare(
    `UPDATE model_profiles SET
       supports_streaming = ?, supports_vision = ?, supports_tool_use = ?,
       supports_json_mode = ?, supports_function_call = ?, supports_reasoning = ?,
       rate_limit_rpm = COALESCE(?, rate_limit_rpm),
       rate_limit_rpd = COALESCE(?, rate_limit_rpd),
       rate_limit_tpm = COALESCE(?, rate_limit_tpm),
       rate_limit_tpd = COALESCE(?, rate_limit_tpd),
       monthly_token_budget = COALESCE(?, monthly_token_budget),
       intelligence_rank = COALESCE(?, intelligence_rank),
       speed_rank = COALESCE(?, speed_rank),
       capability_tier = ?, quality_score = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  );

  for (const row of blind) {
    const key = `${row.provider_name}/${row.model_id}`;
    const tmpl = catalogLookup.get(key);
    if (!tmpl) continue;

    const tmplCaps = new Set(tmpl.capabilities);
    // Union: a capability is on if the DB row OR the template claims it.
    const caps = {
      streaming: row.supports_streaming === 1 || tmplCaps.has('streaming'),
      vision: row.supports_vision === 1 || tmplCaps.has('vision'),
      tool_use: row.supports_tool_use === 1 || tmplCaps.has('tool_use'),
      json_mode: row.supports_json_mode === 1 || tmplCaps.has('json_mode'),
      function_call: row.supports_function_call === 1 || tmplCaps.has('function_call'),
      reasoning: row.supports_reasoning === 1 || tmplCaps.has('reasoning'),
    };

    const ft = tmpl.freeTier;
    // Proceed only when the row actually needs repair: a capability the
    // template provides is missing on the row, or the template carries
    // free-tier metadata (ranks / limits / budget) the row lacks. Keeps the
    // pass idempotent — rows inserted post-fix with full caps + ranks are
    // left untouched.
    const needsCapBackfill =
      (tmplCaps.has('streaming') && row.supports_streaming !== 1) ||
      (tmplCaps.has('vision') && row.supports_vision !== 1) ||
      (tmplCaps.has('tool_use') && row.supports_tool_use !== 1) ||
      (tmplCaps.has('json_mode') && row.supports_json_mode !== 1) ||
      (tmplCaps.has('function_call') && row.supports_function_call !== 1) ||
      (tmplCaps.has('reasoning') && row.supports_reasoning !== 1);
    const needsTierBackfill =
      !!ft &&
      (ft.intelligenceRank != null || ft.speedRank != null || ft.rateLimits || ft.monthlyTokenBudget != null);
    if (!needsCapBackfill && !needsTierBackfill) continue;

    // Reclassify tier + baseline quality from the unioned capability set, so a
    // formerly capability-blind row (e.g. kimi-k3-free stuck at 'balanced')
    // upgrades to the tier its real capabilities deserve.
    const capabilityTier = classifyCapabilityTier({
      modelId: row.model_id,
      displayName: tmpl.id,
      modality: tmpl.modalities[0] || 'llm',
      contextWindow: tmpl.contextWindow ?? null,
      maxOutputTokens: tmpl.maxOutputTokens ?? null,
      inputCostPer1M: Math.max(0, tmpl.inputCostPer1M ?? 0),
      outputCostPer1M: Math.max(0, tmpl.outputCostPer1M ?? 0),
      costPerImage: Math.max(0, tmpl.costPerImage ?? 0),
      capabilities: Object.entries(caps).filter(([, on]) => on).map(([name]) => name),
      specializations: tmpl.specializations,
    });

    const result = update.run(
      caps.streaming ? 1 : 0,
      caps.vision ? 1 : 0,
      caps.tool_use ? 1 : 0,
      caps.json_mode ? 1 : 0,
      caps.function_call ? 1 : 0,
      caps.reasoning ? 1 : 0,
      ft?.rateLimits?.rpm ?? null,
      ft?.rateLimits?.rpd ?? null,
      ft?.rateLimits?.tpm ?? null,
      ft?.rateLimits?.tpd ?? null,
      ft?.monthlyTokenBudget ?? null,
      ft?.intelligenceRank ?? null,
      ft?.speedRank ?? null,
      capabilityTier,
      getInitialQualityScore(capabilityTier),
      row.id,
    );
    if (result.changes > 0) touched++;
  }

  if (touched > 0) {
    logger.info({ count: touched }, 'Repaired model profiles (negative pricing, virtuals, capability/free-tier backfill)');
  }
  return touched;
}

