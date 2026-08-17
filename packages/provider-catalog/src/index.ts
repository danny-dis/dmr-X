/**
 * Comprehensive AI Provider Catalog
 *
 * 35+ providers with API details, modalities, and adapter configurations.
 * Users can add any of these via: dmrx add-provider <provider-id>
 */

export interface OAuthProviderConfig {
  flow: 'authorization_code' | 'client_credentials' | 'device_code';
  authorizationUrl?: string;
  tokenUrl: string;
  deviceCodeUrl?: string;
  clientIdEnvKey: string;
  clientSecretEnvKey?: string;
  scopes: string[];
  audience?: string;
  usePKCE?: boolean;
  redirectPath: string;
  tokenResponseType: 'access_token' | 'access_refresh';
}

export interface ProviderTemplate {
  id: string;
  name: string;
  category: 'cloud_llm' | 'cloud_diffusion' | 'cloud_audio' | 'cloud_video' | 'cloud_embedding' | 'local' | 'hosting' | 'specialized';
  baseUrl: string;
  authMethod: 'bearer' | 'x-api-key' | 'api-key-param' | 'xi-api-key' | 'custom' | 'none';
  authHeader?: string;
  authParam?: string;
  apiFormat: 'openai' | 'anthropic' | 'google' | 'custom';
  modalities: string[];
  models: ModelTemplate[];
  streaming: boolean;
  toolCalling: boolean;
  envKey: string;
  description: string;
  region?: string; // 'us' | 'eu' | 'cn' | 'kr' | 'in' | 'global' | 'local' | 'self'
  signupUrl?: string;
  oauthConfig?: OAuthProviderConfig;
}

export interface ModelTemplate {
  id: string;
  modalities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  costPerImage?: number;
  capabilities: string[];
  specializations: string[];
  freeTier?: FreeTierInfo;
  /** If true, this model is only available via OAuth subscription auth (not API key) */
  subscriptionOnly?: boolean;
  /** Unified pricing classification for routing decisions */
  pricingTier?: PricingTier;
  /** Shared provider-wide rate limit pool (across all models) */
  sharedPool?: {
    rpm?: number;
    rpd?: number;
    tpm?: number;
    tpd?: number;
  };

  // ═══════════════════════════════════════════════════════════
  // 9-DIMENSION TAXONOMY FIELDS
  // ═══════════════════════════════════════════════════════════

  /** Dimension 1: How smart/powerful is the model? */
  capabilityTier?: 'frontier' | 'strong' | 'balanced' | 'fast' | 'economy';
  
  /** Dimension 3: What is the model good at? */
  taskCategories?: string[];
  
  /** Dimension 5: How much can the model remember? */
  contextTier?: 'short' | 'medium' | 'long' | 'ultra' | 'massive';
  
  /** Dimension 6: Where does the model run? */
  deployment?: 'cloud' | 'self_hosted' | 'on_device';
  
  /** Dimension 7: Can the model switch thinking styles? */
  reasoningMode?: 'fixed' | 'adaptive' | 'hybrid';
  
  /** Dimension 8: Is the model deliberately limited for safety? */
  safetyTier?: 'unrestricted' | 'standard' | 'restricted';
  
  /** Dimension 9: How much autonomy does the model have? */
  agenticLevel?: 'chat' | 'tool_use' | 'autonomous';
  
  /** Technical: Model architecture type */
  architecture?: 'dense' | 'moe' | 'ssm' | 'hybrid';
  
  /** Technical: Total parameter count (null if unknown) */
  parameterCount?: number;
  
  /** Technical: Active parameters per token (for MoE models) */
  activeParameters?: number;
  
  /** Legal: License type */
  license?: 'open_weight' | 'open_source' | 'proprietary' | 'api_only';
}

/**
 * Pricing tier classification for routing decisions.
 * - 'free': $0 cost, no rate limits or generous limits
 * - 'free_with_limits': $0 cost but strict rate limits (RPM/TPM caps)
 * - 'paid': Standard per-token or per-request pricing
 * - 'subscription_only': Free but requires OAuth subscription (not API key)
 * - 'unknown': Cannot determine from catalog data
 */
export type PricingTier = 'free' | 'free_with_limits' | 'paid' | 'subscription_only' | 'unknown';

export interface FreeTierInfo {
  rateLimits: {
    rpm: number;  // requests per minute
    rpd: number;  // requests per day
    tpm: number;  // tokens per minute
    tpd: number;  // tokens per day
  };
  monthlyTokenBudget: number;  // 0 = unlimited within rate limits
  intelligenceRank: number;    // 1-10 scale
  speedRank: number;           // 1-10 scale
}

/**
 * Full provider catalog
 */
export const PROVIDER_CATALOG: ProviderTemplate[] = [
  // ═══════════════════════════════════════════════════════════
  // CLOUD LLM PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'openai',
    name: 'OpenAI',
    category: 'cloud_llm',
    baseUrl: 'https://api.openai.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'audio_tts', 'audio_stt', 'diffusion', 'video'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 2.5, outputCostPer1M: 10, capabilities: ['vision', 'tool_use', 'json_mode', 'streaming'], specializations: ['backend_api', 'backend_logic', 'general'] },
      { id: 'gpt-4o-mini', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.15, outputCostPer1M: 0.6, capabilities: ['vision', 'tool_use', 'json_mode', 'streaming'], specializations: ['bulk_generation', 'fast', 'cheap'] },
      { id: 'gpt-4.1', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 2, outputCostPer1M: 8, capabilities: ['vision', 'tool_use', 'json_mode', 'streaming'], specializations: ['backend_api', 'general'] },
      { id: 'gpt-4.1-mini', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.4, outputCostPer1M: 1.6, capabilities: ['vision', 'tool_use', 'json_mode', 'streaming'], specializations: ['bulk_generation', 'fast'] },
      { id: 'o3', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 10, outputCostPer1M: 40, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning', 'architecture'] },
      { id: 'o3-mini', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning'] },
      { id: 'o4-mini', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning'] },
      { id: 'dall-e-3', modalities: ['diffusion'], costPerImage: 0.04, capabilities: ['text2img'], specializations: ['creative'] },
      { id: 'text-embedding-3-small', modalities: ['embedding'], inputCostPer1M: 0.02, capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'text-embedding-3-large', modalities: ['embedding'], inputCostPer1M: 0.13, capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'whisper-1', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio'] },
      { id: 'tts-1', modalities: ['audio_tts'], capabilities: ['tts'], specializations: ['audio'] },
      { id: 'gpt-5.5', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 15, outputCostPer1M: 60, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'coding'] },
      { id: 'gpt-5.4', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 5, outputCostPer1M: 20, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'] },
      { id: 'gpt-5.4-mini', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 1, outputCostPer1M: 4, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general', 'fast'] },
      { id: 'gpt-4.1-nano', modalities: ['llm'], contextWindow: 1048576, maxOutputTokens: 32768, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast', 'cheap'] },
      { id: 'gpt-image-1', modalities: ['llm', 'image'], contextWindow: 128000, maxOutputTokens: 4096, inputCostPer1M: 5, outputCostPer1M: 20, costPerImage: 0.02, capabilities: ['streaming', 'vision'], specializations: ['image_generation'] },
      // Video generation (Sora 2)
      { id: 'sora-2', modalities: ['video'], capabilities: ['text2video', 'img2video', 'video_edit', 'video_extend', 'native_audio'], specializations: ['creative'] },
      { id: 'sora-2-pro', modalities: ['video'], capabilities: ['text2video', 'img2video', 'video_edit', 'video_extend', 'native_audio', '4k_output'], specializations: ['creative'] },
      // Subscription-only models (ChatGPT Plus/Pro via Codex OAuth)
      { id: 'gpt-5.5-codex', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'coding'], subscriptionOnly: true },
      { id: 'gpt-5.4-codex', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general', 'coding'], subscriptionOnly: true },
      { id: 'gpt-5.3-codex', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general', 'coding'], subscriptionOnly: true },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'OPENAI_API_KEY',
    description: 'Industry standard. GPT-4o, o3, DALL-E, Whisper, embeddings.',
    region: 'us',
    signupUrl: 'https://platform.openai.com/signup',
    oauthConfig: {
      flow: 'device_code',
      deviceCodeUrl: 'https://auth0.openai.com/oauth/device/code',
      tokenUrl: 'https://auth0.openai.com/oauth/token',
      clientIdEnvKey: 'OPENAI_CODEX_OAUTH_CLIENT_ID',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      audience: 'https://api.openai.com/v1',
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'cloud_llm',
    baseUrl: 'https://api.anthropic.com/v1',
    authMethod: 'x-api-key',
    apiFormat: 'anthropic',
    modalities: ['llm'],
    models: [
      { id: 'claude-opus-4-0520', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 15, outputCostPer1M: 75, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['architecture', 'reasoning', 'code_review'] },
      { id: 'claude-sonnet-4-0520', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 3, outputCostPer1M: 15, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['ui_design', 'frontend_logic', 'creative'] },
      { id: 'claude-3.5-sonnet', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 3, outputCostPer1M: 15, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['ui_design', 'ui_component', 'code_review'] },
      { id: 'claude-3.5-haiku', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0.8, outputCostPer1M: 4, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'bulk_generation'] },
      { id: 'claude-opus-4-7', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 15, outputCostPer1M: 75, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'coding', 'analysis'] },
      { id: 'claude-haiku-latest', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 0.25, outputCostPer1M: 1.25, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['fast', 'cheap'] },
      // Subscription-only models (Claude Pro/Max via OAuth)
      { id: 'claude-opus-4-8', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'coding', 'analysis'], subscriptionOnly: true },
      { id: 'claude-sonnet-4-6', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general', 'coding'], subscriptionOnly: true },
      { id: 'claude-fable-5', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'coding'], subscriptionOnly: true },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'ANTHROPIC_API_KEY',
    description: 'Claude models. Best for UI, frontend, creative, code review.',
    region: 'us',
    signupUrl: 'https://console.anthropic.com/',
    oauthConfig: {
      flow: 'device_code',
      deviceCodeUrl: 'https://claude.ai/oauth/device/code',
      tokenUrl: 'https://claude.ai/oauth/token',
      clientIdEnvKey: 'ANTHROPIC_CLAUDE_OAUTH_CLIENT_ID',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  {
    id: 'google',
    name: 'Google Gemini',
    category: 'cloud_llm',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'audio_stt', 'diffusion', 'video'],
    models: [
      { id: 'gemini-3.6-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.5-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.5-flash-lite', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 500, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 10 } },
      { id: 'gemini-3-flash-preview', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.1-flash-lite', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 500, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'gemini-2.5-pro', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 1.25, outputCostPer1M: 5, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['reasoning', 'general'] },
      { id: 'gemini-2.5-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.15, outputCostPer1M: 0.6, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 }, sharedPool: { rpm: 30, rpd: 1500, tpm: 1000000, tpd: 50000000 } },
      // gemini-2.5-flash-lite removed: the API returns 404 "no longer available to new users".
      { id: 'gemini-2.0-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'] },
      { id: 'text-embedding-004', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'imagen-3.0', modalities: ['diffusion'], capabilities: ['text2img'], specializations: ['creative'] },
      // Gemma on the Gemini API: only the gemma-4 pair is served. The gemma-3-*
      // ids are gone, and there is no "gemma-4-27b" — the real ids are below.
      { id: 'gemma-4-31b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 1500, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'gemma-4-26b-a4b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 1500, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GOOGLE_API_KEY',
    description: 'Gemini models. 1M+ context, fast, cheap. (Using OpenAI-compatible endpoint)',
    region: 'us',
    signupUrl: 'https://aistudio.google.com/',
    oauthConfig: {
      flow: 'authorization_code',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientIdEnvKey: 'GOOGLE_OAUTH_CLIENT_ID',
      scopes: ['https://www.googleapis.com/auth/generative-language'],
      usePKCE: true,
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  {
    id: 'google_native',
    name: 'Google Gemini (Native API)',
    category: 'cloud_llm',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [
      { id: 'gemini-3.6-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.5-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.5-flash-lite', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 500, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 10 } },
      { id: 'gemini-3-flash-preview', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gemini-3.1-flash-lite', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 500, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'gemini-2.5-pro', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 1.25, outputCostPer1M: 5, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['reasoning', 'general'] },
      { id: 'gemini-2.5-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.15, outputCostPer1M: 0.6, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 20, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 }, sharedPool: { rpm: 30, rpd: 1500, tpm: 1000000, tpd: 50000000 } },
      { id: 'gemini-2.0-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'] },
      { id: 'gemma-4-31b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 1500, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'gemma-4-26b-a4b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 1500, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GOOGLE_API_KEY',
    description: 'Gemini models via native API (streamGenerateContent). Primary for Gemini streaming.',
    region: 'us',
    signupUrl: 'https://aistudio.google.com/',
  },

  // google_native provider entry - veo follows

  {
    id: 'veo',
    name: 'Google Veo',
    category: 'cloud_video',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['video'],
    models: [
      { id: 'veo-3.1', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images', 'video_extend', 'first_last_frame', '4k_output'], specializations: ['creative'] },
      { id: 'veo-3.1-fast', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images'], specializations: ['creative', 'fast'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'GOOGLE_API_KEY',
    description: 'Google Veo 3.1 video generation.',
    region: 'us',
  },

  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: 'cloud_llm',
    baseUrl: 'https://api.githubcopilot.com',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o-copilot', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['coding'], subscriptionOnly: true },
      { id: 'claude-sonnet-4-copilot', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['coding'], subscriptionOnly: true },
      { id: 'o3-mini-copilot', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'reasoning'], specializations: ['reasoning', 'coding'], subscriptionOnly: true },
      { id: 'gpt-4o-mini-copilot', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['fast', 'coding'], subscriptionOnly: true },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GITHUB_TOKEN',
    description: 'GitHub Copilot models. Requires GitHub Copilot subscription.',
    region: 'global',
    signupUrl: 'https://github.com/features/copilot',
    oauthConfig: {
      flow: 'device_code',
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientIdEnvKey: 'GITHUB_COPILOT_OAUTH_CLIENT_ID',
      scopes: ['read:user', 'copilot'],
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  {
    id: 'mistral',
    name: 'Mistral AI',
    category: 'cloud_llm',
    baseUrl: 'https://api.mistral.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [
      // rpm/tpm below are the values Mistral reports in x-ratelimit-* response
      // headers on a free ("Experiment") key — they differ sharply per model,
      // so the router must not assume one shared limit for the provider.
      { id: 'mistral-large-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 2, outputCostPer1M: 6, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['backend_api', 'general'], freeTier: { rateLimits: { rpm: 4, rpd: 0, tpm: 250000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 8, speedRank: 6 } },
      { id: 'mistral-medium-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.4, outputCostPer1M: 2, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 50, rpd: 0, tpm: 25000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 8, speedRank: 8 } },
      { id: 'mistral-small-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.1, outputCostPer1M: 0.3, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 50, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'ministral-3b-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.04, outputCostPer1M: 0.04, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 750, rpd: 0, tpm: 1300000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 5, speedRank: 10 } },
      { id: 'ministral-8b-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.1, outputCostPer1M: 0.1, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 188, rpd: 0, tpm: 625000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'ministral-14b-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.15, outputCostPer1M: 0.15, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['general', 'fast'], freeTier: { rateLimits: { rpm: 30, rpd: 0, tpm: 937500, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'magistral-small-latest', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 50, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 8, speedRank: 6 } },
      { id: 'codestral-latest', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, capabilities: ['tool_use', 'streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 125, rpd: 0, tpm: 625000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 8, speedRank: 9 } },
      { id: 'devstral-latest', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0.4, outputCostPer1M: 2, capabilities: ['tool_use', 'streaming'], specializations: ['coding', 'backend_logic'], freeTier: { rateLimits: { rpm: 50, rpd: 0, tpm: 1000000, tpd: 0 }, monthlyTokenBudget: 1000000000, intelligenceRank: 8, speedRank: 6 } },
      { id: 'mistral-embed', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'MISTRAL_API_KEY',
    description: 'Mistral models. OpenAI-compatible. Codestral for code.',
    region: 'eu',
    signupUrl: 'https://console.mistral.ai/',
  },

  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'cloud_llm',
    baseUrl: 'https://api.deepseek.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'deepseek-chat', modalities: ['llm'], contextWindow: 64000, inputCostPer1M: 0.14, outputCostPer1M: 0.28, capabilities: ['tool_use', 'json_mode', 'streaming'], specializations: ['bulk_generation', 'cheap', 'documentation'] },
      { id: 'deepseek-reasoner', modalities: ['llm'], contextWindow: 64000, inputCostPer1M: 0.55, outputCostPer1M: 2.19, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'] },
      { id: 'deepseek-v4-pro', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 2, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['reasoning', 'coding'] },
      { id: 'deepseek-v4-flash', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.1, outputCostPer1M: 0.4, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast', 'cheap'] },
      { id: 'deepseek-v3.2', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.27, outputCostPer1M: 1.1, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['general', 'coding'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek models. Very cheap, good for bulk work.',
    region: 'global',
    signupUrl: 'https://platform.deepseek.com/',
  },

  {
    id: 'xai',
    name: 'xAI (Grok)',
    category: 'cloud_llm',
    baseUrl: 'https://api.x.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'grok-3', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 3, outputCostPer1M: 15, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general', 'creative'] },
      { id: 'grok-3-mini', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0.3, outputCostPer1M: 0.5, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'] },
      { id: 'grok-4', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 3, outputCostPer1M: 15, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'general'] },
      { id: 'grok-4-mini', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.5, outputCostPer1M: 2, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['fast', 'general'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'XAI_API_KEY',
    description: 'Grok models from xAI.',
    region: 'us',
    signupUrl: 'https://console.x.ai/',
  },

  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    category: 'cloud_llm',
    baseUrl: 'https://api.moonshot.cn/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'kimi-k2.6', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 1, outputCostPer1M: 3, capabilities: ['tool_use', 'streaming'], specializations: ['orchestration', 'architecture', 'reasoning'] },
      { id: 'moonshot-v1-128k', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['streaming'], specializations: ['general'] },
      { id: 'kimi-k2-thinking', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 2, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['reasoning', 'coding'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'MOONSHOT_API_KEY',
    description: 'Kimi models. Good for orchestration and long context.',
    region: 'cn',
    signupUrl: 'https://platform.moonshot.cn/',
  },

  {
    id: 'xiaomi',
    name: 'Xiaomi (MiMo)',
    category: 'cloud_llm',
    baseUrl: 'https://api.xiaomi.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'mimo-v2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['tool_use', 'streaming'], specializations: ['database_schema', 'database_query', 'data_modeling', 'orm'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'XIAOMI_API_KEY',
    description: 'MiMo models. Strong at database and structured data.',
    region: 'cn',
  },

  {
    id: 'cohere',
    name: 'Cohere',
    category: 'cloud_llm',
    baseUrl: 'https://api.cohere.com/v2',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['llm', 'embedding', 'reranking'],
    models: [
      // A Cohere trial key is capped at 1000 API calls/MONTH (~33/day) on top of
      // the 20 rpm limit; past that every call returns 429. rpd encodes that cap
      // so the router stops spending a persona's month in one burst.
      { id: 'command-a-plus-05-2026', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 2.5, outputCostPer1M: 10, capabilities: ['tool_use', 'streaming'], specializations: ['backend_api', 'general'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'command-a-reasoning-08-2025', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 6 } },
      { id: 'command-r-plus-08-2024', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 2.5, outputCostPer1M: 10, capabilities: ['tool_use', 'streaming'], specializations: ['backend_api', 'general'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'command-r-08-2024', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.15, outputCostPer1M: 0.6, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'command-r7b-12-2024', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'command-a-03-2025', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      // Rejects a tools[] payload with 400 — no tool_use capability.
      { id: 'c4ai-aya-expanse-32b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['multilingual'], freeTier: { rateLimits: { rpm: 20, rpd: 33, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'embed-english-v3.0', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'embed-multilingual-v3.0', modalities: ['embedding'], capabilities: ['embedding', 'multilingual'], specializations: ['embedding'] },
      { id: 'rerank-english-v3.0', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking'] },
      { id: 'rerank-multilingual-v3.0', modalities: ['reranking'], capabilities: ['reranking', 'multilingual'], specializations: ['reranking'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'COHERE_API_KEY',
    description: 'Cohere models. Best for reranking and enterprise search.',
    region: 'global',
    signupUrl: 'https://dashboard.cohere.com/',
  },

  // ═══════════════════════════════════════════════════════════
  // HOSTING / AGGREGATION PLATFORMS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'hosting',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'reranking'],
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', modalities: ['llm'], inputCostPer1M: 0.9, outputCostPer1M: 0.9, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'accounts/fireworks/models/deepseek-v3', modalities: ['llm'], inputCostPer1M: 0.9, outputCostPer1M: 0.9, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      // Embeddings
      { id: 'accounts/fireworks/models/stella-en-1.5B-v5', modalities: ['embedding'], inputCostPer1M: 0.008, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'nomic-embed-text-v1.5', modalities: ['embedding'], inputCostPer1M: 0.008, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'] },
      // Reranking
      { id: 'accounts/fireworks/models/cohere-rerank-v3.5', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'FIREWORKS_API_KEY',
    description: 'Fast inference for open-source models.',
    region: 'us',
    signupUrl: 'https://fireworks.ai/',
  },

  {
    id: 'replicate',
    name: 'Replicate',
    category: 'hosting',
    baseUrl: 'https://api.replicate.com/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['llm', 'diffusion', 'audio_tts', 'audio_stt', 'video', 'music', '3d'],
    models: [
      { id: 'stability-ai/sdxl', modalities: ['diffusion'], costPerImage: 0.0023, capabilities: ['text2img'], specializations: ['creative'] },
      { id: 'black-forest-labs/flux-schnell', modalities: ['diffusion'], costPerImage: 0.003, capabilities: ['text2img'], specializations: ['creative'] },
      // Video generation
      { id: 'stability-ai/stable-video-diffusion', modalities: ['video'], capabilities: ['img2video'], specializations: ['creative'] },
      { id: 'minimax/video-01', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative'] },
      { id: 'luma/ray-2', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative'] },
      // Music generation
      { id: 'meta/musicgen', modalities: ['music'], capabilities: ['music_generation'], specializations: ['creative'] },
      { id: 'suno/bark', modalities: ['music'], capabilities: ['music_generation', 'vocals'], specializations: ['creative'] },
      // 3D generation
      { id: 'tencent/hunyuan3d-2', modalities: ['3d'], capabilities: ['text-to-3d', 'image-to-3d'], specializations: ['creative'] },
      { id: 'stability-ai/stable-fast-3d', modalities: ['3d'], capabilities: ['image-to-3d'], specializations: ['creative', 'fast'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'REPLICATE_API_TOKEN',
    description: 'Run any open-source model. Diffusion, video, audio, 3D.',
    region: 'us',
    signupUrl: 'https://replicate.com/',
  },

  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'hosting',
    baseUrl: 'https://router.huggingface.co/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'diffusion', 'audio_stt', 'audio_tts', 'reranking'],
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', modalities: ['llm'], capabilities: ['streaming'], specializations: ['general'] },
      { id: 'black-forest-labs/FLUX.1-schnell', modalities: ['diffusion'], capabilities: ['text2img'], specializations: ['creative'] },
      { id: 'openai/whisper-large-v3', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio'] },
      // Embeddings
      { id: 'intfloat/multilingual-e5-large-instruct', modalities: ['embedding'], capabilities: ['embedding', 'multilingual'], specializations: ['embedding'] },
      { id: 'BAAI/bge-large-en-v1.5', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'sentence-transformers/all-MiniLM-L6-v2', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding', 'fast'] },
      // Reranking
      { id: 'BAAI/bge-reranker-v2-m3', modalities: ['reranking'], capabilities: ['reranking', 'multilingual'], specializations: ['reranking'] },
      { id: 'cross-encoder/ms-marco-MiniLM-L-6-v2', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking', 'fast'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'HF_TOKEN',
    description: 'HF Inference Providers. Access 20+ backends with one token.',
    region: 'global',
    signupUrl: 'https://huggingface.co/settings/tokens',
    oauthConfig: {
      flow: 'authorization_code',
      authorizationUrl: 'https://huggingface.co/oauth/authorize',
      tokenUrl: 'https://huggingface.co/oauth/token',
      clientIdEnvKey: 'HF_OAUTH_CLIENT_ID',
      clientSecretEnvKey: 'HF_OAUTH_CLIENT_SECRET',
      scopes: ['inference-api'],
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // CLOUD DIFFUSION PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'stability',
    name: 'Stability AI',
    category: 'cloud_diffusion',
    baseUrl: 'https://api.stability.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['diffusion'],
    models: [
      { id: 'stable-diffusion-xl-1024-v1-0', modalities: ['diffusion'], costPerImage: 0.002, capabilities: ['text2img', 'img2img'], specializations: ['creative'] },
      { id: 'stable-diffusion-3-medium', modalities: ['diffusion'], costPerImage: 0.03, capabilities: ['text2img'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'STABILITY_API_KEY',
    description: 'Stable Diffusion models. Text-to-image, img2img.',
    region: 'us',
    signupUrl: 'https://platform.stability.ai/',
  },

  {
    id: 'leonardo',
    name: 'Leonardo AI',
    category: 'cloud_diffusion',
    baseUrl: 'https://cloud.leonardo.ai/api/rest/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['diffusion'],
    models: [
      { id: 'leonardo-phoenix', modalities: ['diffusion'], capabilities: ['text2img', 'img2img'], specializations: ['creative'] },
      { id: 'leonardo-alchemy', modalities: ['diffusion'], capabilities: ['text2img'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'LEONARDO_API_KEY',
    description: 'AI image generation with fine-grained control.',
    region: 'us',
    signupUrl: 'https://app.leonardo.ai/',
  },

  {
    id: 'ideogram',
    name: 'Ideogram',
    category: 'cloud_diffusion',
    baseUrl: 'https://api.ideogram.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['diffusion'],
    models: [
      { id: 'ideogram-2.0', modalities: ['diffusion'], capabilities: ['text2img'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'IDEOGRAM_API_KEY',
    description: 'Best at text-in-image generation.',
    region: 'us',
    signupUrl: 'https://ideogram.ai/',
  },

  // ═══════════════════════════════════════════════════════════
  // CLOUD AUDIO PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'cloud_audio',
    baseUrl: 'https://api.elevenlabs.io/v1',
    authMethod: 'xi-api-key',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [
      { id: 'eleven_multilingual_v2', modalities: ['audio_tts'], capabilities: ['tts', 'multilingual'], specializations: ['audio'] },
      { id: 'eleven_turbo_v2', modalities: ['audio_tts'], capabilities: ['tts'], specializations: ['audio', 'fast'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'ELEVENLABS_API_KEY',
    description: 'Highest quality TTS. Voice cloning.',
    region: 'us',
    signupUrl: 'https://elevenlabs.io/',
  },

  {
    id: 'deepgram',
    name: 'Deepgram',
    category: 'cloud_audio',
    baseUrl: 'https://api.deepgram.com/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_stt'],
    models: [
      { id: 'nova-2', modalities: ['audio_stt'], capabilities: ['stt', 'multilingual'], specializations: ['audio'] },
      { id: 'nova-3', modalities: ['audio_stt'], capabilities: ['stt', 'multilingual'], specializations: ['audio'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'DEEPGRAM_API_KEY',
    description: 'Fastest STT. Real-time transcription.',
    region: 'us',
    signupUrl: 'https://console.deepgram.com/',
  },

  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    category: 'cloud_audio',
    baseUrl: 'https://api.assemblyai.com/v2',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_stt'],
    models: [
      { id: 'best', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio'] },
      { id: 'nano', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio', 'fast'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'ASSEMBLYAI_API_KEY',
    description: 'Accurate STT with speaker diarization.',
    region: 'us',
    signupUrl: 'https://www.assemblyai.com/',
  },

  {
    id: 'playht',
    name: 'PlayHT',
    category: 'cloud_audio',
    baseUrl: 'https://api.play.ht/api/v2',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [
      { id: 'PlayHT2.0', modalities: ['audio_tts'], capabilities: ['tts'], specializations: ['audio'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'PLAYHT_API_KEY',
    description: 'TTS with voice cloning.',
    region: 'us',
    signupUrl: 'https://play.ht/',
  },

  // ═══════════════════════════════════════════════════════════
  // CLOUD VIDEO PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'runway',
    name: 'RunwayML',
    category: 'cloud_video',
    baseUrl: 'https://api.dev.runwayml.com/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['video', 'diffusion'],
    models: [
      { id: 'gen-3-alpha', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative'] },
      { id: 'gen4.5', modalities: ['video'], capabilities: ['text2video', 'img2video', 'camera_control', 'reference_images'], specializations: ['creative'] },
      { id: 'gen4_turbo', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative', 'fast'] },
      { id: 'seedance2', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio'], specializations: ['creative'] },
      { id: 'veo3', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio'], specializations: ['creative'] },
      { id: 'veo3.1', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images', 'video_extend'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'RUNWAY_API_KEY',
    description: 'AI video generation. Gen-4.5, Seedance 2.0, Veo 3.1.',
    region: 'us',
    signupUrl: 'https://dev.runwayml.com/',
  },

  {
    id: 'pika',
    name: 'Pika Labs',
    category: 'cloud_video',
    baseUrl: 'https://api.pika.art/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['video'],
    models: [
      { id: 'pika-2.0', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'PIKA_API_KEY',
    description: 'AI video generation and editing.',
    region: 'us',
    signupUrl: 'https://pika.art/',
  },

  {
    id: 'fal',
    name: 'FAL.ai',
    category: 'cloud_video',
    baseUrl: 'https://fal.run',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['video', 'diffusion', 'music', '3d'],
    models: [
      // Seedance 2.0 (ByteDance)
      { id: 'seedance-2.0', modalities: ['video'], capabilities: ['text2video', 'img2video', 'reference-to-video', 'native_audio', 'multimodal_reference'], specializations: ['creative'] },
      { id: 'seedance-2.0/text-to-video', modalities: ['video'], capabilities: ['text2video', 'native_audio'], specializations: ['creative'] },
      { id: 'seedance-2.0/image-to-video', modalities: ['video'], capabilities: ['img2video', 'native_audio'], specializations: ['creative'] },
      { id: 'seedance-2.0/reference-to-video', modalities: ['video'], capabilities: ['reference-to-video', 'native_audio'], specializations: ['creative'] },
      { id: 'seedance-2.0-fast', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio'], specializations: ['creative', 'fast'] },
      // Wan 2.7 (Alibaba)
      { id: 'wan-2.7', modalities: ['video'], capabilities: ['text2video', 'img2video', 'reference-to-video', 'video-edit', 'native_audio'], specializations: ['creative'] },
      { id: 'wan-2.7/text-to-video', modalities: ['video'], capabilities: ['text2video', 'native_audio'], specializations: ['creative'] },
      { id: 'wan-2.7/image-to-video', modalities: ['video'], capabilities: ['img2video', 'native_audio'], specializations: ['creative'] },
      { id: 'wan-2.7/reference-to-video', modalities: ['video'], capabilities: ['reference-to-video'], specializations: ['creative'] },
      { id: 'wan-2.7/edit-video', modalities: ['video'], capabilities: ['video-edit'], specializations: ['creative'] },
      // Kling 3.0 (Kuaishou)
      { id: 'kling-v3', modalities: ['video'], capabilities: ['text2video', 'img2video', 'native_audio', 'multi_shot', '4k_output'], specializations: ['creative'] },
      { id: 'kling-v3/text-to-video', modalities: ['video'], capabilities: ['text2video', 'native_audio'], specializations: ['creative'] },
      { id: 'kling-v3/image-to-video', modalities: ['video'], capabilities: ['img2video'], specializations: ['creative'] },
      // Music Generation
      { id: 'sonauto/v2/text-to-music', modalities: ['music'], capabilities: ['music_generation', 'vocals'], specializations: ['creative'] },
      { id: 'cassetteai/music-generator', modalities: ['music'], capabilities: ['music_generation'], specializations: ['creative'] },
      // 3D Generation
      { id: 'hunyuan3d', modalities: ['3d'], capabilities: ['text2img', 'image-to-3d', 'multi-view'], specializations: ['creative'] },
      { id: 'trellis', modalities: ['3d'], capabilities: ['text-to-3d', 'image-to-3d'], specializations: ['creative'] },
      { id: 'trellis2', modalities: ['3d'], capabilities: ['text-to-3d', 'image-to-3d'], specializations: ['creative'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'FAL_KEY',
    description: 'FAL.ai serverless video. Seedance 2.0, Wan 2.7, Kling 3.0. Music + 3D. Pay-per-second.',
    region: 'global',
    signupUrl: 'https://fal.ai/',
  },

  {
    id: 'luma',
    name: 'Luma AI',
    category: 'cloud_video',
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['video'],
    models: [
      { id: 'ray-3.2', modalities: ['video'], capabilities: ['text2video', 'img2video', 'video_extend', 'camera_control', 'first_last_frame'], specializations: ['creative'] },
      { id: 'ray-2', modalities: ['video'], capabilities: ['text2video', 'img2video', 'video_extend', 'camera_control'], specializations: ['creative'] },
      { id: 'ray-flash-2', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative', 'fast'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'LUMA_API_KEY',
    description: 'Luma Dream Machine. Ray 3.2/2. Best camera control. Pay-per-video.',
    region: 'us',
    signupUrl: 'https://lumalabs.ai/api',
  },

  // ═══════════════════════════════════════════════════════════
  // EMBEDDING SPECIALISTS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'jina',
    name: 'Jina AI',
    category: 'cloud_embedding',
    baseUrl: 'https://api.jina.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['embedding', 'reranking'],
    models: [
      { id: 'jina-embeddings-v3', modalities: ['embedding'], capabilities: ['embedding', 'multilingual'], specializations: ['embedding'] },
      { id: 'jina-reranker-v2-base-multilingual', modalities: ['reranking'], capabilities: ['reranking', 'multilingual'], specializations: ['reranking'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'JINA_API_KEY',
    description: 'Embeddings and reranking. Multilingual.',
    region: 'us',
    signupUrl: 'https://jina.ai/',
  },

  {
    id: 'voyage',
    name: 'Voyage AI',
    category: 'cloud_embedding',
    baseUrl: 'https://api.voyageai.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['embedding', 'reranking'],
    models: [
      { id: 'voyage-3', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'voyage-3-lite', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding', 'cheap'] },
      { id: 'rerank-2', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'VOYAGE_API_KEY',
    description: 'Best-in-class embeddings and reranking.',
    region: 'us',
    signupUrl: 'https://dash.voyageai.com/',
  },

  // ═══════════════════════════════════════════════════════════
  // LOCAL MODEL PLATFORMS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'ollama',
    name: 'Ollama (Local)',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [],  // Auto-discovered
    streaming: true,
    toolCalling: true,
    envKey: 'OLLAMA_BASE_URL',
    description: 'Local model runner. Pull-and-run. CPU/GPU.',
    region: 'local',
  },

  // NOTE: this provider is intentionally NOT reachable via auto-agentic (which filters for >=64K context). Use it as a direct pre-router.
  {
    id: 'needle-local',
    name: 'Needle 2 (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8011/v1',
    authMethod: 'none',
    apiFormat: 'openai',
    modalities: ['text'],
    models: [
      {
        id: 'needle2',
        modalities: ['text'],
        contextWindow: 256,
        maxOutputTokens: 64,
        capabilities: ['tool_use'],
        specializations: ['function-calling', 'tool-routing'],
        freeTier: { rateLimits: { rpm: 60, rpd: 86400, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 2, speedRank: 10 },
      },
    ],
    streaming: false,
    toolCalling: true,
    envKey: '',
    description: 'Local 26M-param tool router (Needle). Used as a cheap first-stage tool/agent pre-filter; NOT selected by auto-agentic (requires >=64K context).',
    region: 'local',
  },

  {
    id: 'vllm',
    name: 'vLLM (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8000/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [],  // Configured at serve time
    streaming: true,
    toolCalling: true,
    envKey: 'VLLM_BASE_URL',
    description: 'High-throughput local inference. PagedAttention.',
    region: 'local',
  },

  {
    id: 'llamacpp',
    name: 'llama.cpp (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [],  // Loaded at startup
    streaming: true,
    toolCalling: false,
    envKey: 'LLAMACPP_BASE_URL',
    description: 'C/C++ inference. CPU, GPU, Metal, Vulkan.',
    region: 'local',
  },

  {
    id: 'localai',
    name: 'LocalAI',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'diffusion', 'audio_stt'],
    models: [],  // Auto-downloaded from HF
    streaming: true,
    toolCalling: false,
    envKey: 'LOCALAI_BASE_URL',
    description: 'Unified local API. OpenAI-compatible. Multi-model.',
    region: 'local',
  },

  // ═══════════════════════════════════════════════════════════
  // SELF-HOSTED SPECIALIZED PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'tei',
    name: 'Text Embeddings Inference (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8090',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['embedding', 'reranking'],
    models: [],  // Configured at serve time
    streaming: false,
    toolCalling: false,
    envKey: 'TEI_BASE_URL',
    description: 'Hugging Face TEI. Fast embeddings + reranking. GPU-optimized.',
    region: 'local',
  },

  {
    id: 'piper',
    name: 'Piper TTS (Local)',
    category: 'local',
    baseUrl: 'http://localhost:5000',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [],  // Loaded at startup
    streaming: false,
    toolCalling: false,
    envKey: 'PIPER_BASE_URL',
    description: 'Local neural TTS. Fast, lightweight, CPU-friendly.',
    region: 'local',
  },

  {
    id: 'kokoro',
    name: 'Kokoro TTS (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8880',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [],  // Loaded at startup
    streaming: false,
    toolCalling: false,
    envKey: 'KOKORO_BASE_URL',
    description: 'Local TTS. High-quality, fast inference.',
    region: 'local',
  },

  {
    id: 'orpheus',
    name: 'Orpheus TTS (Local)',
    category: 'local',
    baseUrl: 'http://localhost:5005',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [],  // Loaded at startup
    streaming: true,
    toolCalling: false,
    envKey: 'ORPHEUS_BASE_URL',
    description: 'Local TTS with emotional expression. Streaming support.',
    region: 'local',
  },

  {
    id: 'faster-whisper',
    name: 'Faster-Whisper (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8000',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['audio_stt'],
    models: [],  // Loaded at startup
    streaming: false,
    toolCalling: false,
    envKey: 'FASTER_WHISPER_BASE_URL',
    description: 'Local ASR. CTranslate2-optimized Whisper. Fast transcription.',
    region: 'local',
  },

  {
    id: 'ultralytics',
    name: 'Ultralytics (Local)',
    category: 'local',
    baseUrl: 'http://localhost:8080',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['vision'],
    models: [],  // Loaded at startup
    streaming: false,
    toolCalling: false,
    envKey: 'ULTRALYTICS_BASE_URL',
    description: 'Local vision. YOLO detection, segmentation, classification.',
    region: 'local',
  },

  // ═══════════════════════════════════════════════════════════
  // FREE-TIER PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    category: 'hosting',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'meta/llama-3.1-8b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'meta/llama-3.1-70b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'deepseek-ai/deepseek-r1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'qwen/qwen2.5-coder-32b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'google/gemma-2-27b-it', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'llama-4-maverick-17b-128e-instruct', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 60, rpd: 5000, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'mistral-large-3', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['reasoning', 'coding'], freeTier: { rateLimits: { rpm: 60, rpd: 5000, tpm: 1000000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NVIDIA_API_KEY',
    description: 'NVIDIA NIM free models. DeepSeek R1, Llama 3.1, Nemotron Ultra.',
    region: 'global',
    signupUrl: 'https://build.nvidia.com/',
  },

  {
    id: 'gitlawb',
    name: 'GitLawb OpenGateway',
    category: 'hosting',
    baseUrl: 'https://opengateway.gitlawb.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      // Free on the gateway (verified 200 with a live key).
      { id: 'inclusionai/ling-3.0-flash:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['fast', 'general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'mindai/macaron-v1-tall', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      // Served, but billed — a keyless call returns 402 "Insufficient credits".
      // No freeTier, so free-tier routing skips them.
      { id: 'tencent/hy3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'coding'] },
      { id: 'xiaomi/mimo-v2.5-pro', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
      { id: 'xiaomi/mimo-v2.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.2, outputCostPer1M: 0.6, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
      { id: 'google/gemini-3.1-flash-lite', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0.075, outputCostPer1M: 0.3, capabilities: ['streaming', 'tool_use'], specializations: ['fast', 'cheap'] },
      { id: 'minimax/minimax-m3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
      { id: 'qwen/qwen3.7-max', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'coding'] },
      { id: 'moonshotai/kimi-k3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'coding'] },
      { id: 'z-ai/glm-5.2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'coding'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GITLAWB_API_KEY',
    description: 'GitLawb OpenGateway, an OpenAI-compatible aggregator. Three free models (Ling 3.0 Flash, Macaron v1, Nemotron 3 Ultra); the rest need credits.',
    region: 'global',
    signupUrl: 'https://opengateway.gitlawb.com',
  },

  {
    id: 'github-models',
    name: 'GitHub Models',
    category: 'hosting',
    baseUrl: 'https://models.inference.ai.azure.com',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'gpt-4o-mini', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'gpt-4.1', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'gpt-4.1-mini', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['fast', 'general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'Llama-3.3-70B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'Phi-4', modalities: ['llm'], contextWindow: 16000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'Mistral-Nemo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'DeepSeek-R1', modalities: ['llm'], contextWindow: 64000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 1, rpd: 8, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'gpt-5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 10, speedRank: 7 } },
      { id: 'gpt-5-mini', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['fast', 'general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'gpt-5-nano', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 10 } },
      { id: 'o3', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning', 'architecture'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 10, speedRank: 6 } },
      { id: 'o3-mini', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'o4-mini', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'tool_use', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'DeepSeek-R1-0528', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'DeepSeek-V3-0324', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'coding'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'Llama-4-Maverick-17B-128E-Instruct-FP8', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'Llama-4-Scout-17B-16E-Instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'Phi-4-mini-instruct', modalities: ['llm'], contextWindow: 16000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 10 } },
      { id: 'Phi-4-reasoning', modalities: ['llm'], contextWindow: 16000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'Mistral-Medium-3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'Mistral-Small-3.1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'Codestral-25.01', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'Cohere-embed-v3-english', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'], freeTier: { rateLimits: { rpm: 15, rpd: 150, tpm: 8000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 0, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GITHUB_TOKEN',
    description: 'GitHub Models. GPT-4o, Llama 3.3, DeepSeek R1. Rate-limited free.',
    region: 'global',
    signupUrl: 'https://github.com/settings/tokens',
    oauthConfig: {
      flow: 'authorization_code',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientIdEnvKey: 'GITHUB_OAUTH_CLIENT_ID',
      clientSecretEnvKey: 'GITHUB_OAUTH_CLIENT_SECRET',
      scopes: ['models:read'],
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_refresh',
    },
  },

  {
    id: 'cloudflare-ai',
    name: 'Cloudflare Workers AI',
    category: 'hosting',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'diffusion', 'audio_stt'],
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 8 } },
      { id: '@cf/meta/llama-4-scout-17b-16e-instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 8 } },
      { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 7 } },
      { id: '@cf/qwen/qwen3-30b-a3b', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 8 } },
      { id: '@cf/ibm-granite/granite-4.0-micro', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 5, speedRank: 10 } },
      { id: '@cf/moonshotai/kimi-k2.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 8 } },
      { id: '@cf/moonshotai/kimi-k2.6', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 8 } },
      { id: '@cf/openai/gpt-oss-120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 7 } },
      { id: '@cf/openai/gpt-oss-20b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 6, speedRank: 9 } },
      { id: '@cf/aisingapore/gemma-sea-lion-v4-27b-it', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 8 } },
      { id: '@cf/zai-org/glm-4.7-flash', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 9 } },
      { id: '@cf/zai-org/glm-5.2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 7 } },
      { id: '@cf/moonshotai/kimi-k2.7-code', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 8, speedRank: 7 } },
      { id: '@cf/google/gemma-4-26b-a4b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 9 } },
      { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 10000, intelligenceRank: 7, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'CLOUDFLARE_ACCOUNT_ID',
    description: 'Cloudflare Workers AI. 10K neurons/day free. 11 models. Edge inference.',
    region: 'global',
    signupUrl: 'https://dash.cloudflare.com/',
  },

  {
    id: 'zhipu',
    name: 'Zhipu (Z.ai)',
    category: 'cloud_llm',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'video'],
    models: [
      { id: 'glm-4.5-flash', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'glm-4.7-flash', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 5, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'glm-4.6v-flash', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'vision'], specializations: ['fast', 'multimodal'], freeTier: { rateLimits: { rpm: 1, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'glm-4-plus', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 5, outputCostPer1M: 5, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'glm-5', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 5, outputCostPer1M: 15, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning'] },
      { id: 'glm-5-turbo', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 1.5, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast'] },
      { id: 'cogvideox-flash', modalities: ['video'], capabilities: ['text2video'], specializations: ['creative'] },
      { id: 'embedding-3', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'ZHIPU_API_KEY',
    description: 'Zhipu GLM. GLM-4.5/4.7 Flash free. Video gen. 100M tok/month.',
    region: 'cn',
    signupUrl: 'https://open.bigmodel.cn/',
  },

  {
    id: 'openrouter-free',
    name: 'OpenRouter (Free)',
    category: 'hosting',
    baseUrl: 'https://openrouter.ai/api/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'qwen/qwen3-coder', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 }, sharedPool: { rpm: 20, rpd: 1000 } },
      { id: 'minimax/minimax-m2.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'thudm/glm-4.7', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'openai/gpt-oss-20b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'deepseek/deepseek-v4-flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 9 } },
      { id: 'google/gemma-4-26b-a4b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'google/gemma-4-31b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'qwen/qwen3-next-80b-a3b-instruct', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'nvidia/nemotron-3-super-120b-a12b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'openai/gpt-oss-120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'poolside/laguna-m.1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'arcee-ai/trinity-large-thinking', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'liquid/lfm-2.5-1.2b-instruct', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 4, speedRank: 10 } },
      { id: 'z-ai/glm-4.5-air', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'baidu/cobuddy', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 7 } },
      { id: 'mistralai/mistral-nemo-12b-instruct:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'meta-llama/llama-3.1-8b-instruct:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 5, speedRank: 10 } },
      { id: 'huggingfaceh4/zephyr-7b-beta:free', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 5, speedRank: 10 } },
      { id: 'nousresearch/hermes-3-llama-3.1-405b:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 6 } },
      { id: 'hermes-3-llama-3.1-405b:free', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'reasoning'], freeTier: { rateLimits: { rpm: 3, rpd: 200, tpm: 50000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 5 } },
      { id: 'nvidia/nemotron-nano-12b-v2-vl:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'vision'], specializations: ['fast', 'multimodal'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 8 } },
      { id: 'nvidia/nemotron-nano-9b-v2:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 9 } },
      { id: 'nvidia/nemotron-3-nano-30b-a3b:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 7 } },
      { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 6 } },
      { id: 'meta-llama/llama-3.2-3b-instruct:free', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 2000, tpm: 200000, tpd: 20000000 }, monthlyTokenBudget: 0, intelligenceRank: 4, speedRank: 9 } },
      { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 200, tpm: 50000, tpd: 2000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 7 } },
      { id: 'liquid/lfm-2.5-1.2b-thinking:free', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['reasoning', 'fast'], freeTier: { rateLimits: { rpm: 20, rpd: 1000, tpm: 200000, tpd: 10000000 }, monthlyTokenBudget: 0, intelligenceRank: 4, speedRank: 9 } },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      { id: 'nvidia/nemotron-3.5-content-safety:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['content_safety'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 8 } },
      { id: 'cohere/north-mini-code:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'poolside/laguna-xs-2.1:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 8 } },
      { id: 'poolside/laguna-xs.2:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 6, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'OPENROUTER_API_KEY',
    description: 'OpenRouter free models. 25+ free-tier models including GPT-OSS, Gemma 4, Qwen3, DeepSeek V4, Hermes 405B.',
    region: 'global',
    signupUrl: 'https://openrouter.ai/keys',
  },

  {
    id: 'pollinations',
    name: 'Pollinations',
    category: 'hosting',
    baseUrl: 'https://text.pollinations.ai/openai',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'openai-fast', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'reasoning'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'mistral-large', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'flux', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: '',
    description: 'Pollinations free AI gateway. No API key needed. Models discovered live from /v1/models.',
    region: 'global',
  },

  {
    id: 'pollinations-images',
    name: 'Pollinations Images',
    category: 'cloud_diffusion',
    baseUrl: 'https://image.pollinations.ai',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['diffusion'],
    models: [
      { id: 'flux', modalities: ['diffusion'], costPerImage: 0, capabilities: ['text2img'], specializations: ['creative'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'flux-realism', modalities: ['diffusion'], costPerImage: 0, capabilities: ['text2img'], specializations: ['creative'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'any-dark', modalities: ['diffusion'], costPerImage: 0, capabilities: ['text2img'], specializations: ['creative'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'flux-anime', modalities: ['diffusion'], costPerImage: 0, capabilities: ['text2img'], specializations: ['creative'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'flux-3d', modalities: ['diffusion'], costPerImage: 0, capabilities: ['text2img'], specializations: ['creative'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    envKey: '',
    streaming: false,
    toolCalling: false,
    description: 'Pollinations free image generation. No API key needed.',
    region: 'global',
  },

  {
    id: 'llm7',
    name: 'LLM7',
    category: 'hosting',
    baseUrl: 'https://api.llm7.io/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'gpt-4o-mini', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'claude-3.5-sonnet', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'deepseek-v3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'LLM7_API_KEY',
    description: 'LLM7 free gateway. Premium models (GPT-4o, Claude). Token limits apply.',
    region: 'global',
    signupUrl: 'https://llm7.io/',
  },

  {
    id: 'kilo-gateway',
    name: 'Kilo Gateway',
    category: 'hosting',
    baseUrl: 'https://api.kilolabs.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'deepseek/deepseek-chat-v3-0324', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'qwen/qwen3-235b-a22b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      { id: 'google/gemini-2.5-flash-preview', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'KILO_API_KEY',
    description: 'Kilo Gateway. DeepSeek V3, Qwen3, Gemini. 10 RPM free.',
    region: 'global',
    signupUrl: 'https://kilocg.ai/',
  },

  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    category: 'hosting',
    baseUrl: 'https://ollama.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-oss:120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'kimi-k2.6', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'deepseek-v4-flash', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'glm-5.2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'qwen3-coder:480b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['code'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      { id: 'devstral-2:123b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['code'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'OLLAMA_CLOUD_API_KEY',
    description: 'Ollama Cloud. GPT-OSS 120B, Kimi K2.6, DeepSeek V4 Flash. Free tier.',
    region: 'global',
    signupUrl: 'https://ollama.com/',
  },

  {
    id: 'novita',
    name: 'Novita AI',
    category: 'hosting',
    baseUrl: 'https://api.novita.ai/v3/openai',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'meta-llama/llama-3.1-8b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'deepseek/deepseek-r1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'NOVITA_API_KEY',
    description: 'Novita AI. Free Llama 8B + DeepSeek R1.',
    region: 'us',
    signupUrl: 'https://novita.ai/',
  },

  {
    id: 'nlpcloud',
    name: 'NLP Cloud',
    category: 'cloud_llm',
    baseUrl: 'https://api.nlpcloud.io/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'python-coder', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'NLPCLOUD_API_KEY',
    description: 'NLP Cloud. Python Coder free. Multilingual.',
    region: 'us',
    signupUrl: 'https://nlpcloud.com/',
  },

  {
    id: 'alibaba-cloud',
    name: 'Alibaba Cloud (Qwen)',
    category: 'cloud_llm',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'qwen-plus', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.4, outputCostPer1M: 1.2, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'qwen-turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 9 } },
      { id: 'qwen3-max', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 2.4, outputCostPer1M: 9.6, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['reasoning', 'coding'] },
      { id: 'qwen3-plus', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.4, outputCostPer1M: 1.2, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['general'] },
      { id: 'qwen3-turbo', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.06, outputCostPer1M: 0.24, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast', 'cheap'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: 'Alibaba Cloud Qwen. Turbo ~1M tok/day free.',
    region: 'cn',
    signupUrl: 'https://dashscope.console.aliyun.com/',
  },

  {
    id: 'antigravity',
    name: 'Antigravity (Google Cloud Code)',
    category: 'cloud_llm',
    baseUrl: 'https://cloudcode-pa.googleapis.com',
    authMethod: 'bearer',
    apiFormat: 'custom', // Uses Cloud Code protocol, not standard OpenAI/Anthropic
    modalities: ['llm'],
    models: [
      {
        id: 'antigravity/gemini-2.5-flash',
        modalities: ['llm'],
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        capabilities: ['streaming', 'tool_use', 'vision'],
        specializations: ['coding', 'agentic'],
        pricingTier: 'free',
        freeTier: {
          rateLimits: { rpm: 10, rpd: 50, tpm: 100000, tpd: 500000 },
          monthlyTokenBudget: 10000000,
          intelligenceRank: 8,
          speedRank: 7,
        },
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: '',
    description: 'Google Antigravity (agy) - Free AI coding agent using Cloud Code protocol. Integrates as an agentic coding tool via the Cloud Code wire format. Requires Google OAuth authentication.',
    region: 'global',
    signupUrl: 'https://cloud.google.com/code',
  },

  {
    id: 'codestral-free',
    name: 'Mistral Codestral (Free)',
    category: 'cloud_llm',
    baseUrl: 'https://codestral.mistral.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'codestral-latest', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 30, rpd: 2000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'CODESTRAL_API_KEY',
    description: 'Free Codestral endpoint. Code-focused. 30 RPM, 2000 RPD.',
    region: 'global',
    signupUrl: 'https://console.mistral.ai/',
  },

  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    category: 'hosting',
    baseUrl: 'https://opencode.ai/zen/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'mimo-v2.5-free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'deepseek-v4-flash-free', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 9 } },
      { id: 'nemotron-3-ultra-free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 9, speedRank: 6 } },
      { id: 'north-mini-code-free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'ling-3.0-flash-free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 9 } },
      { id: 'laguna-s-2.1-free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 9 } },
    ],
    streaming: true,
    // Every free Zen model returned a real tool_calls payload when probed.
    toolCalling: true,
    envKey: 'OPENCODE_ZEN_API_KEY',
    description: 'OpenCode Zen free gateway. Curated models including DeepSeek V4 Flash Free, MiMo-V2.5 Free, Nemotron 3 Super Free.',
    region: 'global',
    signupUrl: 'https://opencode.ai/',
  },

  {
    id: 'qwen-dashscope',
    name: 'Qwen (DashScope)',
    category: 'cloud_llm',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'qwen-max', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 500, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'qwen-turbo', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 20, rpd: 500, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 9 } },
      { id: 'qwen-coder', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['bulk_generation', 'backend_logic'], freeTier: { rateLimits: { rpm: 20, rpd: 500, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: 'Qwen DashScope. ~1M tok/day free turbo. Qwen Max, Turbo, Coder.',
    region: 'cn',
    signupUrl: 'https://dashscope.console.aliyun.com/',
  },

  {
    id: 'modal',
    name: 'Modal',
    category: 'hosting',
    baseUrl: 'https://modal.run/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'any-model', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'MODAL_API_KEY',
    description: 'Modal GPU compute. $30/month free. Run any self-hosted model on A100/H100.',
    region: 'us',
    signupUrl: 'https://modal.com/',
  },

  {
    id: 'cartesia',
    name: 'Cartesia',
    category: 'cloud_audio',
    baseUrl: 'https://api.cartesia.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_tts'],
    models: [
      { id: 'sonic', modalities: ['audio_tts'], capabilities: ['tts'], specializations: ['audio', 'fast'], freeTier: { rateLimits: { rpm: 5, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 0, speedRank: 9 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'CARTESIA_API_KEY',
    description: 'Cartesia real-time TTS. 10K chars/month free. ~50ms latency.',
    region: 'us',
    signupUrl: 'https://play.cartesia.ai/',
  },

  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'cloud_llm',
    baseUrl: 'https://api.perplexity.ai',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'sonar', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'sonar-pro', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'PERPLEXITY_API_KEY',
    description: 'Perplexity. Search-augmented generation (sonar). ~$5 signup credit.',
    region: 'global',
    signupUrl: 'https://www.perplexity.ai/settings/api',
  },

  {
    id: 'yandex',
    name: 'Yandex',
    category: 'cloud_llm',
    baseUrl: 'https://llm.api.cloud.yandex.net/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'yandexgpt-lite', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0.2, outputCostPer1M: 0.2, capabilities: ['streaming'], specializations: ['fast', 'cheap'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'YANDEX_API_KEY',
    description: 'Yandex GPT. Russian-language focused. $1 trial credit.',
    region: 'us',
    signupUrl: 'https://console.cloud.yandex.com/',
  },

  {
    id: 'upstage',
    name: 'Upstage',
    category: 'cloud_llm',
    baseUrl: 'https://api.upstage.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'solar-1-mini-chat', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'UPSTAGE_API_KEY',
    description: 'Upstage Solar. Free Solar 1 Mini Chat.',
    region: 'kr',
    signupUrl: 'https://console.upstage.ai/',
  },

  {
    id: 'vercel-ai',
    name: 'Vercel AI',
    category: 'hosting',
    baseUrl: 'https://api.vercel.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'v0', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['ui_design', 'ui_component'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'VERCEL_AI_API_KEY',
    description: 'Vercel AI Gateway. v0 free tier. Frontend-focused.',
    region: 'global',
    signupUrl: 'https://vercel.com/',
  },

  {
    id: 'inference',
    name: 'Inference.net',
    category: 'hosting',
    baseUrl: 'https://api.inference.net/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'llama-3.3-70b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'INFERENCE_API_KEY',
    description: 'Inference.net. Llama 3.3 70B free. Usage limits.',
    region: 'us',
    signupUrl: 'https://inference.net/',
  },

  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'cloud_llm',
    baseUrl: 'https://api.minimaxi.chat/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'video'],
    models: [
      { id: 'MiniMax-Text-01', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0.2, outputCostPer1M: 0.2, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'MiniMax-M1', modalities: ['llm'], contextWindow: 1000000, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 2, capabilities: ['streaming', 'tool_use'], specializations: ['reasoning'] },
      // Video generation (Hailuo)
      { id: 'MiniMax-Hailuo-2.3', modalities: ['video'], capabilities: ['text2video', 'img2video', 'first_last_frame'], specializations: ['creative'] },
      { id: 'MiniMax-Hailuo-2.3-fast', modalities: ['video'], capabilities: ['text2video', 'img2video'], specializations: ['creative', 'fast'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'MINIMAX_API_KEY',
    description: 'MiniMax. 200K context. Music gen. $5 free credits.',
    region: 'us',
    signupUrl: 'https://platform.minimaxi.com/',
    oauthConfig: {
      flow: 'client_credentials',
      tokenUrl: 'https://api.minimaxi.chat/oauth/token',
      clientIdEnvKey: 'MINIMAX_OAUTH_CLIENT_ID',
      clientSecretEnvKey: 'MINIMAX_OAUTH_CLIENT_SECRET',
      scopes: [],
      redirectPath: '/v1/admin/providers/:id/oauth/callback',
      tokenResponseType: 'access_token',
    },
  },

  {
    id: 'sarvam',
    name: 'Sarvam AI',
    category: 'cloud_llm',
    baseUrl: 'https://api.sarvam.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'sarvam-2b', modalities: ['llm'], contextWindow: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 4, speedRank: 10 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'SARVAM_API_KEY',
    description: 'Sarvam AI. Indic language support. Free 2B model.',
    region: 'in',
    signupUrl: 'https://dashboard.sarvam.ai/',
  },

  {
    id: 'baidu',
    name: 'Baidu (ERNIE)',
    category: 'cloud_llm',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'ernie-4.0-turbo-8k', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'ernie-4.5-8k-preview', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'ernie-x1-turbo-32k', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'ernie-speed', modalities: ['llm'], contextWindow: 8192, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 9 } },
      { id: 'ernie-lite', modalities: ['llm'], contextWindow: 8192, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 4, speedRank: 9 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'BAIDU_API_KEY',
    description: 'Baidu ERNIE. Free tiers for ERNIE 4.0, 4.5, X1.',
    region: 'cn',
    signupUrl: 'https://console.bce.baidu.com/',
  },

  {
    id: 'iflytek',
    name: 'iFlytek (Spark)',
    category: 'cloud_llm',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'generalv3.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'spark-max', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 8192, inputCostPer1M: 2, outputCostPer1M: 6, capabilities: ['streaming', 'tool_use'], specializations: ['reasoning'] },
      { id: 'spark-lite', modalities: ['llm'], contextWindow: 8192, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 9 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'IFLYTEK_API_KEY',
    description: 'iFlytek Spark. Spark Max free tier. Voice synthesis.',
    region: 'cn',
    signupUrl: 'https://xinghuo.xfyun.cn/',
  },

  {
    id: 'baichuan',
    name: 'Baichuan',
    category: 'cloud_llm',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'Baichuan4', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'baichuan4', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1, outputCostPer1M: 3, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
      { id: 'baichuan3-turbo', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'BAICHUAN_API_KEY',
    description: 'Baichuan. Baichuan 4 free tier. Search-augmented.',
    region: 'cn',
    signupUrl: 'https://platform.baichuan-ai.com/',
  },

  {
    id: 'yi',
    name: 'Yi (01.AI)',
    category: 'cloud_llm',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'yi-lightning', modalities: ['llm'], contextWindow: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'yi-large', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0.6, outputCostPer1M: 0.6, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'YI_API_KEY',
    description: 'Yi Lightning. Free tier available.',
    region: 'cn',
    signupUrl: 'https://platform.lingyiwanwu.com/',
  },

  {
    id: 'tencent',
    name: 'Tencent (Hunyuan)',
    category: 'cloud_llm',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'hunyuan-turbos-latest', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'hunyuan-pro', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1.5, outputCostPer1M: 6, capabilities: ['streaming', 'tool_use'], specializations: ['reasoning'] },
      { id: 'hunyuan-lite', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'TENCENT_API_KEY',
    description: 'Tencent Hunyuan. Free monthly tokens.',
    region: 'cn',
    signupUrl: 'https://console.cloud.tencent.com/',
  },

  {
    id: 'ai21',
    name: 'AI21 Labs',
    category: 'cloud_llm',
    baseUrl: 'https://api.ai21.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'jamba-1.5-mini', modalities: ['llm'], contextWindow: 256000, inputCostPer1M: 0.2, outputCostPer1M: 0.4, capabilities: ['streaming'], specializations: ['fast', 'cheap'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'AI21_API_KEY',
    description: 'AI21 Jamba. 256K context. $10 free credits.',
    region: 'us',
    signupUrl: 'https://studio.ai21.com/',
  },

  {
    id: 'coze',
    name: 'Coze',
    category: 'hosting',
    baseUrl: 'https://api.coze.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'coze-bot', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'COZE_API_KEY',
    description: 'Coze (ByteDance). Bot platform. Free tier with limits.',
    region: 'us',
    signupUrl: 'https://www.coze.com/',
  },

  {
    id: 'together',
    name: 'Together AI',
    category: 'hosting',
    baseUrl: 'https://api.together.xyz/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'audio_stt', 'reranking'],
    models: [
      // Llama 4
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.27, outputCostPer1M: 0.85, capabilities: ['tool_use', 'streaming', 'vision'], specializations: ['general'] },
      { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.18, outputCostPer1M: 0.59, capabilities: ['tool_use', 'streaming', 'vision'], specializations: ['general'] },
      // Llama 3.3
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.88, outputCostPer1M: 0.88, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      // Llama 3.1
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 3.5, outputCostPer1M: 3.5, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning', 'general'] },
      { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.88, outputCostPer1M: 0.88, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0.18, outputCostPer1M: 0.18, capabilities: ['streaming'], specializations: ['fast', 'cheap'] },
      // DeepSeek
      { id: 'deepseek-ai/DeepSeek-R1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 3, outputCostPer1M: 7, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'] },
      { id: 'deepseek-ai/DeepSeek-V3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 1.25, outputCostPer1M: 1.25, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'coding'] },
      // Qwen
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 1.2, outputCostPer1M: 1.2, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'coding'] },
      { id: 'Qwen/Qwen2.5-7B-Instruct-Turbo', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0.3, outputCostPer1M: 0.3, capabilities: ['streaming'], specializations: ['fast', 'cheap'] },
      // Mixtral
      { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', modalities: ['llm'], contextWindow: 65536, inputCostPer1M: 1.2, outputCostPer1M: 1.2, capabilities: ['tool_use', 'streaming'], specializations: ['general'] },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0.6, outputCostPer1M: 0.6, capabilities: ['streaming'], specializations: ['fast'] },
      // Gemma
      { id: 'google/gemma-2-27b-it', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0.3, outputCostPer1M: 0.3, capabilities: ['streaming'], specializations: ['fast', 'cheap'] },
      // Embeddings
      { id: 'togethercomputer/m2-bert-80M-32k-retrieval', modalities: ['embedding'], contextWindow: 32768, inputCostPer1M: 0.008, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'] },
      { id: 'intfloat/multilingual-e5-large-instruct', modalities: ['embedding'], contextWindow: 512, inputCostPer1M: 0.002, outputCostPer1M: 0, capabilities: ['embedding', 'multilingual'], specializations: ['embedding'] },
      // Reranking
      { id: 'Salesforce/LlamaRank-v1', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking'] },
      { id: 'togethercomputer/m2-bert-80M-32k-retrieval', modalities: ['reranking'], capabilities: ['reranking'], specializations: ['reranking'] },
      // Whisper
      { id: 'openai/whisper-large-v3', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio'] },
      // Free-tier models (limited rate, no cost)
      { id: 'together-free/Qwen2.5-72B-Instruct-Turbo', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'free'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 100000, tpd: 0 }, monthlyTokenBudget: 10000000, intelligenceRank: 7, speedRank: 6 } },
      { id: 'together-free/DeepSeek-R1', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming', 'reasoning'], specializations: ['reasoning', 'free'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 5000000, intelligenceRank: 8, speedRank: 4 } },
      { id: 'together-free/Meta-Llama-3.3-70B-Instruct-Turbo', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'free'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 100000, tpd: 0 }, monthlyTokenBudget: 10000000, intelligenceRank: 7, speedRank: 7 } },
      { id: 'together-free/Mixtral-8x22B-Instruct-v0.1', modalities: ['llm'], contextWindow: 65536, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general', 'free'], freeTier: { rateLimits: { rpm: 20, rpd: 500, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 5000000, intelligenceRank: 6, speedRank: 5 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'TOGETHER_API_KEY',
    description: 'Together AI. $1 free credits. Fast open-source inference. 200+ models.',
    region: 'us',
    signupUrl: 'https://api.together.xyz/',
  },

  // ═══════════════════════════════════════════════════════════
  // ADDITIONAL FREE-TIER PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'groq',
    name: 'Groq',
    category: 'hosting',
    baseUrl: 'https://api.groq.com/openai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'audio_stt'],
    models: [
      { id: 'llama-3.1-8b-instant', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 14400, tpm: 6000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 10 } },
      { id: 'llama-3.3-70b-versatile', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 12000, tpd: 100000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 30000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'qwen/qwen3-32b', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 60, rpd: 1000, tpm: 6000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'openai/gpt-oss-120b', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'openai/gpt-oss-20b', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'moonshotai/kimi-k2-instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 60, rpd: 1000, tpm: 10000, tpd: 300000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'openai/gpt-oss-safeguard-20b', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'qwen/qwen3.6-27b', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'groq/compound', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 250, tpm: 70000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'groq/compound-mini', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 250, tpm: 70000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'whisper-large-v3', modalities: ['audio_stt'], capabilities: ['stt'], specializations: ['audio'], freeTier: { rateLimits: { rpm: 20, rpd: 2000, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 0, speedRank: 9 } },
      { id: 'gemma2-9b-it', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 30, rpd: 14400, tpm: 15000, tpd: 500000 }, monthlyTokenBudget: 15000000, intelligenceRank: 6, speedRank: 9 } },
      { id: 'allam-2-7b', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 7000, tpm: 6000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 10 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'GROQ_API_KEY',
    description: 'Groq. Ultra-fast LPU inference. 30 RPM free. Verified rate limits.',
    region: 'us',
    signupUrl: 'https://console.groq.com/',
  },

  {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'hosting',
    baseUrl: 'https://api.cerebras.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'llama-3.1-8b', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 0, tpm: 60000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 10 } },
      { id: 'gpt-oss-120b', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 0, tpm: 30000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'zai-glm-4.7', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 0, tpm: 30000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'CEREBRAS_API_KEY',
    description: 'Cerebras. Wafer-scale inference. 1M tokens/day free, 30 RPM.',
    region: 'us',
    signupUrl: 'https://cloud.cerebras.ai/',
  },

  {
    id: 'sambanova',
    name: 'SambaNova',
    category: 'hosting',
    baseUrl: 'https://api.sambanova.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'Meta-Llama-3.3-70B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 80, rpd: 1600, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'DeepSeek-R1', modalities: ['llm'], contextWindow: 32000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'DeepSeek-V3.1', modalities: ['llm'], contextWindow: 100000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'Llama-4-Maverick-17B-128E-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'Qwen2.5-72B-Instruct', modalities: ['llm'], contextWindow: 32000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 200, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'gemma-4-31B-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 20, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'DeepSeek-V3.2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 20, rpd: 20, tpm: 0, tpd: 200000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'SAMBANOVA_API_KEY',
    description: 'SambaNova. RDU-accelerated inference. Verified: 80 RPM Llama, 20 RPM others, 200K TPD.',
    region: 'us',
    signupUrl: 'https://cloud.sambanova.ai/',
  },

  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: 'hosting',
    baseUrl: 'https://api.siliconflow.cn/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'deepseek-ai/DeepSeek-V4-Flash', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 9 } },
      { id: 'Qwen/Qwen3-32B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'zai-org/GLM-4.5-Air', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 9 } },
      { id: 'moonshotai/Kimi-K2.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'MiniMaxAI/MiniMax-M2.5', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 1000, rpd: 0, tpm: 50000, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'SILICONFLOW_API_KEY',
    description: 'SiliconFlow. 200+ models, free tier. DeepSeek V4, Qwen3, GLM, Kimi.',
    region: 'cn',
    signupUrl: 'https://cloud.siliconflow.cn/',
  },

  {
    id: 'kluster',
    name: 'Kluster AI',
    category: 'hosting',
    baseUrl: 'https://api.kluster.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'deepseek-ai/DeepSeek-R1-0528', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'deepseek-ai/DeepSeek-V3-0324', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'google/gemma-3-27b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'KLUSTER_API_KEY',
    description: 'Kluster AI. Free DeepSeek R1, Llama 4, Qwen3. High-throughput inference.',
    region: 'us',
    signupUrl: 'https://kluster.ai/',
  },

  {
    id: 'nous-portal',
    name: 'Nous Portal',
    category: 'hosting',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'NousResearch/Hermes-4-70B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0.05, outputCostPer1M: 0.2, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'NousResearch/Hermes-4-405B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0.09, outputCostPer1M: 0.37, capabilities: ['tool_use', 'streaming'], specializations: ['reasoning', 'general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      { id: 'anthropic/claude-sonnet-4.6', modalities: ['llm'], contextWindow: 200000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'google/gemini-2.5-pro', modalities: ['llm'], contextWindow: 1000000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 8 } },
      { id: 'deepseek/deepseek-v4-pro', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'qwen/qwen3.7-max', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NOUS_PORTAL_API_KEY',
    description: 'Nous Portal. Subscription gateway to 300+ models via OpenRouter. Hermes 4 native. Free tier with limited models.',
    region: 'global',
    signupUrl: 'https://nousportal.com/',
  },

  // ═══════════════════════════════════════════════════════════
  // NEW HIGH-PRIORITY PROVIDERS
  // ═══════════════════════════════════════════════════════════

  {
    id: 'featherless',
    name: 'Featherless AI',
    category: 'hosting',
    baseUrl: 'https://api.featherless.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general', 'reasoning'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 6 } },
      { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'deepseek-ai/DeepSeek-V3', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['coding', 'reasoning'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'FEATHERLESS_API_KEY',
    description: '4000+ open-source models, serverless inference',
    region: 'global',
    signupUrl: 'https://featherless.ai/',
  },

  {
    id: 'fal-ai',
    name: 'FAL.ai',
    category: 'cloud_diffusion',
    baseUrl: 'https://fal.run/fal-ai',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['diffusion', 'video'],
    models: [
      { id: 'fal-ai/flux/schnell', modalities: ['diffusion'], costPerImage: 0.003, capabilities: ['text2img'], specializations: ['image_generation'] },
      { id: 'fal-ai/flux/dev', modalities: ['diffusion'], costPerImage: 0.025, capabilities: ['text2img'], specializations: ['image_generation'] },
      { id: 'fal-ai/flux-pro/v1.1', modalities: ['diffusion'], costPerImage: 0.05, capabilities: ['text2img'], specializations: ['image_generation'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'FAL_API_KEY',
    description: 'Fast FLUX/SDXL/video inference with serverless GPUs',
    region: 'global',
    signupUrl: 'https://fal.ai/dashboard/keys',
  },

  {
    id: 'nomic',
    name: 'Nomic AI',
    category: 'cloud_embedding',
    baseUrl: 'https://api-atlas.nomic.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['embedding'],
    models: [
      { id: 'nomic-embed-text-v1.5', modalities: ['embedding'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'], freeTier: { rateLimits: { rpm: 100, rpd: 50000, tpm: 1000000, tpd: 100000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'nomic-embed-text-v2-moe', modalities: ['embedding'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'], freeTier: { rateLimits: { rpm: 100, rpd: 50000, tpm: 1000000, tpd: 100000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'NOMIC_API_KEY',
    description: 'Free open-source embeddings, OpenAI-compatible',
    region: 'global',
    signupUrl: 'https://atlas.nomic.ai/',
  },

  {
    id: 'bytedance',
    name: 'ByteDance (Doubao)',
    category: 'cloud_llm',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'doubao-1.5-pro', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.4, outputCostPer1M: 2, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['reasoning'] },
      { id: 'doubao-1.5-lite', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 60, rpd: 10000, tpm: 500000, tpd: 50000000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'seed-1.5', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 1, outputCostPer1M: 4, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning', 'multimodal'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'BYTEDANCE_API_KEY',
    description: 'ByteDance Doubao/Seed models via Volcano Engine',
    region: 'cn',
    signupUrl: 'https://console.volcengine.com/ark',
  },

  {
    id: 'databricks',
    name: 'Databricks',
    category: 'hosting',
    baseUrl: 'https://adb-xxx.azuredatabricks.net/serving-endpoints',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'databricks-meta-llama-3.1-70b-instruct', modalities: ['llm'], contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 1, outputCostPer1M: 3, capabilities: ['streaming', 'tool_use'], specializations: ['general'] },
      { id: 'databricks-dbrx-instruct', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1.5, outputCostPer1M: 4.5, capabilities: ['streaming', 'tool_use'], specializations: ['reasoning'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DATABRICKS_TOKEN',
    description: 'DBRX and hosted models on Databricks Lakehouse',
    region: 'global',
    signupUrl: 'https://www.databricks.com/try-databricks',
  },

  {
    id: 'aleph-alpha',
    name: 'Aleph Alpha',
    category: 'cloud_llm',
    baseUrl: 'https://api.aleph-alpha.com',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['llm', 'embedding'],
    models: [
      { id: 'luminous-base', modalities: ['llm'], contextWindow: 8192, maxOutputTokens: 4096, inputCostPer1M: 3, outputCostPer1M: 9, capabilities: ['streaming'], specializations: ['general'] },
      { id: 'luminous-supreme', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 12, outputCostPer1M: 36, capabilities: ['streaming'], specializations: ['reasoning'] },
      { id: 'luminous-base-embed', modalities: ['embedding'], contextWindow: 8192, inputCostPer1M: 0.03, outputCostPer1M: 0, capabilities: ['embedding'], specializations: ['embedding'] },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'ALEPH_ALPHA_API_KEY',
    description: 'German GDPR-compliant AI, European data sovereignty',
    region: 'eu',
    signupUrl: 'https://aleph-alpha.com/',
  },

  // ═══════════════════════════════════════════════════════════
  // FREE LLM APIs (Community / No Key Required / Grey-Area)
  // These offer free access to GPT-4o, Claude, etc. via shared keys.
  // Reliability varies — use as fallback, not primary.
  // ═══════════════════════════════════════════════════════════

  {
    id: 'zukijourney',
    name: 'zukijourney',
    category: 'hosting',
    baseUrl: 'https://api.zukijourney.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'claude-3-5-sonnet', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['coding', 'general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'ZUKIJOURNEY_API_KEY',
    description: 'Community API, 8000+ users, OpenAI-compatible',
    region: 'global',
    signupUrl: 'https://zukijourney.com/',
  },

  {
    id: 'electronhub',
    name: 'ElectronHub',
    category: 'hosting',
    baseUrl: 'https://api.electronhub.top/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'claude-3-opus', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 3, rpd: 50, tpm: 50000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 5 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'ELECTRONHUB_API_KEY',
    description: 'Community API, 5800+ users, RP-friendly',
    region: 'global',
    signupUrl: 'https://electronhub.top/',
  },

  {
    id: 'voidai',
    name: 'VoidAI',
    category: 'hosting',
    baseUrl: 'https://api.voidai.top/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'VOIDAI_API_KEY',
    description: 'Community API, 2000+ users',
    region: 'global',
    signupUrl: 'https://voidai.top/',
  },

  {
    id: 'nagaai',
    name: 'NagaAI',
    category: 'hosting',
    baseUrl: 'https://api.nagaai.one/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'claude-3-5-sonnet', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['coding', 'general'], freeTier: { rateLimits: { rpm: 3, rpd: 50, tpm: 50000, tpd: 500000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NAGAAI_API_KEY',
    description: 'Community API, 3500+ users, successor to ChimeraGPT',
    region: 'global',
    signupUrl: 'https://nagaai.one/',
  },

  {
    id: 'navyapi',
    name: 'NavyAPI',
    category: 'hosting',
    baseUrl: 'https://api.navyapi.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NAVYAPI_API_KEY',
    description: 'Community API, 1500+ users',
    region: 'global',
    signupUrl: 'https://navyapi.com/',
  },

  {
    id: 'kimetsu',
    name: 'Kimetsu',
    category: 'hosting',
    baseUrl: 'https://api.kimetsu.one/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'KIMETSU_API_KEY',
    description: 'Community API, 2000+ users',
    region: 'global',
    signupUrl: 'https://kimetsu.one/',
  },

  {
    id: 'tokenrouter',
    name: 'TokenRouter',
    category: 'hosting',
    baseUrl: 'https://api.tokenrouter.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    // Seed models only — TokenRouter fronts ~120 models and the rest are picked
    // up by discoverMissingModels() from its /v1/models endpoint on startup.
    // kimi-k3-free is listed first because it is the free tier's workhorse, and
    // claude-fable-5 because TokenRouter is currently the only configured route
    // to an Anthropic model that answers.
    models: [
      { id: 'moonshotai/kimi-k3-free', modalities: ['llm'], contextWindow: 262144, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'reasoning'], specializations: ['general', 'code'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 200000, tpd: 2000000 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'moonshotai/kimi-k3', modalities: ['llm'], contextWindow: 262144, maxOutputTokens: 16384, capabilities: ['streaming', 'tool_use', 'json_mode', 'reasoning'], specializations: ['general', 'code'] },
      { id: 'anthropic/claude-fable-5', modalities: ['llm'], contextWindow: 200000, maxOutputTokens: 64000, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision', 'prompt_caching'], specializations: ['general', 'code'] },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'TOKENROUTER_API_KEY',
    description: 'Aggregator fronting ~120 models; reports prompt-cache and reasoning token counts',
    region: 'global',
    signupUrl: 'https://tokenrouter.com/',
  },

  {
    id: 'helixmind',
    name: 'HelixMind',
    category: 'hosting',
    baseUrl: 'https://api.helixmind.xyz/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'HELIXMIND_API_KEY',
    description: 'Community API, 2600+ users',
    region: 'global',
    signupUrl: 'https://helixmind.xyz/',
  },

  {
    id: 'voltai',
    name: 'VoltAI',
    category: 'hosting',
    baseUrl: 'https://api.voltai.one/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'VOLTAI_API_KEY',
    description: 'Community API, OpenAI-compatible',
    region: 'global',
    signupUrl: 'https://voltai.one/',
  },

  {
    id: 'hcap-ai',
    name: 'hcap.ai',
    category: 'hosting',
    baseUrl: 'https://api.hcap.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'HCAP_API_KEY',
    description: 'Community API, OpenAI-compatible',
    region: 'global',
    signupUrl: 'https://hcap.ai/',
  },

  {
    id: 'webraftai',
    name: 'WebraftAI',
    category: 'hosting',
    baseUrl: 'https://api.webraftai.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'gpt-4o', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use', 'json_mode', 'vision'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 100, tpm: 100000, tpd: 1000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'WEBRAFTAI_API_KEY',
    description: 'Community API, OpenAI-compatible',
    region: 'global',
    signupUrl: 'https://webraftai.com/',
  },

  // Audio Separation providers
  {
    id: 'demucs',
    name: 'Demucs',
    category: 'local',
    baseUrl: 'http://localhost:8000',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['audio_separation'],
    models: [
      { id: 'htdemucs_ft', modalities: ['audio_separation'], capabilities: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'], specializations: ['audio_separation'] },
      { id: 'htdemucs', modalities: ['audio_separation'], capabilities: ['vocals', 'drums', 'bass', 'other'], specializations: ['audio_separation'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: '',
    description: 'Local Demucs audio source separation (Meta)',
  },

  {
    id: 'audioshake',
    name: 'AudioShake',
    category: 'specialized',
    baseUrl: 'https://api.audioshake.com/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_separation'],
    models: [
      { id: 'audioshake-standard', modalities: ['audio_separation'], capabilities: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'], specializations: ['audio_separation'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'AUDIO_SHAKE_API_KEY',
    description: 'Enterprise audio stem separation API',
    signupUrl: 'https://audioshake.com/',
  },

  {
    id: 'stemsplit',
    name: 'StemSplit',
    category: 'specialized',
    baseUrl: 'https://api.stemsplit.com/v1',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['audio_separation'],
    models: [
      { id: 'stemsplit-6stem', modalities: ['audio_separation'], capabilities: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'], specializations: ['audio_separation'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'STEMSPLIT_API_KEY',
    description: 'Cloud audio stem separation',
    signupUrl: 'https://stemsplit.com/',
  },

  // OCR providers
  {
    id: 'tesseract',
    name: 'Tesseract',
    category: 'local',
    baseUrl: 'http://localhost:8000',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['ocr'],
    models: [
      { id: 'tesseract-5', modalities: ['ocr'], capabilities: ['printed-text', 'multilingual'], specializations: ['ocr'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: '',
    description: 'Local Tesseract OCR engine (Open-source)',
  },

  {
    id: 'paddleocr',
    name: 'PaddleOCR',
    category: 'local',
    baseUrl: 'http://localhost:8000',
    authMethod: 'bearer',
    apiFormat: 'custom',
    modalities: ['ocr'],
    models: [
      { id: 'paddleocr', modalities: ['ocr'], capabilities: ['printed-text', 'handwritten', 'structured-output'], specializations: ['ocr'] },
    ],
    streaming: false,
    toolCalling: false,
    envKey: 'HF_TOKEN',
    description: 'Local or HuggingFace PaddleOCR',
  },

  // ═══════════════════════════════════════════════════════════
  // FREE-TIER AGGREGATOR PROVIDERS (from freellmapi)
  // ═══════════════════════════════════════════════════════════

  {
    id: 'agnes',
    name: 'Agnes AI',
    category: 'cloud_llm',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'agnes-pro', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 30, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'agnes-flash', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 30, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'AGNES_API_KEY',
    description: 'Agnes AI (Sapiens AI) proprietary models. Free promotional tier, no card required.',
    region: 'global',
    signupUrl: 'https://platform.agnes-ai.com',
  },

  {
    id: 'reka',
    name: 'Reka',
    category: 'cloud_llm',
    baseUrl: 'https://api.reka.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'reka-flash-3', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'reasoning'], specializations: ['general', 'reasoning'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'reka-edge-2603', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'vision'], specializations: ['multimodal'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'REKA_API_KEY',
    description: 'Reka free tier. Reka Flash 3 (text reasoning), Reka Edge 2603 (multimodal).',
    region: 'us',
    signupUrl: 'https://platform.reka.ai',
  },

  {
    id: 'routeway',
    name: 'Routeway',
    category: 'cloud_llm',
    baseUrl: 'https://api.routeway.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'auto:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 200, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'ROUTEWAY_API_KEY',
    description: 'Routeway free models. OpenAI-compatible aggregator with :free routes.',
    region: 'global',
    signupUrl: 'https://routeway.ai',
  },

  {
    id: 'bazaarlink',
    name: 'BazaarLink',
    category: 'cloud_llm',
    baseUrl: 'https://bazaarlink.ai/api/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'auto:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'BAZAARLINK_API_KEY',
    description: 'BazaarLink free tier. auto:free route picks zero-cost models.',
    region: 'global',
    signupUrl: 'https://bazaarlink.ai',
  },

  {
    id: 'ainative',
    name: 'AINative Studio',
    category: 'cloud_llm',
    baseUrl: 'https://api.ainative.studio/api/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'any-model', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 500, tpm: 100000, tpd: 5000000 }, monthlyTokenBudget: 10000000, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'AINATIVE_API_KEY',
    description: 'AINative Studio free tier. ~10M tokens/month free allocation.',
    region: 'global',
    signupUrl: 'https://ainative.studio',
  },

  {
    id: 'aihorde',
    name: 'AI Horde',
    category: 'cloud_llm',
    baseUrl: 'https://aihorde.net/api/v2',
    authMethod: 'none',
    apiFormat: 'custom',
    modalities: ['llm'],
    models: [
      { id: 'community-llama', modalities: ['llm'], contextWindow: 4096, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 3 } },
      { id: 'gemma', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 3 } },
      { id: 'cydonia', modalities: ['llm'], contextWindow: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 2 } },
    ],
    streaming: false,
    toolCalling: false,
    envKey: '',
    description: 'AI Horde community-powered free inference. Anonymous access, no key required. Slow but free.',
    region: 'global',
    signupUrl: 'https://aihorde.net',
  },

  {
    id: 'ovh-ai',
    name: 'OVH AI Endpoints',
    category: 'cloud_llm',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    authMethod: 'none',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'qwen3.5-397b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 6 } },
      { id: 'gpt-oss-120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'llama-3.3-70b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: '',
    description: 'OVH AI Endpoints free tier. Anonymous access, no card required. Qwen3.5, GPT-OSS, Llama 3.3.',
    region: 'eu',
    signupUrl: 'https://endpoints.ai.cloud.ovh.net',
  },

  // ═══════════════════════════════════════════════════════════
  // NEW FREE PROVIDERS (not in main section above)
  // ═══════════════════════════════════════════════════════════

  {
    id: 'deepinfra',
    name: 'DeepInfra',
    category: 'cloud_llm',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 5, rpd: 500, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DEEPINFRA_API_KEY',
    description: 'DeepInfra free tier. Serverless inference, no credit card required.',
    region: 'us',
    signupUrl: 'https://deepinfra.com',
  },

  {
    id: 'kilo',
    name: 'Kilo Gateway',
    category: 'cloud_llm',
    baseUrl: 'https://api.kilo.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'auto:free', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 10, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'KILO_API_KEY',
    description: 'Kilo Gateway free tier. Uncapped free inference, auto-routing.',
    region: 'global',
    signupUrl: 'https://kilo.ai',
  },

  {
    id: 'scaleway',
    name: 'Scaleway Generative APIs',
    category: 'hosting',
    baseUrl: 'https://api.scaleway.com/generative-ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [
      { id: 'gemma-4-26b-a4b-it', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'glm-5.2', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['vision', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'gpt-oss-120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'mistral-medium-3.5-128b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'qwen3-235b-a22b-instruct-2507', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 9, speedRank: 6 } },
      { id: 'qwen3-coder-30b-a3b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 8 } },
      { id: 'qwen3.6-35b-a3b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'qwen3.5-397b-a17b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 9, speedRank: 6 } },
      { id: 'devstral-2-123b-instruct-2512', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
      { id: 'holo2-30b-a3b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'mistral-small-3.2-24b-instruct-2506', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 8 } },
      { id: 'bge-multilingual-gemma2', modalities: ['embedding'], capabilities: ['embedding', 'multilingual'], specializations: ['embedding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 7, speedRank: 7 } },
      { id: 'qwen3-embedding-8b', modalities: ['embedding'], capabilities: ['embedding'], specializations: ['embedding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 1000000, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'SCALWAY_API_KEY',
    description: 'Scaleway Generative APIs. 1M free tokens. Gemma 4, GLM 5.2, Qwen3, Mistral, Devstral.',
    region: 'eu',
    signupUrl: 'https://console.scaleway.com/generative-api/models',
  },

  {
    id: 'baseten',
    name: 'Baseten',
    category: 'hosting',
    baseUrl: 'https://api.baseten.co/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'any-model', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'BASETEN_API_KEY',
    description: 'Baseten. $30 free credits. Pay by compute time, run any supported model.',
    region: 'us',
    signupUrl: 'https://app.baseten.co/',
  },

  {
    id: 'nebius',
    name: 'Nebius',
    category: 'hosting',
    baseUrl: 'https://api.studio.nebius.com/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding'],
    models: [
      { id: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'deepseek-ai/DeepSeek-R1', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NEBIUS_API_KEY',
    description: 'Nebius. $1 free credits. Fast open-source model inference.',
    region: 'eu',
    signupUrl: 'https://tokenfactory.nebius.com/',
  },

  {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    category: 'hosting',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'deepseek-ai/DeepSeek-V3-0324', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general', 'coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'deepseek-ai/DeepSeek-R1-0528', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['reasoning', 'streaming'], specializations: ['reasoning'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 7 } },
      { id: 'qwen/qwen3-coder-480b-a35b-instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'HYPERBOLIC_API_KEY',
    description: 'Hyperbolic. $1 free credits. DeepSeek V3/R1, Llama 3.3, Qwen3 Coder.',
    region: 'us',
    signupUrl: 'https://app.hyperbolic.ai/',
  },

  {
    id: 'aion-labs',
    name: 'Aion Labs',
    category: 'cloud_llm',
    baseUrl: 'https://api.aionlabs.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'aion-2.5', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['creative', 'roleplay'], freeTier: { rateLimits: { rpm: 15, rpd: 0, tpm: 0, tpd: 20000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'aion-2.0', modalities: ['llm'], contextWindow: 128000, maxOutputTokens: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['creative', 'roleplay'], freeTier: { rateLimits: { rpm: 15, rpd: 0, tpm: 0, tpd: 20000 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 7 } },
      { id: 'aion-rp-1.0', modalities: ['llm'], contextWindow: 32768, maxOutputTokens: 8192, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['creative', 'roleplay'], freeTier: { rateLimits: { rpm: 15, rpd: 0, tpm: 0, tpd: 20000 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 8 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: 'AIONLABS_API_KEY',
    description: 'Aion Labs. Permanent free tier. Roleplay and storytelling specialized. 15 RPM, 20K TPD.',
    region: 'global',
    signupUrl: 'https://www.aionlabs.ai',
  },

  {
    id: 'ovhcloud',
    name: 'OVHcloud AI Endpoints',
    category: 'hosting',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    authMethod: 'none',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      { id: 'Qwen/Qwen3.5-397B-A17B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general', 'reasoning'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 9, speedRank: 6 } },
      { id: 'openai/gpt-oss-120b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'openai/gpt-oss-20b', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'meta-llama/Meta-Llama-3.3-70B-Instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['tool_use', 'streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'Qwen/Qwen3.6-27B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'Qwen/Qwen3-32B', modalities: ['llm'], contextWindow: 131072, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['general'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 8 } },
      { id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', modalities: ['llm'], contextWindow: 262144, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['coding'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'Qwen/Qwen2.5-VL-72B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'vision'], specializations: ['multimodal'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 8, speedRank: 7 } },
      { id: 'mistralai/Mistral-Small-3.2-24B-Instruct', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming', 'tool_use'], specializations: ['fast'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 7, speedRank: 8 } },
      { id: 'mistralai/Mistral-Nemo-Instruct-2407', modalities: ['llm'], contextWindow: 128000, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 6, speedRank: 9 } },
      { id: 'mistralai/Mistral-7B-Instruct-v0.3', modalities: ['llm'], contextWindow: 32768, inputCostPer1M: 0, outputCostPer1M: 0, capabilities: ['streaming'], specializations: ['fast', 'cheap'], freeTier: { rateLimits: { rpm: 2, rpd: 0, tpm: 0, tpd: 0 }, monthlyTokenBudget: 0, intelligenceRank: 5, speedRank: 10 } },
    ],
    streaming: true,
    toolCalling: false,
    envKey: '',
    description: 'OVHcloud AI Endpoints. 2 RPM anonymous, no signup. EU-hosted. Qwen3, Llama, Mistral, GPT-OSS.',
    region: 'eu',
    signupUrl: 'https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/',
  },
];

// ---------------------------------------------------------------------------
// Auto-populate pricingTier for every model.
// Uses explicit catalog metadata rather than runtime heuristics.
// ---------------------------------------------------------------------------
for (const provider of PROVIDER_CATALOG) {
  for (const model of provider.models) {
    if (model.subscriptionOnly) {
      model.pricingTier = 'subscription_only';
    } else if (model.freeTier) {
      // Has a monthly token budget → truly free (generous).
      // No monthly budget → free but strictly rate-limited.
      model.pricingTier = model.freeTier.monthlyTokenBudget > 0 ? 'free' : 'free_with_limits';
    } else {
      const inputCost = model.inputCostPer1M ?? 0;
      const outputCost = model.outputCostPer1M ?? 0;
      model.pricingTier = (inputCost > 0 || outputCost > 0) ? 'paid' : 'free';
    }
  }
}

/**
 * Get provider template by ID
 */
export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/**
 * Get all providers in a category
 */
export function getProvidersByCategory(category: ProviderTemplate['category']): ProviderTemplate[] {
  return PROVIDER_CATALOG.filter((p) => p.category === category);
}

/**
 * Get providers that support a specific modality
 */
export function getProvidersByModality(modality: string): ProviderTemplate[] {
  return PROVIDER_CATALOG.filter((p) => p.modalities.includes(modality));
}

/**
 * Search providers by name or description
 */
export function searchProviders(query: string): ProviderTemplate[] {
  const lower = query.toLowerCase();
  return PROVIDER_CATALOG.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      p.id.includes(lower)
  );
}
