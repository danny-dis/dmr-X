/**
 * MCP Tool definitions for DMR-X
 *
 * Each tool maps to a DMR-X modality and accepts parameters
 * matching the OpenAI-compatible API surface.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums / literals
// ---------------------------------------------------------------------------

const QualityTarget = z.enum(['frontier', 'balanced', 'economy']).optional()
  .describe('Routing quality target: frontier (best quality), balanced (default), or economy (cheapest)');

const ResponseFormat = z.enum(['text', 'json_object']).optional()
  .describe('Response format type');

const ProviderPreference = z.array(z.string()).optional()
  .describe('Ordered list of preferred provider IDs (e.g., ["openai", "anthropic"])');

const ProviderBlacklist = z.array(z.string()).optional()
  .describe('List of provider IDs to exclude from routing');

const LatencyTarget = z.union([z.number(), z.string()]).optional()
  .describe('Maximum acceptable latency in ms (number or string like "100ms")');

const CostTarget = z.union([z.number(), z.string()]).optional()
  .describe('Maximum acceptable cost per 1M output tokens (number or string like "$0.50")');

const LocalFirst = z.boolean().optional()
  .describe('Prefer local models (e.g., Ollama) when available');

const RequirePrivacy = z.boolean().optional()
  .describe('Force use of privacy-preserving providers only');

// ---------------------------------------------------------------------------
// Shared message/tool schemas
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([
    z.string(),
    z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('image_url'),
        image_url: z.object({
          url: z.string(),
          detail: z.enum(['auto', 'low', 'high']).optional(),
        }),
      }),
      z.object({
        type: z.literal('input_audio'),
        input_audio: z.object({
          data: z.string(),
          format: z.enum(['wav', 'mp3']),
        }),
      }),
    ])),
  ]),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

export const ToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

export const ToolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string() }),
  }),
]);

// ---------------------------------------------------------------------------
// dmrx_chat — Chat completions (LLM modality)
// ---------------------------------------------------------------------------

export const dmrxChatParams = {
  messages: z.array(ChatMessageSchema).describe('Array of chat messages'),
  model: z.string().optional().describe('Preferred model (DMR-X will route to best available if omitted)'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2)'),
  max_tokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
  top_p: z.number().min(0).max(1).optional().describe('Nucleus sampling probability'),
  frequency_penalty: z.number().min(-2).max(2).optional().describe('Frequency penalty (-2 to 2)'),
  presence_penalty: z.number().min(-2).max(2).optional().describe('Presence penalty (-2 to 2)'),
  stop: z.array(z.string()).optional().describe('Stop sequences'),
  response_format: ResponseFormat,
  seed: z.number().int().nullable().optional().describe('Random seed for reproducibility'),
  n: z.number().int().positive().optional().describe('Number of completions to generate'),
  tools: z.array(ToolSchema).optional().describe('Tools available to the model'),
  tool_choice: ToolChoiceSchema.optional().describe('Tool choice strategy'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  latency_target: LatencyTarget,
  cost_target: CostTarget,
  local_first: LocalFirst,
  require_privacy: RequirePrivacy,
} as const;

// ---------------------------------------------------------------------------
// dmrx_generate_image — Image generation (diffusion modality)
// ---------------------------------------------------------------------------

export const dmrxGenerateImageParams = {
  prompt: z.string().describe('Text description of the image to generate'),
  negative_prompt: z.string().optional().describe('Text description of what to avoid'),
  model: z.string().optional().describe('Preferred diffusion model'),
  width: z.number().int().positive().optional().describe('Image width in pixels (default 1024)'),
  height: z.number().int().positive().optional().describe('Image height in pixels (default 1024)'),
  steps: z.number().int().positive().max(150).optional().describe('Number of diffusion steps'),
  seed: z.number().int().optional().describe('Random seed for reproducibility'),
  style: z.string().optional().describe('Style preset (e.g. "photographic", "anime", "digital-art")'),
  cfg_scale: z.number().min(1).max(30).optional().describe('Classifier-free guidance scale (1-30)'),
  n: z.number().int().positive().optional().describe('Number of images to generate'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
  require_privacy: RequirePrivacy,
} as const;

// ---------------------------------------------------------------------------
// dmrx_embed — Embeddings
// ---------------------------------------------------------------------------

export const dmrxEmbedParams = {
  input: z.union([z.string(), z.array(z.string())]).describe('Text to embed (string or array of strings)'),
  model: z.string().optional().describe('Preferred embedding model'),
  dimensions: z.number().int().positive().optional().describe('Desired embedding dimensions'),
  encoding_format: z.enum(['float', 'base64']).optional().describe('Output encoding format'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
  require_privacy: RequirePrivacy,
} as const;

// ---------------------------------------------------------------------------
// dmrx_transcribe — Speech-to-text (audio_stt modality)
// ---------------------------------------------------------------------------

export const dmrxTranscribeParams = {
  audio: z.string().describe('Base64-encoded audio data or URL to audio file'),
  audio_format: z.enum(['wav', 'mp3', 'm4a', 'webm']).optional().describe('Audio format (auto-detected if omitted)'),
  model: z.string().optional().describe('Preferred STT model'),
  language: z.string().optional().describe('Language code (e.g. "en", "es")'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

// ---------------------------------------------------------------------------
// dmrx_speak — Text-to-speech (audio_tts modality)
// ---------------------------------------------------------------------------

export const dmrxSpeakParams = {
  input: z.string().describe('Text to convert to speech'),
  model: z.string().optional().describe('Preferred TTS model'),
  voice: z.string().optional().describe('Voice identifier (e.g. "alloy", "echo", "nova")'),
  speed: z.number().min(0.25).max(4.0).optional().describe('Speech speed (0.25-4.0)'),
  format: z.string().optional().describe('Audio output format (mp3, opus, aac, flac, wav, pcm)'),
  language: z.string().optional().describe('Language code'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

// ---------------------------------------------------------------------------
// dmrx_rerank — Document reranking
// ---------------------------------------------------------------------------

export const dmrxRerankParams = {
  query: z.string().describe('Search query'),
  documents: z.array(z.string()).describe('Documents to rerank'),
  model: z.string().optional().describe('Preferred reranking model'),
  top_n: z.number().int().positive().optional().describe('Number of top results to return'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

// ---------------------------------------------------------------------------
// dmrx_models — List available models
// ---------------------------------------------------------------------------

export const dmrxModelsParams = {
  modality: z.enum([
    'llm', 'diffusion', 'embedding', 'audio_tts', 'audio_stt',
    'video', 'music', 'reranking', 'moderation', 'code_completion',
  ]).optional().describe('Filter by modality'),
  provider: z.string().optional().describe('Filter by provider ID (e.g. "openai", "anthropic")'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_status — System health and status
// ---------------------------------------------------------------------------

export const dmrxStatusParams = {
  include_models: z.boolean().optional().describe('Include model details in response (default false)'),
  include_providers: z.boolean().optional().describe('Include provider health details (default false)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_batch — Batch operations
// ---------------------------------------------------------------------------

export const dmrxBatchParams = {
  calls: z.array(z.object({
    tool: z.string().describe('Tool name (e.g., dmrx_chat, dmrx_embed)'),
    parameters: z.record(z.unknown()).describe('Tool parameters'),
  })).describe('Array of tool calls to execute'),
  continue_on_fail: z.boolean().optional().describe('Continue executing on failure (default true)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_context_* — Context management
// ---------------------------------------------------------------------------

export const dmrxContextSaveParams = {
  id: z.string().optional().describe('Context ID (auto-generated if omitted)'),
  messages: z.array(ChatMessageSchema).describe('Conversation messages to save'),
  ttl_seconds: z.number().int().positive().optional().describe('Time-to-live in seconds (default 86400)'),
  user: z.string().optional().describe('Owner user ID'),
} as const;

export const dmrxContextLoadParams = {
  id: z.string().describe('Context ID to load'),
} as const;

export const dmrxContextListParams = {
  user: z.string().optional().describe('Filter by owner user ID'),
  limit: z.number().int().positive().optional().describe('Max results (default 20)'),
} as const;

export const dmrxContextSummarizeParams = {
  id: z.string().describe('Context ID to summarize'),
} as const;

export const dmrxContextCompressParams = {
  id: z.string().describe('Context ID to compress'),
  target_tokens: z.number().int().positive().optional().describe('Target token count after compression'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_chat_stream — Streaming chat
// ---------------------------------------------------------------------------

export const dmrxChatStreamParams = {
  ...dmrxChatParams,
} as const;

export const dmrxGenerateImageStreamParams = {
  ...dmrxGenerateImageParams,
} as const;

// ---------------------------------------------------------------------------
// dmrx_workflow — Workflow orchestration
// ---------------------------------------------------------------------------

export const dmrxWorkflowParams = {
  steps: z.array(z.object({
    id: z.string().describe('Step identifier'),
    tool: z.string().describe('Tool name to execute'),
    parameters: z.record(z.unknown()).describe('Tool parameters'),
    input_mapping: z.record(z.string()).optional().describe('Map previous step outputs to this step inputs'),
    condition: z.string().optional().describe('Expression to evaluate for conditional execution'),
    retry_policy: z.object({
      max_retries: z.number().int().nonnegative().optional(),
      backoff_ms: z.number().int().positive().optional(),
    }).optional(),
  })).describe('Ordered workflow steps'),
  fail_fast: z.boolean().optional().describe('Stop on first error (default true)'),
  persist: z.boolean().optional().describe('Persist workflow state for resumption'),
} as const;

// ---------------------------------------------------------------------------
// Tool name constants
// ---------------------------------------------------------------------------

export const TOOL_NAMES = {
  CHAT: 'dmrx_chat',
  GENERATE_IMAGE: 'dmrx_generate_image',
  EMBED: 'dmrx_embed',
  TRANSCRIBE: 'dmrx_transcribe',
  SPEAK: 'dmrx_speak',
  RERANK: 'dmrx_rerank',
  MODELS: 'dmrx_models',
  STATUS: 'dmrx_status',
  BATCH: 'dmrx_batch',
  CONTEXT_SAVE: 'dmrx_context_save',
  CONTEXT_LOAD: 'dmrx_context_load',
  CONTEXT_LIST: 'dmrx_context_list',
  CONTEXT_SUMMARIZE: 'dmrx_context_summarize',
  CONTEXT_COMPRESS: 'dmrx_context_compress',
  CHAT_STREAM: 'dmrx_chat_stream',
  GENERATE_IMAGE_STREAM: 'dmrx_generate_image_stream',
  WORKFLOW: 'dmrx_workflow',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  dmrx_chat:
    'Send a chat completion request through DMR-X. Automatically routes to the best available LLM ' +
    'based on quality, cost, and latency targets. Supports vision, tool use, and all OpenAI-compatible parameters.',
  dmrx_generate_image:
    'Generate images through DMR-X. Automatically routes to the best available diffusion model ' +
    '(Stable Diffusion, DALL-E, Replicate, etc.). Supports text-to-image and style presets.',
  dmrx_embed:
    'Get text embeddings through DMR-X. Routes to the best embedding model for the given input. ' +
    'Supports single strings and batches.',
  dmrx_transcribe:
    'Transcribe audio to text through DMR-X. Routes to the best STT model (OpenAI Whisper, Deepgram, etc.). ' +
    'Accepts base64-encoded audio or URLs.',
  dmrx_speak:
    'Convert text to speech through DMR-X. Routes to the best TTS model (ElevenLabs, OpenAI, etc.). ' +
    'Supports multiple voices and speed control.',
  dmrx_rerank:
    'Rerank documents by relevance to a query through DMR-X. Routes to the best reranking model ' +
    '(Cohere, Jina, etc.). Useful for RAG pipelines.',
  dmrx_models:
    'List available models in DMR-X, optionally filtered by modality or provider. ' +
    'Shows model capabilities, health status, and cost information.',
  dmrx_status:
    'Get DMR-X system status including router health, provider availability, and configuration. ' +
    'Useful for diagnostics and monitoring.',
  dmrx_batch:
    'Execute multiple MCP tool calls atomically. Returns aggregated results with individual outcomes. ' +
    'Supports partial failure modes (continue-on-fail vs fail-fast).',
  dmrx_context_save:
    'Save conversation context with a persistent ID. Enables stateful agent interactions across sessions. ' +
    'Accepts TTL for automatic expiry.',
  dmrx_context_load:
    'Load a previously saved conversation context by ID. Returns messages and metadata.',
  dmrx_context_list:
    'List saved conversation contexts, optionally filtered by user. Supports pagination.',
  dmrx_context_summarize:
    'Generate a contextual summary of a saved conversation. Reduces token cost for long conversations.',
  dmrx_context_compress:
    'Compress a saved conversation context while preserving meaning. Reduces storage and token usage.',
  dmrx_chat_stream:
    'Streaming chat completion through DMR-X. Returns token-by-token output via streaming response.',
  dmrx_generate_image_stream:
    'Streaming image generation through DMR-X. Returns progressive generation updates.',
  dmrx_workflow:
    'Define and execute multi-step workflows. Supports conditional branching, looping, parallel execution, ' +
    'error handling, and retry policies. Enables complex agent behaviors in a single MCP call.',
};
