/**
 * G0DM0D3 / Godmode integration types
 * These types mirror the G0DM0D3 API contract.
 */

export interface GodmodeConfig {
  /** G0DM0D3 API base URL */
  baseUrl: string;
  /** API key for G0DM0D3 auth (optional) */
  apiKey?: string;
  /** OpenRouter API key (required for G0DM0D3 to route to models) */
  openrouterApiKey: string;
}

export type UltraplinianTier = 'fast' | 'standard' | 'smart' | 'power' | 'ultra';

export type AutotuneStrategy = 'adaptive' | 'precise' | 'balanced' | 'creative' | 'chaotic';

export type ParseltongueTechnique =
  | 'leetspeak'
  | 'unicode'
  | 'zwj'
  | 'mixedcase'
  | 'phonetic'
  | 'random';

export type ParseltongueIntensity = 'light' | 'medium' | 'heavy';

export type STMModule = 'hedge_reducer' | 'direct_mode' | 'curiosity_bias' | 'casual_mode';

export interface GodmodeChatRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /** Enable GODMODE system prompt injection */
  godmode?: boolean;
  /** Custom system prompt to replace GODMODE */
  custom_system_prompt?: string;
  /** Enable AutoTune parameter optimization */
  autotune?: boolean;
  autotune_strategy?: AutotuneStrategy;
  /** Enable Parseltongue trigger word obfuscation */
  parseltongue?: boolean;
  parseltongue_technique?: ParseltongueTechnique;
  parseltongue_intensity?: ParseltongueIntensity;
  /** STM modules to apply */
  stm_modules?: STMModule[];
  /** Opt in to open dataset collection */
  contribute_to_dataset?: boolean;
}

export interface UltraplinianRequest {
  messages: Array<{ role: string; content: string }>;
  tier?: UltraplinianTier;
  godmode?: boolean;
  custom_system_prompt?: string;
  autotune?: boolean;
  strategy?: AutotuneStrategy;
  parseltongue?: boolean;
  parseltongue_technique?: ParseltongueTechnique;
  parseltongue_intensity?: ParseltongueIntensity;
  stm_modules?: STMModule[];
  max_tokens?: number;
  contribute_to_dataset?: boolean;
}

export interface ConsortiumRequest extends UltraplinianRequest {
  orchestrator_model?: string;
}

export interface AutotuneAnalyzeRequest {
  message: string;
  conversation_history?: Array<{ role: string; content: string }>;
  strategy?: AutotuneStrategy;
  overrides?: Record<string, number>;
}

export interface ParseltongueEncodeRequest {
  text: string;
  technique?: ParseltongueTechnique;
  intensity?: ParseltongueIntensity;
  custom_triggers?: string[];
}

export interface TransformRequest {
  text: string;
  modules?: STMModule[];
}

export interface RaceRanking {
  model: string;
  score: number;
  duration_ms: number;
  success: boolean;
  content_length: number;
}

export interface GodmodeChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  x_g0dm0d3?: {
    params_used?: Record<string, number>;
    pipeline?: {
      godmode?: boolean;
      autotune?: {
        detected_context?: string;
        confidence?: number;
        strategy?: string;
      };
      parseltongue?: {
        triggers_found?: string[];
        technique_used?: string;
      } | null;
      stm?: {
        modules_applied?: string[];
      };
    };
  };
}

export interface UltraplinianResponse {
  response: string;
  winner: {
    model: string;
    score: number;
    duration_ms: number;
  };
  race: {
    tier: string;
    models_queried: number;
    models_succeeded: number;
    total_duration_ms: number;
    rankings: RaceRanking[];
  };
  params_used?: Record<string, number>;
  pipeline?: Record<string, any>;
}

export interface ConsortiumResponse {
  synthesis: string;
  orchestrator: {
    model: string;
    duration_ms: number;
  };
  collection: {
    tier: string;
    models_queried: number;
    models_succeeded: number;
    collection_duration_ms: number;
    total_duration_ms: number;
    responses: Array<{
      model: string;
      score: number;
      duration_ms: number;
      success: boolean;
      content?: string;
    }>;
  };
  params_used?: Record<string, number>;
  pipeline?: Record<string, any>;
}

export interface AutotuneAnalyzeResponse {
  detected_context: string;
  confidence: number;
  params: {
    temperature: number;
    top_p: number;
    top_k: number;
    frequency_penalty: number;
    presence_penalty: number;
    repetition_penalty: number;
  };
}

export interface ParseltongueEncodeResponse {
  original: string;
  encoded: string;
  technique: string;
  intensity: string;
  triggers_found: string[];
}

export interface TransformResponse {
  original_text: string;
  transformed_text: string;
}

export interface GodmodeTierInfo {
  tier: string;
  label: string;
  limits: {
    total: number;
    perMinute: number;
    perDay: number;
  };
  features: {
    ultraplinian_tiers: string[];
    max_race_models: number;
    research_access: string;
    dataset_export_formats: string[];
    can_flush: boolean;
    can_access_metadata_events: boolean;
    can_download_corpus: boolean;
  };
}

export type GodmodeFeedbackContextType =
  | 'code'
  | 'creative'
  | 'analytical'
  | 'conversational'
  | 'chaotic';

/**
 * Feedback submission request for the G0DM0D3 EMA learning loop.
 * The G0DM0D3 server returns a varying, loosely-typed payload, so the
 * response type is permissive (known fields plus an index signature).
 */
export interface GodmodeFeedbackRequest {
  message_id: string;
  context_type: GodmodeFeedbackContextType;
  model?: string;
  persona?: string;
  /** 1 = positive, -1 = negative. */
  rating: 1 | -1;
  params: Record<string, number>;
  response_text?: string;
}

/**
 * Outcome of a feedback submission (adjusted EMA params / learning state).
 * Permissive: the server's response shape varies between builds.
 */
export interface GodmodeFeedbackResponse {
  message_id?: string;
  context_type?: GodmodeFeedbackContextType;
  rating?: 1 | -1;
  adjusted_params?: Record<string, number>;
  ema_state?: Record<string, number>;
  learned?: boolean;
  [key: string]: unknown;
}

/**
 * Learning statistics (EMA state) returned by the G0DM0D3 feedback stats
 * endpoint. Permissive: the server's response shape varies.
 */
export interface GodmodeFeedbackStats {
  total_feedback?: number;
  context_counts?: Partial<Record<GodmodeFeedbackContextType, number>>;
  ema_state?: Record<string, number>;
  params?: Record<string, number>;
  [key: string]: unknown;
}
