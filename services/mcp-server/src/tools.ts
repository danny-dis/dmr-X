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
    z.string().max(100_000, 'Message content too long — max 100,000 characters'),
    z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string().max(100_000, 'Text content too long') }),
      z.object({
        type: z.literal('image_url'),
        image_url: z.object({
          url: z.string().max(2048, 'Image URL too long'),
          detail: z.enum(['auto', 'low', 'high']).optional(),
        }),
      }),
      z.object({
        type: z.literal('input_audio'),
        input_audio: z.object({
          data: z.string().max(25_000_000, 'Audio data too large — max ~18MB base64'),
          format: z.enum(['wav', 'mp3']),
        }),
      }),
    ])).max(20, 'Too many content parts — max 20 per message'),
  ]),
  name: z.string().max(100).optional(),
  tool_call_id: z.string().max(200).optional(),
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
  messages: z.array(ChatMessageSchema).min(1, 'At least one message required').max(1000, 'Too many messages — max 1000').describe('Array of chat messages'),
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
  documents: z.array(z.string().max(50_000, 'Document too long — max 50,000 characters')).min(1, 'At least one document required').max(1000, 'Too many documents — max 1000').describe('Documents to rerank'),
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
    'video', 'music', 'reranking', 'moderation', 'code_completion', '3d',
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
  })).min(1, 'At least one call required').max(50, 'Too many batch calls — max 50').describe('Array of tool calls to execute'),
  continue_on_fail: z.boolean().optional().describe('Continue executing on failure (default true)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_context_* — Context management
// ---------------------------------------------------------------------------

export const dmrxContextSaveParams = {
  id: z.string().optional().describe('Context ID (auto-generated if omitted)'),
  messages: z.array(ChatMessageSchema).min(1, 'At least one message required').max(1000, 'Too many messages — max 1000').describe('Conversation messages to save'),
  ttl_seconds: z.number().int().optional().describe('Time-to-live in seconds (default 86400). Set to 0 for permanent storage.'),
  user: z.string().optional().describe('Owner user ID'),
  permanent: z.boolean().optional().describe('If true, context is stored permanently and never expires'),
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
// dmrx_generate_video — Video generation
// ---------------------------------------------------------------------------

export const dmrxGenerateVideoParams = {
  prompt: z.string().describe('Text description of the video to generate'),
  model: z.string().optional().describe('Preferred video model'),
  image: z.string().optional().describe('Base64-encoded image for img2video'),
  duration: z.number().int().positive().optional().default(5).describe('Video duration in seconds'),
  fps: z.number().int().positive().optional().default(24).describe('Frames per second'),
  aspect_ratio: z.enum(['16:9', '9:16', '1:1', '3:2', '2:3']).optional().default('16:9'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

export const dmrxGenerateVideoStreamParams = {
  ...dmrxGenerateVideoParams,
} as const;

// ---------------------------------------------------------------------------
// dmrx_generate_music — Music generation
// ---------------------------------------------------------------------------

export const dmrxGenerateMusicParams = {
  prompt: z.string().describe('Text description of the music to generate'),
  model: z.string().optional().describe('Preferred music model'),
  genre: z.string().optional().describe('Music genre (e.g., "pop", "rock", "electronic")'),
  duration_seconds: z.number().int().positive().optional().default(30).describe('Duration in seconds'),
  instruments: z.array(z.string()).optional().describe('List of instruments'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

// ---------------------------------------------------------------------------
// dmrx_generate_3d — 3D Generation
// ---------------------------------------------------------------------------

export const dmrxGenerate3DParams = {
  prompt: z.string().optional().describe('Text description for text-to-3d generation'),
  image: z.string().optional().describe('Base64-encoded image or URL for image-to-3d generation'),
  model: z.string().optional().describe('Preferred 3D model (e.g., tencent/hunyuan3d-2, trellis, stability-ai/stable-fast-3d)'),
  texture_resolution: z.number().int().positive().optional().describe('Texture resolution (e.g., 1024, 2048)'),
  seed: z.number().int().optional().describe('Random seed for reproducibility'),
  quality_target: QualityTarget,
  user: z.string().optional().describe('End-user identifier'),
  provider_preference: ProviderPreference,
  provider_blacklist: ProviderBlacklist,
  local_first: LocalFirst,
} as const;

// ---------------------------------------------------------------------------
// dmrx_workflow — Workflow orchestration
// ---------------------------------------------------------------------------

export const dmrxWorkflowParams = {
  steps: z.array(z.object({
    id: z.string().max(100).describe('Step identifier'),
    tool: z.string().max(200).describe('Tool name to execute'),
    parameters: z.record(z.unknown()).describe('Tool parameters'),
    input_mapping: z.record(z.string()).optional().describe('Map previous step outputs to this step inputs'),
    condition: z.string().max(500).optional().describe('Expression to evaluate for conditional execution'),
    retry_policy: z.object({
      max_retries: z.number().int().nonnegative().max(10).optional(),
      backoff_ms: z.number().int().positive().max(60_000).optional(),
    }).optional(),
  })).min(1, 'At least one step required').max(100, 'Too many workflow steps — max 100').describe('Ordered workflow steps'),
  fail_fast: z.boolean().optional().describe('Stop on first error (default true)'),
  persist: z.boolean().optional().describe('Persist workflow state for resumption'),
} as const;

// ---------------------------------------------------------------------------
// Tool name constants
// ---------------------------------------------------------------------------

export const TOOL_NAMES = {
  CHAT: 'dmrx_chat',
  GENERATE_IMAGE: 'dmrx_generate_image',
  GENERATE_VIDEO: 'dmrx_generate_video',
  GENERATE_MUSIC: 'dmrx_generate_music',
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
  GENERATE_VIDEO_STREAM: 'dmrx_generate_video_stream',
  GENERATE_3D: 'dmrx_generate_3d',
  WORKFLOW: 'dmrx_workflow',
  // Coding agent tools
  READ_FILE: 'dmrx_read_file',
  WRITE_FILE: 'dmrx_write_file',
  EDIT_FILE: 'dmrx_edit_file',
  LIST_FILES: 'dmrx_list_files',
  BASH: 'dmrx_bash',
  SEARCH_FILES: 'dmrx_search_files',
  // Tool search and discovery
  TOOL_SEARCH: 'dmrx_tool_search',
  TOOL_LIST: 'dmrx_tool_list',
  // Tool templates and presets
  TEMPLATE_LIST: 'dmrx_template_list',
  TEMPLATE_GET: 'dmrx_template_get',
  TEMPLATE_CREATE: 'dmrx_template_create',
  TEMPLATE_UPDATE: 'dmrx_template_update',
  TEMPLATE_DELETE: 'dmrx_template_delete',
  TEMPLATE_EXECUTE: 'dmrx_template_execute',
  PRESET_LIST: 'dmrx_preset_list',
  PRESET_GET: 'dmrx_preset_get',
  PRESET_CREATE: 'dmrx_preset_create',
  PRESET_UPDATE: 'dmrx_preset_update',
  PRESET_DELETE: 'dmrx_preset_delete',
  // Gateway import + skill listing tools
  IMPORT_REPO: 'dmrx_import_repo',
  LIST_SKILLS: 'dmrx_list_skills',
  GET_SKILL: 'dmrx_get_skill',
  // Agent discovery + invocation tools
  LIST_AGENTS: 'dmrx_list_agents',
  RUN_AGENT: 'dmrx_run_agent',
  DISPATCH_TASK: 'dmrx_dispatch_task',
  // Job submission + tracking tools
  SUBMIT_JOB: 'dmrx_submit_job',
  JOB_STATUS: 'dmrx_job_status',
  JOB_TASKS: 'dmrx_job_tasks',
  CANCEL_JOB: 'dmrx_cancel_job',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ---------------------------------------------------------------------------
// Tool output schemas (for structured output via registerTool)
// ---------------------------------------------------------------------------

export const dmrxChatOutput = {
  id: z.string().describe('Unique request ID'),
  object: z.literal('chat.completion'),
  model: z.string().describe('Model ID used'),
  provider: z.string().describe('Provider ID used'),
  created: z.number().describe('Unix timestamp'),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.literal('assistant'),
      content: z.string().nullable(),
    }),
    finish_reason: z.string(),
  })).optional(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
  routed_via: z.string().describe('Provider/model routing info'),
  latency_ms: z.number().describe('Routing latency in ms'),
} as const;

export const dmrxImageOutput = {
  created: z.number().describe('Unix timestamp'),
  provider: z.string(),
  model: z.string(),
  data: z.array(z.object({
    url: z.string().optional(),
    b64_json: z.string().optional(),
    revised_prompt: z.string().optional(),
  })),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxEmbeddingOutput = {
  object: z.literal('list'),
  provider: z.string(),
  model: z.string(),
  data: z.array(z.object({
    object: z.literal('embedding'),
    index: z.number(),
    embedding: z.array(z.number()),
  })),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxTranscribeOutput = {
  provider: z.string(),
  model: z.string(),
  text: z.string(),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxSpeakOutput = {
  provider: z.string(),
  model: z.string(),
  audio: z.object({
    url: z.string().optional(),
    b64_json: z.string().optional(),
    format: z.string().optional(),
    duration: z.number().optional(),
  }).nullable(),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxRerankOutput = {
  provider: z.string(),
  model: z.string(),
  results: z.array(z.object({
    index: z.number(),
    relevance_score: z.number(),
    document: z.string(),
  })),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxVideoOutput = {
  created: z.number().describe('Unix timestamp'),
  provider: z.string(),
  model: z.string(),
  data: z.array(z.object({
    url: z.string().optional(),
    b64_json: z.string().optional(),
    duration: z.number().optional(),
    fps: z.number().optional(),
  })),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxMusicOutput = {
  created: z.number().describe('Unix timestamp'),
  provider: z.string(),
  model: z.string(),
  audio: z.object({
    url: z.string().optional(),
    b64_json: z.string().optional(),
    format: z.string().optional(),
    duration: z.number().optional(),
  }).nullable(),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrx3DOutput = {
  created: z.number().describe('Unix timestamp'),
  provider: z.string(),
  model: z.string(),
  data: z.array(z.object({
    url: z.string().optional(),
    b64_json: z.string().optional(),
    format: z.string().optional(),
  })),
  routed_via: z.string(),
  latency_ms: z.number(),
} as const;

export const dmrxModelsOutput = z
  .object({
    source: z.enum(['registry', 'adapters']),
    count: z.number(),
    models: z
      .array(
        z
          .object({
            provider: z.string(),
            model: z.string(),
            modality: z.string(),
            capabilities: z.array(z.string()).optional(),
            qualityScore: z.number().optional(),
            healthy: z.boolean().optional(),
          })
          .passthrough(),
      ),
  })
  .passthrough();

export const dmrxStatusOutput = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
    uptime: z.string(),
    uptimeMs: z.number(),
    /** Requests handled by this process across all sessions. */
    requestsHandled: z.number(),
    /** Requests handled by the calling session alone. */
    sessionRequestsHandled: z.number().optional(),
    lastError: z.string().nullable(),
    router: z.object({
      candidateCount: z.number(),
      config: z.object({
        epsilon: z.number(),
        defaultQualityTarget: z.string(),
        enableDecomposition: z.boolean(),
      }),
    }),
    aggregator: z
      .object({
        enabled: z.boolean(),
        externalServerCount: z.number(),
        externalToolCount: z.number(),
      })
      .optional(),
  })
  .passthrough();

export const dmrxBatchOutput = {
  success: z.boolean(),
  results: z.array(z.object({
    tool: z.string(),
    success: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })),
} as const;

export const dmrxContextSaveOutput = {
  success: z.literal(true),
  context_id: z.string(),
  message: z.string(),
} as const;

export const dmrxContextLoadOutput = {
  success: z.literal(true),
  context: z.object({
    id: z.string(),
    messages: z.array(z.unknown()),
    user: z.string(),
    created_at: z.string(),
  }),
} as const;

export const dmrxContextListOutput = {
  success: z.literal(true),
  count: z.number(),
  contexts: z.array(z.object({
    id: z.string(),
    user: z.string(),
    created_at: z.string(),
    preview: z.string(),
  })),
} as const;

export const dmrxContextSummarizeOutput = {
  success: z.literal(true),
  context_id: z.string(),
  summary: z.string(),
} as const;

export const dmrxContextCompressOutput = {
  success: z.literal(true),
  context_id: z.string(),
  messages_kept: z.number(),
} as const;

export const dmrxWorkflowOutput = {
  success: z.boolean(),
  results: z.array(z.object({
    step_id: z.string(),
    tool: z.string(),
    success: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })),
  step_outputs: z.record(z.unknown()),
} as const;

export const dmrxToolSearchOutput = {
  query: z.string(),
  results: z.array(z.object({
    name: z.string(),
    description: z.string(),
    score: z.number().describe('Relevance score (0-1)'),
    source: z.enum(['internal', 'external']).describe('Whether tool is internal or from external MCP server'),
    server_id: z.string().optional().describe('External MCP server ID (for external tools)'),
    modality: z.string().optional(),
  })),
  total_count: z.number(),
} as const;

export const dmrxToolListOutput = {
  tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    source: z.enum(['internal', 'external']),
    server_id: z.string().optional(),
    modality: z.string().optional(),
  })),
  total_count: z.number(),
  internal_count: z.number(),
  external_count: z.number(),
} as const;

// ---------------------------------------------------------------------------
// Coding agent tool schemas
// ---------------------------------------------------------------------------

export const dmrxReadFileInput = {
  path: z.string().describe('File path relative to workspace'),
  offset: z.number().int().positive().optional().describe('Start line (1-indexed)'),
  limit: z.number().int().positive().optional().describe('Max lines to read'),
} as const;

export const dmrxWriteFileInput = {
  path: z.string().describe('File path relative to workspace'),
  content: z.string().describe('File content to write'),
} as const;

export const dmrxEditFileInput = {
  path: z.string().describe('File path relative to workspace'),
  old_string: z.string().describe('Exact string to replace'),
  new_string: z.string().describe('Replacement string'),
} as const;

export const dmrxListFilesInput = {
  path: z.string().optional().describe('Directory path (default: workspace root)'),
  pattern: z.string().optional().describe('Filter by filename substring'),
  recursive: z.boolean().optional().describe('List recursively (default: false)'),
} as const;

export const dmrxBashInput = {
  command: z.string().describe('Shell command to execute'),
  timeout_ms: z.number().int().positive().optional().describe('Timeout in ms (default: 30000)'),
  cwd: z.string().optional().describe('Working directory relative to workspace'),
} as const;

export const dmrxSearchFilesInput = {
  pattern: z.string().describe('Text to search for in files'),
  path: z.string().optional().describe('Directory to search in (default: workspace root)'),
  include: z.string().optional().describe('Filter by filename (e.g., ".ts")'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_tool_search — Intelligent tool discovery
// ---------------------------------------------------------------------------

export const dmrxToolSearchParams = {
  query: z.string().describe('Natural language search query for tools (e.g., "generate an image", "convert text to speech")'),
  max_results: z.number().int().positive().optional().describe('Maximum number of results to return (default: 10)'),
  modalities: z.array(z.enum(['llm', 'diffusion', 'embedding', 'audio_tts', 'audio_stt', 'video', 'music', '3d', 'reranking'])).optional().describe('Filter by tool modalities'),
  include_external: z.boolean().optional().describe('Include proxied external MCP tools in search (default: true)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_tool_list — List all available tools
// ---------------------------------------------------------------------------

export const dmrxToolListParams = {
  modalities: z.array(z.enum(['llm', 'diffusion', 'embedding', 'audio_tts', 'audio_stt', 'video', 'music', '3d', 'reranking'])).optional().describe('Filter by tool modalities'),
  include_external: z.boolean().optional().describe('Include proxied external MCP tools (default: true)'),
  include_descriptions: z.boolean().optional().describe('Include tool descriptions (default: true)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_template_* — Tool Templates
// ---------------------------------------------------------------------------

export const dmrxTemplateListParams = {
  tag: z.string().optional().describe('Filter by tag'),
  search: z.string().optional().describe('Search by name or description'),
} as const;

export const dmrxTemplateGetParams = {
  id: z.string().describe('Template ID'),
} as const;

export const dmrxTemplateCreateParams = {
  name: z.string().min(1).max(100).describe('Template name'),
  description: z.string().max(500).optional().describe('Template description'),
  steps: z.array(z.object({
    id: z.string().describe('Step ID for input mapping'),
    tool_name: z.string().describe('Tool to execute (e.g., "dmrx_bash", "dmrx_chat")'),
    parameters: z.record(z.unknown()).describe('Default parameters for this step'),
    input_mapping: z.record(z.string()).optional().describe('Map outputs from previous steps: { "param": "$step_id.output_field" }'),
    condition: z.string().optional().describe('Conditional execution expression'),
    description: z.string().optional().describe('Step description'),
  })).min(1).max(20).describe('Ordered list of steps to execute'),
  tags: z.array(z.string()).optional().describe('Tags for discovery'),
  version: z.string().optional().describe('Semantic version (default: 1.0.0)'),
} as const;

export const dmrxTemplateUpdateParams = {
  id: z.string().describe('Template ID'),
  name: z.string().min(1).max(100).optional().describe('Template name'),
  description: z.string().max(500).optional().describe('Template description'),
  steps: z.array(z.object({
    id: z.string().describe('Step ID for input mapping'),
    tool_name: z.string().describe('Tool to execute'),
    parameters: z.record(z.unknown()).describe('Default parameters'),
    input_mapping: z.record(z.string()).optional().describe('Input mapping from previous steps'),
    condition: z.string().optional().describe('Conditional execution'),
    description: z.string().optional().describe('Step description'),
  })).optional().describe('Updated steps'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  version: z.string().optional().describe('Updated version'),
} as const;

export const dmrxTemplateDeleteParams = {
  id: z.string().describe('Template ID'),
} as const;

export const dmrxTemplateExecuteParams = {
  id: z.string().describe('Template ID'),
  inputs: z.record(z.unknown()).optional().describe('Override parameters for specific steps (key: "step_id.param", value: override)'),
} as const;

// ---------------------------------------------------------------------------
// dmrx_preset_* — Tool Presets
// ---------------------------------------------------------------------------

export const dmrxPresetListParams = {
  tool_name: z.string().optional().describe('Filter by tool name'),
} as const;

export const dmrxPresetGetParams = {
  id: z.string().describe('Preset ID'),
} as const;

export const dmrxPresetCreateParams = {
  tool_name: z.string().describe('Tool name (e.g., "dmrx_chat", "dmrx_bash")'),
  defaults: z.record(z.unknown()).describe('Default parameter values'),
  overrides: z.record(z.unknown()).optional().describe('Forced values (cannot be overridden by user)'),
  priority: z.number().int().min(0).max(1000).optional().describe('Priority (higher = evaluated first, default: 0)'),
  description: z.string().max(500).optional().describe('Preset description'),
} as const;

export const dmrxPresetUpdateParams = {
  id: z.string().describe('Preset ID'),
  defaults: z.record(z.unknown()).optional().describe('Updated default values'),
  overrides: z.record(z.unknown()).optional().describe('Updated forced values'),
  priority: z.number().int().min(0).max(1000).optional().describe('Updated priority'),
  description: z.string().max(500).optional().describe('Updated description'),
} as const;

export const dmrxPresetDeleteParams = {
  id: z.string().describe('Preset ID'),
} as const;

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
  dmrx_generate_video:
    'Generate videos through DMR-X. Routes to the best video model (Runway, Pika, Replicate, etc.). ' +
    'Supports text-to-video and image-to-video with duration, fps, and aspect_ratio control.',
  dmrx_generate_music:
    'Generate music through DMR-X. Routes to music generation providers (Suno, Udio, Replicate/MusicGen). ' +
    'Supports genre, duration, and instrument specification.',
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
  dmrx_generate_video_stream:
    'Streaming video generation through DMR-X. Returns progressive generation updates.',
  dmrx_generate_3d:
    'Generate 3D models through DMR-X. Routes to the best 3D generation model (Hunyuan3D, Trellis, Stable Fast 3D). ' +
    'Supports text-to-3d and image-to-3d with texture resolution control. Returns GLB/OBJ URLs.',
  dmrx_workflow:
    'Define and execute multi-step workflows. Supports conditional branching, looping, parallel execution, ' +
    'error handling, and retry policies. Enables complex agent behaviors in a single MCP call.',
  dmrx_read_file:
    'Read a file from the workspace. Returns content with line numbers. Supports offset/limit for large files.',
  dmrx_write_file:
    'Write content to a file in the workspace. Creates parent directories if needed. Overwrites existing files.',
  dmrx_edit_file:
    'Edit a file by replacing an exact string match. Fails if old_string is not found or matches multiple times.',
  dmrx_list_files:
    'List files and directories in the workspace. Supports recursive listing and filename pattern filtering.',
  dmrx_bash:
    'Execute a shell command in the workspace. Returns stdout, stderr, and exit code. Has a 30s default timeout.',
  dmrx_search_files:
    'Search for text patterns across files in the workspace. Returns matching files with line numbers and content.',
  dmrx_tool_search:
    'Intelligent tool discovery using hybrid BM25 + semantic search. Find the best tools for your task ' +
    'by describing what you want to do in natural language. Returns ranked results with relevance scores.',
  dmrx_tool_list:
    'List all available tools in the DMR-X system, including proxied external MCP tools. ' +
    'Optionally filter by modality or other criteria.',
  dmrx_template_list:
    'List saved tool templates for the current tenant. Templates are pre-configured tool call patterns ' +
    'that can be reused. Filter by tag or search by name.',
  dmrx_template_get:
    'Get a tool template by ID. Returns the full template including all steps and parameters.',
  dmrx_template_create:
    'Create a new tool template. Templates define multi-step tool call patterns with input mapping ' +
    'between steps. Use for saving and reusing common workflows.',
  dmrx_template_update:
    'Update an existing tool template. Modify name, description, steps, or tags.',
  dmrx_template_delete:
    'Delete a tool template (soft delete). The template is deactivated but not removed.',
  dmrx_template_execute:
    'Execute a tool template. Runs all steps in sequence, passing outputs between steps via input_mapping. ' +
    'Returns aggregated results.',
  dmrx_preset_list:
    'List tool presets for the current tenant. Presets provide default parameter values for specific tools.',
  dmrx_preset_get:
    'Get a tool preset by ID. Returns the full preset including defaults and overrides.',
  dmrx_preset_create:
    'Create a new tool preset. Presets define default parameters that are automatically applied when ' +
    'the tool is called. Overrides are forced values that cannot be changed by users.',
  dmrx_preset_update:
    'Update an existing tool preset. Modify defaults, overrides, priority, or description.',
  dmrx_preset_delete:
    'Delete a tool preset (soft delete). The preset is deactivated but not removed.',
  dmrx_import_repo:
    'Import agents and skills from a GitHub repository into DMR-X via the gateway. ' +
    'Given a public GitHub repo URL, registers any agent definitions (POST /v1/agents/import) ' +
    'and skill definitions (POST /v1/skills/import) found in the repository. ' +
    'Returns the number of imported agents and skills plus any errors. ' +
    'Requires a configured gateway URL and tenant API key.',
  dmrx_list_skills:
    'List skills imported into DMR-X via the gateway (GET /v1/skills). ' +
    'Supports optional free-text search, tag filter, and result limit. ' +
    'Returns each skill\'s id, name, description, and tags so a caller can decide which one to load. ' +
    'Use dmrx_get_skill afterward to fetch the full content of a chosen skill. ' +
    'Requires a configured gateway URL and tenant API key.',
  dmrx_get_skill:
    'Fetch a single skill by id from the gateway (GET /v1/skills/:id), including its full content/body. ' +
    'Use after dmrx_list_skills has identified which skill to load into context. ' +
    'Requires a configured gateway URL and tenant API key.',
  dmrx_list_agents:
    'List DMR-X agent instances deployed for this tenant (GET /v1/agents/instances), so a caller can ' +
    'discover who it can talk to before invoking one. Returns each instance\'s id, name, description, ' +
    'and category. Use dmrx_run_agent afterward when you already know which instance to address by id; ' +
    'use dmrx_dispatch_task instead when you do not want to pick one yourself and would rather let ' +
    'DMR-X select the best match for a task. Requires a configured gateway URL and tenant API key.',
  dmrx_run_agent:
    'Send a message to a SPECIFIC, already-known DMR-X agent instance (POST /v1/agents/:instanceId/chat) ' +
    'and get back its reply. Use this when you already know which agent you want to talk to (e.g. from ' +
    'dmrx_list_agents, or because the caller was told the instance id) and want to continue or start a ' +
    'conversation with it directly. If you do not know which agent is best suited for a task, use ' +
    'dmrx_dispatch_task instead and let DMR-X choose. Returns the assistant\'s reply text, a ' +
    'conversationId to continue the thread with further calls, and any usage/cost the gateway reports. ' +
    'Requires a configured gateway URL and tenant API key.',
  dmrx_dispatch_task:
    'Describe a task in natural language and let DMR-X pick the best-matching active agent instance to ' +
    'handle it (POST /v1/agentic/dispatch), optionally running it in the same call. Use this when you do NOT ' +
    'already know which agent instance to address — DMR-X scores all active instances for the tenant by ' +
    'category/tag/keyword overlap and selects the best one. Use dmrx_run_agent instead when you already ' +
    'know the exact instance id you want to talk to. With run=true (the default) it returns which agent ' +
    'was selected plus its output; with run=false it returns only the selection so the caller can decide ' +
    'whether to proceed. Fails with NO_AGENTS_AVAILABLE if the tenant has no active agent instances to ' +
    'dispatch to. Requires a configured gateway URL and tenant API key.',
  dmrx_submit_job:
    'Submit a job to DMR-X and get back its job id (POST /v1/jobs). A job is a WHOLE OUTCOME delegated ' +
    'to DMR-X — e.g. "implement feature X", "fix all failing tests", or "write the migration plan" — not a ' +
    'single turn of work. Jobs run ASYNCHRONOUSLY: this tool returns as soon as the gateway has accepted the ' +
    'job, NOT when the work is done, so do not expect any result in the response. After submitting, poll ' +
    'dmrx_job_status (and dmrx_job_tasks for per-task progress) until the job reaches a terminal status. ' +
    'The gateway generates the job id — do not pass one. The brief is required; acceptance criteria and ' +
    'budget/max-depth caps are optional. Contrast with dmrx_dispatch_task, which runs a single task ' +
    'synchronously and returns its output in the same call. Requires a configured gateway URL and tenant ' +
    'API key.',
  dmrx_job_status:
    'Check the current status of an already-submitted DMR-X job (GET /v1/jobs/:id). Because jobs run ' +
    'asynchronously, call this repeatedly (poll) to track a job submitted via dmrx_submit_job until it ' +
    'reaches a terminal status — do not expect dmrx_submit_job itself to block or return results. Returns ' +
    'the job id, current status, brief, spend and budget (both USD and tokens) and creation/update ' +
    'timestamps, exactly as the gateway reports them. A job is a whole outcome delegated to DMR-X and ' +
    'takes time, unlike dmrx_dispatch_task which runs a single task synchronously. Returns JOB_NOT_FOUND ' +
    'if the job id does not exist. Requires a configured gateway URL and tenant API key.',
  dmrx_job_tasks:
    'List the individual tasks a submitted DMR-X job was decomposed into (GET /v1/jobs/:id/tasks). Use ' +
    'after dmrx_submit_job to see how an asynchronous job is being executed — each task carries its id, ' +
    'seq, title, status, dependsOn, and assignedInstanceId. Poll this alongside dmrx_job_status to track ' +
    'progress of a job; a job is a whole outcome delegated to DMR-X that runs asynchronously, unlike ' +
    'dmrx_dispatch_task which runs one task synchronously in a single call. Returns JOB_NOT_FOUND if the ' +
    'job id does not exist. Requires a configured gateway URL and tenant API key.',
  dmrx_cancel_job:
    'Cancel an in-flight DMR-X job by id (POST /v1/jobs/:id/cancel). Use when a job submitted via ' +
    'dmrx_submit_job no longer needs to run — e.g. the outcome is no longer wanted or the job is taking ' +
    'too long. Jobs are whole outcomes that run asynchronously, so cancellation takes effect after ' +
    'submission; the response reports the job id and its (updated) status. Returns JOB_NOT_FOUND if the ' +
    'job id does not exist. For a single synchronous task, use dmrx_dispatch_task instead. Requires a ' +
    'configured gateway URL and tenant API key.',
};
