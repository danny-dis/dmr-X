import { AdapterRegistry, GenericOpenAIAdapter } from '@dmr-x/adapters';
import { logger } from '@dmr-x/utils';

export interface ProviderInitConfig {
  id: string;
  /** Env var(s) where ALL must be truthy to init (AND). Overrides auto-derivation. */
  requireEnv?: string | string[];
  /** Env var(s) where at least ONE must be truthy to init (OR). Overrides auto-derivation. */
  requireAnyEnv?: string | string[];
  /** Maps to config.apiKey */
  envApiKey?: string;
  /** Maps to config.baseUrl (overrides defaultBaseUrl) */
  envBaseUrl?: string;
  /** Maps to config.accessToken */
  envAccessToken?: string;
  /** Fallback baseUrl when envBaseUrl is unset */
  defaultBaseUrl?: string;
  /** Register a GenericOpenAIAdapter dynamically before init */
  registerGenericOpenAI?: boolean;
  /** Wrap init in try/catch (log warning instead of throwing) */
  swallowError?: boolean;
  /** Custom warning message for swallowError */
  swallowErrorMsg?: string;
  /** Build arbitrary additional config keys from env */
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
  // Note: .env.example uses SAMBANOVA_API_KEY — both are accepted for backward compat
  { id: 'sambanova', envApiKey: 'SAMBANOVA_API_KEY' },
  { id: 'nebius', envApiKey: 'NEBIUS_API_KEY' },
  { id: 'novita', envApiKey: 'NOVITA_API_KEY' },
  { id: 'moonshot', envApiKey: 'MOONSHOT_API_KEY' },
  { id: 'minimax', envApiKey: 'MINIMAX_API_KEY' },
  { id: 'nvidia_nim', envApiKey: 'NVIDIA_API_KEY' },
  { id: 'volcengine', envApiKey: 'VOLCENGINE_API_KEY' },
  { id: 'dashscope', envApiKey: 'DASHSCOPE_API_KEY' },
  { id: 'vllm', requireEnv: 'VLLM_API_BASE', envBaseUrl: 'VLLM_API_BASE' },

  // ---- Free-tier provider adapters (GitHub Models, Cloudflare Workers AI) ----
  { id: 'github', envApiKey: 'GITHUB_TOKEN', defaultBaseUrl: 'https://models.inference.ai.azure.com/v1', registerGenericOpenAI: true },
  { id: 'cloudflare', envApiKey: 'CLOUDFLARE_AI_TOKEN', defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', registerGenericOpenAI: true, buildConfig: (env) => ({
    accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
  })},

  // ---- AND / OR condition providers ----
  { id: 'azure_openai', requireEnv: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'], envApiKey: 'AZURE_OPENAI_API_KEY', envBaseUrl: 'AZURE_OPENAI_ENDPOINT' },
  { id: 'databricks', requireEnv: ['DATABRICKS_HOST', 'DATABRICKS_TOKEN'], envApiKey: 'DATABRICKS_TOKEN', envBaseUrl: 'DATABRICKS_HOST' },
  { id: 'bedrock', requireAnyEnv: ['BEDROCK_AWS_ACCESS_KEY_ID', 'BEDROCK_AWS_SECRET_ACCESS_KEY'], envApiKey: 'BEDROCK_AWS_ACCESS_KEY_ID', envAccessToken: 'BEDROCK_AWS_SECRET_ACCESS_KEY' },
  { id: 'antigravity', requireAnyEnv: ['ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_OAUTH_TOKEN'], buildConfig: (env) => ({
    apiKey: env.ANTIGRAVITY_API_KEY || env.ANTIGRAVITY_OAUTH_TOKEN || '',
    projectId: env.ANTIGRAVITY_PROJECT_ID,
  })},
  { id: 'paddleocr', requireAnyEnv: ['PADDLEOCR_BASE_URL', 'HF_TOKEN'], buildConfig: (env) => ({
    baseUrl: env.PADDLEOCR_BASE_URL || env.HF_INFERENCE_URL || 'http://localhost:8000',
    apiKey: env.PADDLEOCR_API_KEY || env.HF_TOKEN || '',
  })},

  // ---- Google / Vertex AI (try/catch, same env key) ----
  { id: 'google', envApiKey: 'GOOGLE_API_KEY', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', registerGenericOpenAI: true },
  { id: 'veo', envApiKey: 'GOOGLE_API_KEY', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'vertex_ai', requireAnyEnv: ['VERTEX_PROJECT_ID', 'GOOGLE_API_KEY'], envApiKey: 'GOOGLE_API_KEY', swallowError: true, swallowErrorMsg: 'Skipping vertex_ai init (will retry in background)' },

  // ---- Image / Audio providers ----
  { id: 'stability', envApiKey: 'STABILITY_API_KEY', envBaseUrl: 'STABILITY_BASE_URL', defaultBaseUrl: 'https://api.stability.ai/v1' },
  { id: 'elevenlabs', envApiKey: 'ELEVENLABS_API_KEY', defaultBaseUrl: 'https://api.elevenlabs.io/v1' },
  { id: 'deepgram', envApiKey: 'DEEPGRAM_API_KEY', defaultBaseUrl: 'https://api.deepgram.com/v1' },
  { id: 'cohere', envApiKey: 'COHERE_API_KEY', defaultBaseUrl: 'https://api.cohere.com/v2' },
  { id: 'jina', envApiKey: 'JINA_API_KEY', defaultBaseUrl: 'https://api.jina.ai/v1' },
  { id: 'fal', envApiKey: 'FAL_KEY', defaultBaseUrl: 'https://fal.run' },
  { id: 'runway', envApiKey: 'RUNWAY_API_KEY', defaultBaseUrl: 'https://api.dev.runwayml.com/v1' },
  { id: 'audioshake', envApiKey: 'AUDIO_SHAKE_API_KEY', envBaseUrl: 'DMRX_AUDIO_SHAKE_BASE_URL', defaultBaseUrl: 'https://api.audioshake.com/v1' },
  { id: 'stemsplit', envApiKey: 'STEMSPLIT_API_KEY', envBaseUrl: 'DMRX_STEMSPLIT_BASE_URL', defaultBaseUrl: 'https://api.stemsplit.com/v1' },

  // ---- Base-URL-only providers ----
  { id: 'comfyui', requireEnv: 'COMFYUI_BASE_URL', envBaseUrl: 'COMFYUI_BASE_URL', buildConfig: (env) => ({
    maxConcurrent: parseInt(env.COMFYUI_MAX_CONCURRENT || '1', 10),
  })},
  { id: 'demucs', requireEnv: 'DMRX_DEMUCS_BASE_URL', envBaseUrl: 'DMRX_DEMUCS_BASE_URL' },
  { id: 'tesseract', requireEnv: 'TESSERACT_BASE_URL', envBaseUrl: 'TESSERACT_BASE_URL' },
];

export async function initializeAdapters(adapterRegistry: AdapterRegistry): Promise<void> {
  const env = process.env;

  for (const cfg of PROVIDER_INIT_CONFIG) {
    const {
      id, requireEnv, requireAnyEnv,
      envApiKey, envBaseUrl, envAccessToken, defaultBaseUrl,
      registerGenericOpenAI, swallowError, swallowErrorMsg, buildConfig,
    } = cfg;

    // ---- Determine gate condition ----
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

    // ---- Build config object ----
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

    // ---- Register dynamic adapter (e.g. ollama-cloud) ----
    if (registerGenericOpenAI) {
      const dynamicAdapter = new GenericOpenAIAdapter(id);
      adapterRegistry.register(dynamicAdapter);
    }

    // ---- Initialize with optional error swallowing ----
    // Bound each init with a timeout so a single provider whose upstream
    // hangs indefinitely (unreachable host that ignores connection timeouts)
    // cannot block the entire gateway boot. A hung provider is logged and
    // skipped; its health is re-evaluated by the non-blocking HealthChecker.
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
    if (swallowError) {
      try {
        await initWithTimeout;
      } catch (err) {
        logger.warn({ err, providerId: id }, swallowErrorMsg || `Skipping ${id} init (will retry in background)`);
      }
    } else {
      try {
        await initWithTimeout;
      } catch (err) {
        logger.warn({ err, providerId: id }, `Adapter ${id} init failed/timed out during boot — continuing without it`);
      }
    }
  }
}
