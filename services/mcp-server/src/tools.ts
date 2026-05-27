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

// ---------------------------------------------------------------------------
// dmrx_chat — Chat completions (LLM modality)
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
};
