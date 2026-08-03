import { AdapterRegistry, GenericOpenAIAdapter } from '@dmr-x/adapters';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// Mirrors apps/gateway/src/adapter-init.ts: registers + initializes provider
// adapters keyed by provider id (the UUIDs the router resolves candidates to),
// reading base URLs / API keys from process.env. Without this the MCP server's
// AdapterRegistry only holds 14 hardcoded adapter types and every routed
// request fails with "Adapter not found: <provider-uuid>".

export interface ProviderInitConfig {
  id: string;
  requireEnv?: string | string[];
  requireAnyEnv?: string | string[];
  envApiKey?: string;
  envBaseUrl?: string;
  envAccessToken?: string;
  defaultBaseUrl?: string;
  registerGenericOpenAI?: boolean;
  swallowError?: boolean;
  swallowErrorMsg?: string;
  buildConfig?: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
}

export const PROVIDER_INIT_CONFIG: ProviderInitConfig[] = [
  // ---- LLM / Chat ----
  { id: 'openai', envApiKey: 'OPENAI_API_KEY', envBaseUrl: 'OPENAI_BASE_URL', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', envApiKey: 'ANTHROPIC_API_KEY', envBaseUrl: 'ANTHROPIC_BASE_URL', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { id: 'ollama', requireEnv: 'OLLAMA_BASE_URL', envBaseUrl: 'OLLAMA_BASE_URL' },
  { id: 'ollama-cloud', envApiKey: 'OLLAMA_CLOUD_API_KEY', envBaseUrl: 'OLLAMA_CLOUD_BASE_URL', defaultBaseUrl: 'https://ollama.com/v1', registerGenericOpenAI: true },
  { id: 'replicate', envApiKey: 'REPLICATE_API_TOKEN', defaultBaseUrl: 'https://api.replicate.com/v1' },
  { id: 'groq', envApiKey: 'GROQ_API_KEY' },
  { id: 'deepseek', envApiKey: 'DEEPSEEK_API_KEY' },
  { id: 'xai', envApiKey: 'XAI_API_KEY' },
  { id: 'openrouter', envApiKey: 'OPENROUTER_API_KEY' },
  { id: 'huggingface', envApiKey: 'HUGGINGFACE_API_KEY' },
  { id: 'perplexity', envApiKey: 'PERPLEXITY_API_KEY' },
  { id: 'together_ai', envApiKey: 'TOGETHER_API_KEY' },
  { id: 'fireworks_ai', envApiKey: 'FIREWORKS_API_KEY' },
  { id: 'cerebras', envApiKey: 'CEREBRAS_API_KEY' },
  { id: 'sambanova', envApiKey: 'SAMBANOVA_API_KEY' },
  { id: 'nebius', envApiKey: 'NEBIUS_API_KEY' },
  { id: 'novita', envApiKey: 'NOVITA_API_KEY' },
  { id: 'moonshot', envApiKey: 'MOONSHOT_API_KEY' },
  { id: 'minimax', envApiKey: 'MINIMAX_API_KEY' },
  { id: 'nvidia-nim', envApiKey: 'NVIDIA_NIM_API_KEY' },
  { id: 'volcengine', envApiKey: 'VOLCENGINE_API_KEY' },
  { id: 'dashscope', envApiKey: 'DASHSCOPE_API_KEY' },
  { id: 'vllm', requireEnv: 'VLLM_API_BASE', envBaseUrl: 'VLLM_API_BASE' },
  { id: 'github', envApiKey: 'GITHUB_TOKEN', defaultBaseUrl: 'https://models.inference.ai.azure.com/v1', registerGenericOpenAI: true },
  { id: 'cloudflare', envApiKey: 'CLOUDFLARE_API_TOKEN', defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', registerGenericOpenAI: true, buildConfig: (env) => ({ accountId: env.CLOUDFLARE_ACCOUNT_ID || '' }) },
  { id: 'azure_openai', requireEnv: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'], envApiKey: 'AZURE_OPENAI_API_KEY', envBaseUrl: 'AZURE_OPENAI_ENDPOINT' },
  { id: 'databricks', requireEnv: ['DATABRICKS_HOST', 'DATABRICKS_TOKEN'], envApiKey: 'DATABRICKS_TOKEN', envBaseUrl: 'DATABRICKS_HOST' },
  { id: 'bedrock', requireAnyEnv: ['BEDROCK_AWS_ACCESS_KEY_ID', 'BEDROCK_AWS_SECRET_ACCESS_KEY'], envApiKey: 'BEDROCK_AWS_ACCESS_KEY_ID', envAccessToken: 'BEDROCK_AWS_SECRET_ACCESS_KEY' },
  { id: 'antigravity', requireAnyEnv: ['ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_OAUTH_TOKEN'], buildConfig: (env) => ({ apiKey: env.ANTIGRAVITY_API_KEY || env.ANTIGRAVITY_OAUTH_TOKEN || '', projectId: env.ANTIGRAVITY_PROJECT_ID }) },
  { id: 'paddleocr', requireAnyEnv: ['PADDLEOCR_BASE_URL', 'HF_TOKEN'], buildConfig: (env) => ({ baseUrl: env.PADDLEOCR_BASE_URL || env.HF_INFERENCE_URL || 'http://localhost:8000', apiKey: env.PADDLEOCR_API_KEY || env.HF_TOKEN || '' }) },
  { id: 'google', envApiKey: 'GOOGLE_API_KEY', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', registerGenericOpenAI: true },
  { id: 'veo', envApiKey: 'GOOGLE_API_KEY', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'vertex_ai', requireAnyEnv: ['VERTEX_PROJECT_ID', 'GOOGLE_API_KEY'], envApiKey: 'GOOGLE_API_KEY', swallowError: true, swallowErrorMsg: 'Skipping vertex_ai init (will retry in background)' },
  { id: 'stability', envApiKey: 'STABILITY_API_KEY', envBaseUrl: 'STABILITY_BASE_URL', defaultBaseUrl: 'https://api.stability.ai/v1' },
  { id: 'elevenlabs', envApiKey: 'ELEVENLABS_API_KEY', defaultBaseUrl: 'https://api.elevenlabs.io/v1' },
  { id: 'deepgram', envApiKey: 'DEEPGRAM_API_KEY', defaultBaseUrl: 'https://api.deepgram.com/v1' },
  { id: 'cohere', envApiKey: 'COHERE_API_KEY', defaultBaseUrl: 'https://api.cohere.com/v2' },
  { id: 'jina', envApiKey: 'JINA_API_KEY', defaultBaseUrl: 'https://api.jina.ai/v1' },
  { id: 'fal', envApiKey: 'FAL_KEY', defaultBaseUrl: 'https://fal.run' },
  { id: 'runway', envApiKey: 'RUNWAY_API_KEY', defaultBaseUrl: 'https://api.dev.runwayml.com/v1' },
  { id: 'audioshake', envApiKey: 'AUDIOSHAKE_API_KEY', envBaseUrl: 'DMRX_AUDIO_SHAKE_BASE_URL', defaultBaseUrl: 'https://api.audioshake.com/v1' },
  { id: 'stemsplit', envApiKey: 'STEMSPLIT_API_KEY', envBaseUrl: 'DMRX_STEMSPLIT_BASE_URL', defaultBaseUrl: 'https://api.stemsplit.com/v1' },
  { id: 'comfyui', requireEnv: 'COMFYUI_BASE_URL', envBaseUrl: 'COMFYUI_BASE_URL', buildConfig: (env) => ({ maxConcurrent: parseInt(env.COMFYUI_MAX_CONCURRENT || '1', 10) }) },
  { id: 'demucs', requireEnv: 'DMRX_DEMUCS_BASE_URL', envBaseUrl: 'DMRX_DEMUCS_BASE_URL' },
  { id: 'tesseract', requireEnv: 'TESSERACT_BASE_URL', envBaseUrl: 'TESSERACT_BASE_URL' },
  // Additional free-tier / keyed providers referenced by the catalog.
  { id: 'openrouter-free', envApiKey: 'OPENROUTER_API_KEY' },
  { id: 'codestral-free', envApiKey: 'MISTRAL_API_KEY' },
  // OpenCode free models are served through OpenRouter's OpenAI-compatible
  // endpoint. The key (OPENCODE_ZEN_API_KEY) is an OpenRouter-style key, so
  // point at OpenRouter's /v1. (The gateway has no opencode-zen entry of its
  // own; this mirrors the OpenRouter-style free-tier providers.)
  { id: 'opencode-zen', envApiKey: 'OPENCODE_ZEN_API_KEY', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', envApiKey: 'MISTRAL_API_KEY' },
  { id: 'cohere-free', envApiKey: 'COHERE_API_KEY' },
  { id: 'nvidia', envApiKey: 'NVIDIA_API_KEY' },
  { id: 'pollinations-images', defaultBaseUrl: 'https://image.pollinations.ai', registerGenericOpenAI: false },
  { id: 'pollinations', defaultBaseUrl: 'https://text.pollinations.ai', registerGenericOpenAI: true },
];

export async function initializeAdapters(adapterRegistry: AdapterRegistry): Promise<void> {
  const env = process.env;

  for (const cfg of PROVIDER_INIT_CONFIG) {
    const {
      id, requireEnv, requireAnyEnv,
      envApiKey, envBaseUrl, envAccessToken, defaultBaseUrl,
      registerGenericOpenAI, swallowError, swallowErrorMsg, buildConfig,
    } = cfg;

    let gateVars: string[] | null = null;
    let gateMode: 'and' | 'or' = 'or';

    if (requireEnv) {
      gateVars = Array.isArray(requireEnv) ? requireEnv : [requireEnv];
      gateMode = 'and';
    } else if (requireAnyEnv) {
      gateVars = Array.isArray(requireAnyEnv) ? requireAnyEnv : [requireAnyEnv];
      gateMode = 'or';
    } else if (envApiKey) {
      gateVars = [envApiKey];
      gateMode = 'or';
    } else if (envBaseUrl) {
      gateVars = [envBaseUrl];
      gateMode = 'or';
    }

    if (gateVars) {
      const passed = gateMode === 'and'
        ? gateVars.every((v) => env[v])
        : gateVars.some((v) => env[v]);
      if (!passed) continue;
    }

    const config: Record<string, unknown> = {};

    if (envApiKey && env[envApiKey]) {
      config.apiKey = env[envApiKey];
    }
    if (envBaseUrl && env[envBaseUrl]) {
      config.baseUrl = env[envBaseUrl];
    } else if (defaultBaseUrl) {
      config.baseUrl = defaultBaseUrl;
    }
    if (envAccessToken && env[envAccessToken]) {
      config.accessToken = env[envAccessToken];
    }

    if (buildConfig) {
      Object.assign(config, buildConfig(env));
    }

    if (registerGenericOpenAI) {
      const dynamicAdapter = new GenericOpenAIAdapter(id);
      adapterRegistry.register(dynamicAdapter);
    }

    const INIT_TIMEOUT_MS = 15_000;
    const initWithTimeout = Promise.race([
      adapterRegistry.initialize(id, config),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Adapter init for ${id} timed out after ${INIT_TIMEOUT_MS}ms`)),
          INIT_TIMEOUT_MS,
        ),
      ),
    ]);
    try {
      await initWithTimeout;
    } catch (err) {
      logger.warn({ err, providerId: id }, swallowErrorMsg || `Adapter ${id} init failed/timed out during boot — continuing without it`);
    }
  }

  // Register a generic OpenAI adapter for EVERY provider in the DB so that any
  // routed candidate (keyed by UUID -> providers.name) resolves, including
  // fallbacks the catalog config above didn't enumerate. This mirrors the
  // gateway, which registers adapters for all activated providers.
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, name, base_url, api_key_ref, config FROM providers'
    ).all() as Array<{
      id: string; name: string; base_url: string | null;
      api_key_ref: string | null; config: string | null;
    }>;
    for (const row of rows) {
      if (adapterRegistry.peek(row.name)) continue; // already registered above
      const cfg = row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {};
      const key = row.api_key_ref ? env[row.api_key_ref] : undefined;
      const baseUrl = row.base_url || (cfg.baseUrl as string | undefined);
      if (!baseUrl) continue; // no endpoint -> skip (e.g. local-only providers)
      const adapter = new GenericOpenAIAdapter(row.name);
      adapterRegistry.register(adapter);
      try {
        await adapterRegistry.initialize(row.name, {
          ...(key ? { apiKey: key } : {}),
          baseUrl,
        });
      } catch {
        /* best-effort: leave uninitialized, router will report if selected */
      }
    }
    logger.info({ count: rows.length }, 'Registered DB providers as generic adapters');
  } catch (err) {
    logger.warn({ err }, 'DB provider registration pass failed');
  }
}
